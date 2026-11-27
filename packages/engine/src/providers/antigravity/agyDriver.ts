import type { Effort, ImageAttachment, LogLevel, PermissionDecision, PermissionMode, PermissionRequest, SlashCommand } from '@seshboard/protocol';
import { ASK_TIMEOUT_MS, isReadOnlyTool, READ_ONLY_REASON, READ_ONLY_STEP_REASON } from '../../host/sideQuestions.ts';
import type { RawSessionMessage } from '../../claude/transcript.ts';
import type { DriverEvents, DriverSession, DriverSessionConfig, DriverStatus, McpStdioServer, ProviderDriver } from '../provider.ts';
import { AcpError, AUTH_REQUIRED, type AcpConnection } from '../acp/acpConnection.ts';
import { acpOutcome, acpPermissionRequest, acpPrompt } from '../acp/acpCards.ts';
import type { AcpContentBlock, AcpPermissionOutcome, AcpPermissionRequest, AcpPromptResponse } from '../acp/acpTypes.ts';
import { agyPromptId, agyReplayInfo, agyToolCard, agyToolName } from './agyEvents.ts';
import { AgyLive } from './agyLive.ts';
import { AGY_MODES, agyModeId, agyModels, agyThoughtLevel, currentValue } from './agyModes.ts';
import { AGY_MCP_REFUSED, agyCapabilities, agyCommands, isOwnServerTool } from './agyTools.ts';

export interface AgyDriverOptions {
  /** The profile's `agy acp` that runs its sessions (not the one that reads them). */
  connection: AcpConnection;
  /** The profile's `--gemini-dir`: a probe session's folder, and its MCP config. */
  geminiDir: string;
  /** Whether `agy` is there (its sign in comes from `probe`). */
  binary(): Promise<{ path: string; version: string | null } | null>;
  /** Whether Antigravity lists a session: `session/load` answers for any id, so one it doesn't have is refused first. */
  has(sessionId: string): Promise<boolean>;
  /** A session's conversation as Seshboard reads it, for Ask about this session. */
  transcript?(sessionId: string): Promise<RawSessionMessage[]>;
  /** Moves a throwaway session of Seshboard's own (Ask's) to the Trash once it answered. */
  discard?(sessionId: string): Promise<void>;
  /** Antigravity named a session while it runs here. */
  onTitle?(sessionId: string, title: string): void;
  log?: (level: LogLevel, message: string) => void;
  now?: () => number;
}

/** The driver, with what the adapter needs besides `ProviderDriver`. */
export interface AgyDriver extends ProviderDriver {
  /** The sessions running here: Antigravity's presence lock on them is Seshboard's own. */
  sessions(): Set<string>;
  ask: NonNullable<ProviderDriver['ask']>;
}

const INSTALL = 'Install Google Antigravity CLI to run Antigravity sessions here.';
export const AGY_SIGN_IN = 'Not signed in to Antigravity CLI. Use Sign in on this profile in Settings › Profiles, or run `agy`. Seshboard uses that login.';
const CRASHED = 'Antigravity stopped. Send a message to continue the session.';
/** How long a status found by a probe session holds, when it was signed out (signing in should show soon). */
const SIGNED_OUT_RETRY_MS = 10_000;

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Antigravity's plan (`_meta.antigravity.tier`): "Google AI Pro". */
export const agyTier = (response: unknown): string | null => str(obj(obj(obj(obj(response)._meta).antigravity).tier).name);

/** An answer that means the login is missing or expired. */
const signedOut = (error: unknown) => error instanceof AcpError && error.code === 'rpc' && (error.rpcCode === AUTH_REQUIRED || /auth(?:entication)? required|not (?:signed|logged) in/i.test(error.message));

/** Seshboard's own MCP servers (Visuals in replies) as ACP's stdio servers. */
const acpServers = (servers: Record<string, McpStdioServer> | undefined) =>
  Object.entries(servers ?? {}).map(([name, s]) => ({ name, command: s.command, args: s.args, env: Object.entries(s.env).map(([key, value]) => ({ name: key, value })) }));

/** Text that goes after Antigravity's own system prompt (`_meta.antigravity.systemPrompt.append`, which it says it takes). */
const systemAppend = (config: Pick<DriverSessionConfig, 'appendSystem' | 'instructions'>) => {
  const text = [config.instructions, config.appendSystem].filter((t): t is string => !!t?.trim()).join('\n\n');
  return text ? { _meta: { antigravity: { systemPrompt: { append: text } } } } : {};
};

