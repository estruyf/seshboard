import { randomUUID } from 'node:crypto';
import type { Capabilities, ImageAttachment, LogLevel, ModelOption, PermissionDecision, PermissionMode, ProviderMode, SlashCommand } from '@seshboard/protocol';
import type { RawSessionMessage } from '../../claude/transcript.ts';
import type { DriverEvents, DriverSession, DriverSessionConfig, DriverStatus, ProviderDriver } from '../provider.ts';
import { AcpError, AUTH_REQUIRED, type AcpConnection } from './acpConnection.ts';
import { acpOutcome, acpPermissionRequest, acpPrompt, acpToolCard } from './acpCards.ts';
import type { AcpModel, AcpPermissionOption, AcpPermissionOutcome, AcpPermissionRequest, AcpPromptResponse, AcpSessionResponse, AcpSessionUpdate, AcpToolCall } from './acpTypes.ts';

/** What makes the generic ACP driver one agent's: its name, modes, models and the bits ACP leaves to each agent. */
export interface AcpDriverOptions {
  /** The agent's name in errors and notes ("Gemini CLI"). */
  agentName: string;
  connection: AcpConnection;
  /** Seshboard's modes it has, in its words; the first is the default. */
  modes: ProviderMode[];
  /** The agent's own mode (`session/set_mode`) for one of Seshboard's; a read-only session asks before anything that writes. */
  modeId(mode: PermissionMode, readOnly: boolean): string;
  status(): Promise<DriverStatus>;
  /** What to say when the agent answers that it needs a login (ACP's `-32000`). */
  signInMessage: string;
  /** The models offered before a session said which the account has. */
  defaultModels: ModelOption[];
  /** The tool's own name for a call, when the agent says it some other way than ACP (Gemini: in the call's id). */
  toolName?(call: AcpToolCall): string | null;
  /** A permission card's tool, when the agent's differs from ACP's `kind` (an MCP tool's). Null: ACP's. */
  toolCard?(call: AcpToolCall): { toolName: string; input: Record<string, unknown> } | null;
  /**
   * The id the session's transcript gives a message just sent (the agent writes its own transcript, which Seshboard
   * reads), once it is there; null while it isn't.
   */
  messageIdOf?(sessionId: string, text: string, since: number): Promise<string | null>;
  /** Text the agent sends that isn't part of its reply (Gemini's `[MODE_UPDATE] yolo`). */
  isNoise?(text: string): boolean;
  /** How long `send` waits for the transcript's id of the message. */
  messageIdMs?: number;
  /** How long the history an agent sends again after `session/load` may take to stop before a prompt goes anyway. */
  replayMs?: number;
  log?: (level: LogLevel, message: string) => void;
}

const MESSAGE_ID_MS = 2000;
/** A replay has ended when nothing came for this long. */
const REPLAY_QUIET_MS = 250;
const REPLAY_MAX_MS = 5000;

/** A model as the agent lists it, as Seshboard's. ACP has no effort setting. */
const modelOption = (model: AcpModel): ModelOption => ({ value: model.modelId, displayName: model.name || model.modelId, description: model.description ?? '', supportsEffort: false });

/** One session the agent runs here, as the driver routes the agent's messages to it. */
interface Live {
  update(update: AcpSessionUpdate): void;
  permission(params: AcpPermissionRequest, signal: AbortSignal): Promise<AcpPermissionOutcome>;
  /** The agent's process ended: the session must be loaded again in the next one. */
  crashed(): void;
}

/**
 * A `ProviderDriver` for an agent that speaks the Agent Client Protocol: one process per profile (`AcpConnection`),
 * each session in it by its id. `session/new` or `session/load` starts one, `session/prompt` is a turn (it answers when
 * the turn ends), `session/cancel` stops it, `session/set_mode` and `session/set_model` switch, and the agent's
 * `session/request_permission` is the permission card.
 *
 * The transcript is the agent's own file, which its reader reads (Gemini CLI writes each message as it goes): the
 * driver streams the reply and the tool running from `session/update`, and leaves the complete messages to the file,
 * so the live transcript and the file are the same messages with the same ids. ACP has no steering: a message sent with
 * `steer` goes as soon as the prompt under way ends, as part of the same turn (Stop drops it with the turn). A slash command's answer the agent doesn't write is kept
 * (`DriverEvents.messages`' `keep`).
 */