/** One session the driver routes Antigravity's messages to. */
interface Running {
  update(update: unknown): void;
  permission(request: AcpPermissionRequest, signal: AbortSignal): Promise<AcpPermissionOutcome>;
  crashed(): void;
  letGo(): void;
}

/** A conversation's text for Ask about this session: what was said, and the tools by name, in order. */
export function askContext(messages: readonly RawSessionMessage[], max = 120_000): string {
  const lines: string[] = [];
  for (const m of messages) {
    for (const raw of (obj(m.message).content as unknown[] | undefined) ?? []) {
      const block = obj(raw);
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) lines.push(`${m.type === 'user' ? 'User' : 'Assistant'}: ${block.text.trim()}`);
      else if (block.type === 'tool_use') lines.push(`Assistant used ${String(block.name)}: ${JSON.stringify(block.input).slice(0, 300)}`);
    }
  }
  const text = lines.join('\n\n');
  // The end of a long conversation matters most: what was asked last.
  return text.length > max ? `…\n${text.slice(-max)}` : text;
}

/**
 * Runs Antigravity sessions through the profile's `agy acp`: `session/new`, or `session/load` for one started before
 * (its replay is only counted, so the next prompt gets the id the transcript will give it), then a `session/prompt` per
 * message. A message sent while a turn runs is another `session/prompt`, which Antigravity steers into the turn (the one
 * before answers at once). Stop is `session/cancel`. Modes, the model and the thinking level go to the session as they
 * change. Antigravity's permission requests are the permission card, with Allow and Deny. Signing in is Antigravity's own.
 */
export function agyDriver(options: AgyDriverOptions): AgyDriver {
  const { connection, geminiDir } = options;
  const log = options.log ?? (() => {});
  const now = options.now ?? Date.now;
  const running = new Map<string, Running>();
  /**
   * What Antigravity said about a session before Seshboard knew its id (its commands come right after `session/new`'s
   * answer, sometimes in the same read), and a replay while `session/load` runs: handed to the session once it is.
   */
  const early = new Map<string, unknown[]>();
  const collecting = new Set<string>();
  let commandList: SlashCommand[] = [];
  const learnCommands = (updates: readonly unknown[]) => {
    for (const update of updates) if (obj(update).sessionUpdate === 'available_commands_update') commandList = agyCommands(update);
  };

  connection.onNotification((method, params) => {
    if (method !== 'session/update') return;
    const { sessionId, update } = obj(params) as { sessionId?: unknown; update?: unknown };
    if (typeof sessionId !== 'string' || !update) return;
    // The commands are the account's, whichever session says them (the probe's come after it closed).
    if (obj(update).sessionUpdate === 'available_commands_update') return learnCommands([update]);
    const session = running.get(sessionId);
    if (session) return session.update(update);
    const kept = early.get(sessionId) ?? [];
    kept.push(update);
    // A replay is kept whole; anything else only its last few updates.
    early.set(sessionId, collecting.has(sessionId) ? kept : kept.slice(-4));
    if (early.size > 16) early.delete(early.keys().next().value!);
  });
  connection.handleRequests(async (method, params, signal) => {
    if (method !== 'session/request_permission') throw Object.assign(new Error(`Seshboard does not handle ${method}`), { rpcCode: -32601 });
    const request = obj(params) as unknown as AcpPermissionRequest;
    const session = running.get(request.sessionId);
    // A session that isn't running here (closed a moment ago): refused, as a card nobody sees.
    if (!session) return { outcome: { outcome: 'cancelled' } } satisfies AcpPermissionOutcome;
    return session.permission(request, signal);
  });
  connection.onExit(() => {
    for (const session of running.values()) session.crashed();
  });

  /** What the last session said of the account: its models and thinking levels, commands and plan. */
  let configOptions: unknown = null;
  let probed: { at: number; status: DriverStatus } | null = null;
  let probing: Promise<DriverStatus> | null = null;
  const learn = (response: unknown) => {
    const options = obj(response).configOptions;
    if (Array.isArray(options) && options.length) configOptions = options;
  };

  /**
   * Whether `agy` runs here and is signed in, with its plan, from a session it opens in the profile's folder and closes
   * at once (no prompt: Antigravity lists none). It also gives the models and commands before any session runs. Kept
   * for the run once it worked; signed out, asked again after a few seconds, so signing in shows without a restart.
   */
  const probe = (): Promise<DriverStatus> => {
    if (probed && (probed.status.signedIn || now() - probed.at < SIGNED_OUT_RETRY_MS)) return Promise.resolve(probed.status);
    return (probing ??= (async () => {
      const binary = await options.binary().catch(() => null);
      if (!binary) return { binary: null, version: null, signedIn: false, account: null, login: null, problem: INSTALL };
      let status: DriverStatus;
      try {
        const response = await connection.request('session/new', { cwd: geminiDir, mcpServers: [] });
        learn(response);
        const id = str(obj(response).sessionId);
        if (id) await connection.request('session/close', { sessionId: id }).catch(() => {});
        const tier = agyTier(response);
        status = { binary: binary.path, version: binary.version, signedIn: true, account: tier, login: null, problem: null };
      } catch (error) {
        if (error instanceof AcpError && error.code === 'notInstalled') return { binary: null, version: null, signedIn: false, account: null, login: null, problem: INSTALL };
        status = { binary: binary.path, version: binary.version, signedIn: false, account: null, login: null, problem: signedOut(error) ? AGY_SIGN_IN : (error as Error).message };
      }
      probed = { at: now(), status };
      return status;
    })().finally(() => (probing = null)));
  };

  /** A session's start or load, in Seshboard's words when Antigravity needs a login. */
  const startError = (error: unknown): Error => (signedOut(error) ? new Error(AGY_SIGN_IN) : error instanceof Error ? error : new Error(String(error)));

  return {
    modes: AGY_MODES,
    status: () => probe(),
    async models() {
      if (!configOptions) await probe().catch(() => null);
      return agyModels(configOptions);
    },
    async commands() {
      if (!commandList.length) await probe().catch(() => null);
      return commandList;
    },
    capabilities: async () => agyCapabilities(geminiDir, commandList, false),
    sessions: () => new Set(running.keys()),

    async ask({ sessionId, cwd, model, prompt, onText, onFork }) {
      // Antigravity has no fork: a session of its own reads the conversation and answers, with tools that only read,
      // and goes to the Trash after.
      const context = options.transcript ? askContext(await options.transcript(sessionId)) : '';
      let answer = '';
      let error: string | undefined;
      let forkId: string | null = null;
      const release = connection.hold();
      try {
        const response = await connection.request('session/new', { cwd, mcpServers: [] }).catch((failed: unknown) => {
          throw startError(failed);
        });
        forkId = str(obj(response).sessionId);
        if (!forkId) throw new Error('Antigravity started no session');
        const id = forkId;
        onFork(id);
        early.delete(id);
        await connection.request('session/set_mode', { sessionId: id, modeId: 'default' }).catch(() => {});
        if (model) await connection.request('session/set_config_option', { sessionId: id, configId: 'model', value: model }).catch(() => {});
        let writing = false;
        running.set(id, {
          update(raw) {
            const update = obj(raw);
            if (update.sessionUpdate === 'agent_message_chunk') {
              const text = str(obj(update.content).text);
              if (!text) return;
              answer += text;
              writing = true;
              onText({ delta: text });
            } else if (update.sessionUpdate === 'tool_call' && writing) {
              // It went on to read something: what it wrote so far wasn't the answer.
              answer = '';
              writing = false;
              onText({ reset: true });
            }
          },
          // Read-only: what only reads goes through, anything else is declined.
          async permission(request) {
            const card = agyToolCard(request.toolCall);
            return acpOutcome(isReadOnlyTool(card.toolName, card.input) ? { behavior: 'allow' } : { behavior: 'deny', message: READ_ONLY_REASON }, request.options ?? []);
          },
          crashed() {
            error = 'Antigravity stopped';
          },
          letGo() {},
        });
        const text = context ? `This is a conversation from another session, for reference only:\n\n<conversation>\n${context}\n</conversation>\n\n${prompt}` : prompt;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const late = new Promise<'late'>((resolve) => (timer = setTimeout(() => resolve('late'), ASK_TIMEOUT_MS)));
        const turn = connection.request<AcpPromptResponse>('session/prompt', { sessionId: id, prompt: [{ type: 'text', text }] }, { timeoutMs: null });
        if ((await Promise.race([turn, late])) === 'late') {
          error = 'Antigravity took too long to answer';
          connection.notify('session/cancel', { sessionId: id });
        }
        clearTimeout(timer);
      } catch (failed) {
        error = (failed as Error).message;
      } finally {
        if (forkId) {
          running.delete(forkId);
          await connection.request('session/close', { sessionId: forkId }).catch(() => {});
          await options.discard?.(forkId).catch((failed: Error) => log('warn', `Antigravity: moving Ask's session ${forkId} to the Trash failed: ${failed.message}`));
        }
        release();
      }
      // Antigravity has no unit like Copilot's premium requests.
      return { answer: answer.trim() ? answer : null, ...(error ? { error } : {}), spent: 0 };
    },

    async start(config: DriverSessionConfig, events: DriverEvents): Promise<DriverSession> {
      const readOnly = config.readOnly === true;
      let mode: PermissionMode = config.permissionMode;
      let sessionId: string;
      let response: unknown;
      let prompts = 0;
      const servers = acpServers(config.mcpServers);
      const ownServers = Object.keys(config.mcpServers ?? {});
      const release = connection.hold();
      try {
        if (config.resume) {
          const id = config.resume;
          if (!(await options.has(id))) throw new Error("Antigravity doesn't have this session any more.");
          collecting.add(id);
          early.delete(id);
          try {
            response = await connection.request('session/load', { sessionId: id, cwd: config.cwd, mcpServers: servers }, { timeoutMs: 120_000 });
          } finally {
            collecting.delete(id);
          }
          // The replay is the conversation so far: counted, so the next prompt has the transcript's id, and not shown again.
          const replay = early.get(id) ?? [];
          early.delete(id);
          const info = agyReplayInfo(replay);
          prompts = info.prompts;
          if (info.context) events.usage({ contextTokens: info.context.used, contextMax: info.context.size });
          sessionId = id;
        } else {
          response = await connection.request('session/new', { cwd: config.cwd, mcpServers: servers, ...systemAppend(config) });
          const id = str(obj(response).sessionId);
          if (!id) throw new Error('Antigravity started no session');
          sessionId = id;
        }
      } catch (error) {
        release();
        throw startError(error);
      }
      learn(response);
      let sessionOptions: unknown = obj(response).configOptions;
      /** Antigravity's own model and thinking level before Seshboard picked any: what "the default" goes back to. */
      const agentModel = currentValue(sessionOptions, 'model');
      const agentEffort = currentValue(sessionOptions, 'thought_level');
      let loaded = true;
      let closed = false;
      let inFlight = 0;
      let holding: (() => void) | null = release;

      const setOption = async (configId: string, value: string) => {
        const answer = await connection.request('session/set_config_option', { sessionId, configId, value });
        const next = obj(answer).configOptions;
        if (Array.isArray(next)) sessionOptions = next;
      };
      const applyMode = () => connection.request('session/set_mode', { sessionId, modeId: agyModeId(mode, readOnly) });
      const applyModel = async (model: string | null) => {
        const value = model ?? agentModel;
        if (value && value !== currentValue(sessionOptions, 'model')) await setOption('model', value);
      };
      const applyEffort = async (effort: Effort | null) => {
        const value = effort ? agyThoughtLevel(effort, sessionOptions) : agentEffort;
        if (value && value !== currentValue(sessionOptions, 'thought_level')) await setOption('thought_level', value);
      };
      try {
        await applyMode();
        await applyModel(config.model);
        if (config.effort) await applyEffort(config.effort);
      } catch (error) {
        log('warn', `Antigravity: setting up ${sessionId} failed: ${(error as Error).message}`);
      }

      const live = new AgyLive(sessionId, { ...events, title: (title) => options.onTitle?.(sessionId, title) }, prompts, now);
      for (const update of early.get(sessionId) ?? []) live.handle(update);
      early.delete(sessionId);

      /** Requests waiting on a card, by the card's id. */
      const pending = new Map<string, { options: AcpPermissionRequest['options']; resolve: (outcome: AcpPermissionOutcome) => void }>();
      let cards = 0;
      const dropAll = () => {
        for (const [requestId, open] of pending) {
          open.resolve({ outcome: { outcome: 'cancelled' } });
          events.permissionDone(requestId);
        }
        pending.clear();
      };

      running.set(sessionId, {
        update: (update) => live.handle(update),
        permission(request, signal) {
          // Seshboard's own tools (the browser, the orchestrator) go on in every mode, as for Claude Code and Copilot:
          // Antigravity asks for every MCP call, even in Auto. The browser asks for a site that isn't on this computer itself.
          if (isOwnServerTool(agyToolName(request.toolCall), ownServers)) return Promise.resolve(acpOutcome({ behavior: 'allow' }, request.options ?? []));
          const card = agyToolCard(request.toolCall);
          // A read-only session: what only reads goes through, the rest is declined without a card.
          if (readOnly) return Promise.resolve(acpOutcome(isReadOnlyTool(card.toolName, card.input) ? { behavior: 'allow' } : { behavior: 'deny', message: READ_ONLY_STEP_REASON }, request.options ?? []));
          const requestId = `${sessionId}~p${++cards}`;
          let shown: Omit<PermissionRequest, 'sessionId'>;
          try {
            shown = acpPermissionRequest(requestId, request.toolCall, request.options ?? [], card, now());
          } catch (error) {
            log('warn', `Antigravity permission request: ${(error as Error).message}`);
            return Promise.resolve({ outcome: { outcome: 'cancelled' } });
          }
          return new Promise((resolve) => {
            pending.set(requestId, { options: request.options ?? [], resolve });
            signal.addEventListener(
              'abort',
              () => {
                if (!pending.delete(requestId)) return;
                resolve({ outcome: { outcome: 'cancelled' } });
                events.permissionDone(requestId);
              },
              { once: true },
            );
            events.permission(shown);
          });
        },
        crashed() {
          loaded = false;
          inFlight = 0;
          holding = null;
          dropAll();
          live.turnEnded();
          events.state('error', CRASHED);
        },
        letGo() {
          closed = true;
          holding?.();
          holding = null;
          dropAll();
        },
      });

      /** Gone with a crashed process: the session is resumed in the next one (no replay: its prompts are counted). */
      const ensureLoaded = async () => {
        if (loaded) return;
        holding = connection.hold();
        try {
          const resumed = await connection.request('session/resume', { sessionId, cwd: config.cwd, mcpServers: servers });
          sessionOptions = obj(resumed).configOptions ?? sessionOptions;
          loaded = true;
          await applyMode().catch(() => {});
        } catch (error) {
          holding();
          holding = null;
          throw startError(error);
        }
      };

      /** One prompt to the end of its turn: the session goes idle when the last prompt under way is answered. */
      const prompt = (blocks: AcpContentBlock[]) => {
        inFlight++;
        connection
          .request<AcpPromptResponse>('session/prompt', { sessionId, prompt: blocks }, { timeoutMs: null })
          .then(
            (answer) => {
              if (--inFlight > 0 || closed) return;
              live.turnEnded();
              const reason = obj(answer).stopReason;
              if (reason === 'refusal') events.state('error', 'Antigravity refused to go on with this request.');
              else events.state('idle');
            },
            (error: unknown) => {
              if (--inFlight > 0 || closed) return;
              dropAll();
              live.turnEnded();
              // A crash says so on its own (`crashed`).
              if (error instanceof AcpError && (error.code === 'exited' || error.code === 'disposed')) return;
              events.state('error', startError(error).message);
            },
          );
      };

      return {
        sessionId,
        async send(text: string, attachments: readonly ImageAttachment[]) {
          if (closed) throw new Error('This Antigravity session was closed');
          await ensureLoaded();
          const blocks = acpPrompt(text, attachments, config.cwd);
          const n = live.prompted(blocks);
          events.state('running');
          // While a turn runs, Antigravity steers this one into it, and answers the one before at once.
          prompt(blocks);
          return agyPromptId(sessionId, n);
        },
        async setMode(next: PermissionMode) {
          mode = next;
          if (loaded) await applyMode();
        },
        commands: async () => commandList,
        capabilities: async () => agyCapabilities(geminiDir, commandList, loaded),
        async mcp() {
          throw new Error(AGY_MCP_REFUSED);
        },
        async interrupt() {
          dropAll();
          if (loaded && inFlight > 0) connection.notify('session/cancel', { sessionId });
        },
        async setModel(next: string | null) {
          await ensureLoaded();
          await applyModel(next);
        },
        async setEffort(next: Effort | null) {
          await ensureLoaded();
          await applyEffort(next);
        },
        respond(requestId: string, decision: PermissionDecision) {
          const open = pending.get(requestId);
          if (!open) return;
          pending.delete(requestId);
          open.resolve(acpOutcome(decision, open.options));
          events.permissionDone(requestId);
          if (decision.behavior === 'deny' && decision.interrupt && inFlight > 0) connection.notify('session/cancel', { sessionId });
        },
        async close() {
          if (closed) return;
          closed = true;
          dropAll();
          running.delete(sessionId);
          try {
            if (loaded && inFlight > 0) connection.notify('session/cancel', { sessionId });
            if (loaded) await connection.request('session/close', { sessionId }).catch((error: Error) => log('warn', `Antigravity: closing ${sessionId}: ${error.message}`));
          } finally {
            holding?.();
            holding = null;
            loaded = false;
          }
        },
      };
    },

    async dispose() {
      for (const session of running.values()) session.letGo();
      running.clear();
      await connection.dispose();
    },
  };
}