export function acpDriver(options: AcpDriverOptions): ProviderDriver & { live(): ReadonlySet<string> } {
  const { connection, agentName } = options;
  const log = options.log ?? (() => {});
  const messageIdMs = options.messageIdMs ?? MESSAGE_ID_MS;
  const replayMs = options.replayMs ?? REPLAY_MAX_MS;
  const sessions = new Map<string, Live>();
  /** The account's models and the agent's commands, from the last session that said. */
  let models: ModelOption[] | null = null;
  let commandList: SlashCommand[] = [];
  /**
   * What the agent said about a session before Seshboard knew its id (its commands come right after `session/new`'s
   * answer, sometimes in the same read): handed to the session once it is.
   */
  const early = new Map<string, AcpSessionUpdate[]>();

  connection.onNotification((method, params) => {
    if (method !== 'session/update') return;
    const { sessionId, update } = (params ?? {}) as { sessionId?: string; update?: AcpSessionUpdate };
    if (typeof sessionId !== 'string' || !update || typeof update.sessionUpdate !== 'string') return;
    const live = sessions.get(sessionId);
    if (live) live.update(update);
    else if (update.sessionUpdate === 'available_commands_update' || update.sessionUpdate === 'usage_update') {
      const kept = early.get(sessionId) ?? [];
      early.set(sessionId, [...kept, update].slice(-4));
      if (early.size > 16) early.delete(early.keys().next().value!);
    }
  });
  connection.handleRequests(async (method, params, signal) => {
    if (method !== 'session/request_permission') throw Object.assign(new Error(`Seshboard does not handle ${method}`), { rpcCode: -32601 });
    const request = (params ?? {}) as AcpPermissionRequest;
    const live = sessions.get(request.sessionId);
    // A session that isn't running here (closed a moment ago): refused, as a card nobody sees.
    if (!live) return { outcome: { outcome: 'cancelled' } } satisfies AcpPermissionOutcome;
    return live.permission(request, signal);
  });
  connection.onExit(() => {
    for (const live of sessions.values()) live.crashed();
  });

  /** The agent's answer to a failed `session/new` or `session/load`, in Seshboard's words. */
  const startError = (error: unknown): Error => {
    if (error instanceof AcpError && error.code === 'rpc' && error.rpcCode === AUTH_REQUIRED) return new Error(`${options.signInMessage} (${agentName}: ${error.message})`);
    return error instanceof Error ? error : new Error(String(error));
  };

  const remember = (response: AcpSessionResponse) => {
    const listed = response.models?.availableModels?.filter((m) => m && typeof m.modelId === 'string');
    if (listed?.length) models = listed.map(modelOption);
  };

  return {
    modes: options.modes,
    status: () => options.status(),
    async models() {
      return models ?? options.defaultModels;
    },
    async commands() {
      return commandList;
    },
    live: () => new Set(sessions.keys()),

    async start(config: DriverSessionConfig, events: DriverEvents): Promise<DriverSession> {
      const readOnly = config.readOnly === true;
      let mode = config.permissionMode;
      let model = config.model;
      /** The agent's own model before Seshboard picked one: what "the default" goes back to. */
      let agentModel: string | null = null;
      let commands: SlashCommand[] = commandList;
      let loaded = false;
      let closed = false;
      /** The history `session/load` sends again: none of it is this turn's. Ends when it goes quiet. */
      let replay: { quiet: Promise<void>; bump: () => void; arm: () => void; done: () => void } | null = null;
      /** The turn under way, from before its `session/prompt` goes (the session may load first) until it answers. */
      let turn: Promise<void> | null = null;
      /** The turn's `session/prompt` went: only then can the agent stop it. */
      let prompting = false;
      /** Stop (or close) came before the prompt went: it doesn't go. */
      let stopAsked = false;
      /** Messages sent with `steer` while a turn runs: each goes when the turn before it ends, as part of the same turn. */
      const steered: Array<{ text: string; attachments: readonly ImageAttachment[] }> = [];
      /** A command the agent answers without a turn of its own: its words are kept, as it writes none of them. */
      let command: { text: string; reply: string; at: string } | null = null;
      let release: (() => void) | null = null;
      const pending = new Map<string, { options: AcpPermissionOption[]; resolve: (outcome: AcpPermissionOutcome) => void }>();

      /**
       * Waits until the replayed history has stopped coming, or a few seconds at most. The wait counts from the agent's
       * answer to `session/load` (`arm`): the agent sends the history after it, and loading can take seconds.
       */
      const startReplay = () => {
        let timer: NodeJS.Timeout | null = null;
        let cap: NodeJS.Timeout | null = null;
        let armed = false;
        let finish: () => void = () => {};
        const quiet = new Promise<void>((resolve) => (finish = resolve));
        const done = () => {
          if (timer) clearTimeout(timer);
          if (cap) clearTimeout(cap);
          if (replay?.quiet === quiet) replay = null;
          finish();
        };
        const bump = () => {
          if (!armed) return;
          if (timer) clearTimeout(timer);
          timer = setTimeout(done, REPLAY_QUIET_MS);
        };
        const arm = () => {
          armed = true;
          cap = setTimeout(done, replayMs);
          bump();
        };
        const started = { quiet, bump, arm, done };
        replay = started;
        return started;
      };

      /** Starts or loads the session in the agent's process, in the mode and on the model asked for. */
      const open = async (resume: string | null): Promise<string> => {
        release?.();
        release = connection.hold();
        let response: AcpSessionResponse;
        // Seshboard listens before it asks: the history the agent sends again comes right after its answer.
        const replaying = resume ? startReplay() : null;
        try {
          response = await connection.request<AcpSessionResponse>(resume ? 'session/load' : 'session/new', resume ? { sessionId: resume, cwd: config.cwd, mcpServers: [] } : { cwd: config.cwd, mcpServers: [] });
        } catch (error) {
          replaying?.done();
          release?.();
          release = null;
          throw startError(error);
        }
        replaying?.arm();
        const id = resume ?? response.sessionId;
        if (typeof id !== 'string' || !id) {
          release?.();
          release = null;
          throw new Error(`${agentName} didn't name the session it started`);
        }
        remember(response);
        agentModel = response.models?.currentModelId ?? agentModel;
        loaded = true;
        return id;
      };

      /** Applies the mode and model asked for: the agent starts a loaded session in its own default mode. */
      const configure = async (sessionId: string) => {
        await connection.request('session/set_mode', { sessionId, modeId: options.modeId(mode, readOnly) }).catch((error: Error) => log('warn', `${agentName} mode for ${sessionId}: ${error.message}`));
        if (model && model !== agentModel) {
          await connection.request('session/set_model', { sessionId, modelId: model }).then(
            () => events.model(model!),
            (error: Error) => log('warn', `${agentName} model for ${sessionId}: ${error.message}`),
          );
        } else if (agentModel) events.model(agentModel);
      };

      // Registered before the session exists, so the first updates (its commands) aren't missed.
      let sessionId = config.resume ?? '';
      const live: Live = {
        update(update) {
          replay?.bump();
          switch (update.sessionUpdate) {
            case 'available_commands_update': {
              const list = Array.isArray((update as { availableCommands?: unknown }).availableCommands) ? (update as { availableCommands: Array<{ name?: unknown; description?: unknown; input?: { hint?: unknown } | null }> }).availableCommands : [];
              commands = list.filter((c) => typeof c.name === 'string').map((c) => ({ name: String(c.name), description: typeof c.description === 'string' ? c.description : '', argumentHint: typeof c.input?.hint === 'string' ? c.input.hint : '' }));
              commandList = commands;
              return;
            }
            case 'usage_update': {
              const { used, size } = update as { used?: unknown; size?: unknown };
              if (typeof used === 'number' && typeof size === 'number' && size > 0) events.usage({ contextTokens: used, contextMax: size });
              return;
            }
          }
          // Outside a turn (the history `session/load` sends again, a note about a mode change): not the reply.
          if (!turn || replay) return;
          switch (update.sessionUpdate) {
            case 'agent_message_chunk':
            case 'agent_thought_chunk': {
              const content = (update as { content?: { type?: unknown; text?: unknown } }).content;
              const text = content?.type === 'text' && typeof content.text === 'string' ? content.text : '';
              if (!text || options.isNoise?.(text)) return;
              if (update.sessionUpdate === 'agent_thought_chunk') events.stream({ kind: 'thinking', text });
              else if (command) command.reply += text;
              else events.stream({ kind: 'text', text });
              return;
            }
            case 'tool_call': {
              const call = update as AcpToolCall;
              // What was written before it is complete: the file has it. The stream shows the tool running.
              events.stream({ kind: 'clear', text: '' });
              events.stream({ kind: 'tool', text: (options.toolCard?.(call) ?? acpToolCard(call, options.toolName?.(call) ?? null)).toolName });
              return;
            }
          }
        },
        permission(params, signal) {
          const call = params.toolCall ?? ({ toolCallId: '' } as AcpToolCall);
          const requestId = randomUUID();
          const card = options.toolCard?.(call) ?? acpToolCard(call, options.toolName?.(call) ?? null);
          const offered = Array.isArray(params.options) ? params.options : [];
          return new Promise<AcpPermissionOutcome>((resolve) => {
            pending.set(requestId, { options: offered, resolve });
            // The agent stopped waiting (its process ended): the card goes.
            signal.addEventListener(
              'abort',
              () => {
                if (!pending.delete(requestId)) return;
                resolve({ outcome: { outcome: 'cancelled' } });
                events.permissionDone(requestId);
              },
              { once: true },
            );
            events.permission(acpPermissionRequest(requestId, call, offered, card));
          });
        },
        crashed() {
          loaded = false;
          dropAll();
          release?.();
          release = null;
        },
      };

      /** Answers every open card as cancelled (a stopped turn, a closed session) and takes it away. */
      const dropAll = () => {
        for (const [requestId, open] of pending) {
          open.resolve({ outcome: { outcome: 'cancelled' } });
          events.permissionDone(requestId);
        }
        pending.clear();
      };

      if (config.resume) sessions.set(config.resume, live);
      try {
        sessionId = await open(config.resume ?? null);
      } catch (error) {
        if (config.resume) sessions.delete(config.resume);
        throw error;
      }
      sessions.set(sessionId, live);
      for (const update of early.get(sessionId) ?? []) live.update(update);
      early.delete(sessionId);
      await configure(sessionId);

      /** The session is in this process again after a crash: loaded, in its mode, on its model. */
      const ensureLoaded = async () => {
        if (loaded) return;
        await open(sessionId);
        await configure(sessionId);
      };

      /** The transcript's id for the message just sent, once the agent wrote it; null when it doesn't in time. */
      const transcriptId = async (text: string, since: number): Promise<string | null> => {
        if (!options.messageIdOf) return null;
        const until = Date.now() + messageIdMs;
        while (Date.now() < until && !closed) {
          const id = await options.messageIdOf(sessionId, text, since).catch(() => null);
          if (id) return id;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return null;
      };

      /** One turn: the prompt goes, and the turn ends when the agent answers it. */
      const startTurn = async (text: string, attachments: readonly ImageAttachment[]): Promise<string> => {
        // The turn is under way from here: a message sent meanwhile waits for it, never a second prompt (the agent would
        // drop the first).
        let ended: () => void = () => {};
        turn = new Promise<void>((resolve) => (ended = resolve));
        stopAsked = false;
        try {
          await ensureLoaded();
          if (replay) await replay.quiet;
        } catch (error) {
          turn = null;
          ended();
          throw error;
        }
        // Stopped or closed while the session loaded: the prompt never goes.
        if (closed || stopAsked) {
          turn = null;
          ended();
          steered.length = 0;
          if (!closed) events.state('idle');
          return `acp-${randomUUID()}`;
        }
        const since = Date.now();
        const name = text.trim().split(/\s/)[0]?.slice(1);
        command = text.trimStart().startsWith('/') && commands.some((c) => c.name === name) ? { text, reply: '', at: new Date(since).toISOString() } : null;
        const prompt = connection.request<AcpPromptResponse>('session/prompt', { sessionId, prompt: acpPrompt(text, attachments, config.cwd) }, { timeoutMs: null });
        prompting = true;
        events.state('running');
        void prompt
          .then(
            (response) => finish(response, null),
            (error: unknown) => finish(null, error),
          )
          .finally(ended);
        const id = command ? null : await transcriptId(text, since);
        return id ?? `acp-${randomUUID()}`;
      };

      /** Stops the turn: the agent's, once its prompt went; else the prompt doesn't go. What was steered into it goes too. */
      const stop = () => {
        dropAll();
        steered.length = 0;
        if (!turn) return;
        if (prompting && loaded) connection.notify('session/cancel', { sessionId });
        else stopAsked = true;
      };

      const finish = (response: AcpPromptResponse | null, error: unknown) => {
        turn = null;
        prompting = false;
        dropAll();
        // Closed: nobody listens, and nothing more goes to the agent.
        if (closed) {
          steered.length = 0;
          return;
        }
        events.stream({ kind: 'clear', text: '' });
        const ran = command;
        command = null;
        if (ran && !error) {
          // The agent answered the command in words it doesn't write down: kept, and shown where it was asked.
          const notes: RawSessionMessage[] = [
            { type: 'user', uuid: `acp-command-${randomUUID()}`, parent_tool_use_id: null, timestamp: ran.at, message: { role: 'user', content: [{ type: 'text', text: ran.text }] } },
            ...(ran.reply.trim() ? [{ type: 'assistant' as const, uuid: `acp-command-${randomUUID()}`, parent_tool_use_id: null, timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: ran.reply }] } }] : []),
          ];
          events.messages(notes, { keep: true });
        }
        if (error) {
          steered.length = 0;
          const message = error instanceof AcpError && error.rpcCode === AUTH_REQUIRED ? options.signInMessage : error instanceof Error ? error.message : String(error);
          events.state('error', message);
        } else if (response?.stopReason === 'refusal') {
          steered.length = 0;
          events.state('error', `${agentName} refused to go on`);
        } else if (response?.stopReason !== 'cancelled' && steered.length) {
          // A message steered into the turn goes now, in the same turn: no idle between them.
          const next = steered.shift()!;
          void startTurn(next.text, next.attachments).catch((failed: unknown) => events.state('error', failed instanceof Error ? failed.message : String(failed)));
        } else {
          steered.length = 0;
          events.state('idle');
        }
      };

      return {
        sessionId,
        async send(text, attachments, steer) {
          if (closed) throw new Error(`This ${agentName} session was closed`);
          if (turn) {
            if (!steer) throw new Error(`${agentName} is still working on the last message`);
            // ACP has no way into a turn under way: the message goes as soon as this prompt ends, in the same turn.
            steered.push({ text, attachments });
            return `acp-${randomUUID()}`;
          }
          return startTurn(text, attachments);
        },
        async setMode(next) {
          mode = next;
          if (loaded) await connection.request('session/set_mode', { sessionId, modeId: options.modeId(next, readOnly) });
        },
        async commands() {
          return commands;
        },
        async capabilities(): Promise<Capabilities> {
          // ACP lists no MCP servers, agents or skills: Tools shows the commands alone.
          return { live: true, mcp: [], agents: [], commands, plugins: [], mcpToggle: false };
        },
        async mcp() {
          throw new Error(`${agentName} has no way to change its MCP servers from Seshboard yet`);
        },
        async interrupt() {
          stop();
        },
        async setModel(next: string | null) {
          model = next;
          const target = next ?? agentModel;
          if (!loaded || !target) return;
          await connection.request('session/set_model', { sessionId, modelId: target });
          events.model(target);
        },
        respond(requestId: string, decision: PermissionDecision) {
          const open = pending.get(requestId);
          if (!open) return;
          pending.delete(requestId);
          open.resolve(acpOutcome(decision, open.options));
          events.permissionDone(requestId);
          if (decision.behavior === 'deny' && decision.interrupt) stop();
        },
        async close() {
          if (closed) return;
          closed = true;
          stop();
          sessions.delete(sessionId);
          // ACP has no way to close a session yet (Gemini CLI keeps it until its process ends): letting go of the process
          // lets it stop when nothing else runs in it.
          release?.();
          release = null;
          loaded = false;
        },
      };
    },

    async dispose() {
      for (const live of sessions.values()) live.crashed();
      sessions.clear();
      models = null;
      await connection.dispose();
    },
  };
}
