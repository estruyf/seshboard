import { randomUUID } from 'node:crypto';
import type { Effort, ImageAttachment, LogLevel, ModelOption, PermissionDecision, PermissionMode, PermissionRequest } from '@seshboard/protocol';
import { effortsOf } from '../copilot/copilotActions.ts';
import type { DriverEvents, DriverSession, DriverSessionConfig, DriverStatus, ProviderDriver } from '../provider.ts';
import { AppServerError, type AppServer } from './appServer.ts';
import { codexInput } from './codexInput.ts';
import { codexItemId } from './codexEvents.ts';
import { codexCardId, CodexLive } from './codexLive.ts';
import { CODEX_MODES, codexModeSettings, sandboxPolicy } from './codexModes.ts';
import { codexAnswer, codexPermissionRequest } from './codexPermissions.ts';
import { CodexUsage } from './codexUsage.ts';
import type { CollaborationMode, Model, ServerNotification, ServerRequest, ThreadItem, ThreadStartResponse, TurnStartParams, UserInput } from './protocol.ts';

/** What turns one running thread's notifications into a session's events (`CodexLive`; tests fake it). */
export interface CodexLiveHandler {
  handle(notification: ServerNotification): void;
  /** The latest version of an item still running (a file change's diff, for its card); null once it completed. */
  item?(itemId: string): ThreadItem | null;
}

export interface CodexDriverOptions {
  /** The profile's app-server, shared with reading its sessions. */
  server: AppServer;
  /** Whether `codex` is there and signed in (the adapter's check, `account/read`). */
  status(): Promise<DriverStatus>;
  /** Each running thread's notifications as a session's events. `CodexLive` unless a test brings its own. */
  live?: (threadId: string, events: DriverEvents) => CodexLiveHandler;
  /** Codex's requests as the permission card, and the card's answer back. `codexPermissions.ts` unless a test brings its own. */
  permissions?: { request: typeof codexPermissionRequest; answer: typeof codexAnswer };
  log?: (level: LogLevel, message: string) => void;
  /** How long `send` waits for Codex to name the message it sent (tests shorten it). */
  messageIdMs?: number;
}

/** Codex's driver, with what the adapter needs besides `ProviderDriver`. */
export interface CodexDriver extends ProviderDriver {
  /** The threads running here: their locks are Seshboard's own (`codexInUse.ts`). */
  threads(): Set<string>;
}

/** How long `send` waits for the `userMessage` item that names the message it sent. */
const MESSAGE_ID_MS = 2000;

/** Pages of `model/list` read at most. */
const MAX_MODEL_PAGES = 20;

/** MCP servers in Codex's list read at most, for a read-only thread. */
const MAX_MCP_PAGES = 20;

/** Tries to start a read-only thread with a server left out that Codex says isn't one of the config's. */
const MAX_CONFIG_RETRIES = 10;

/**
 * Codex refusing Plan mode itself, not the turn: `collaborationMode` without the experimental API, or a Codex that
 * doesn't know it or its modes (`-32600`, checked against codex-cli 0.167: "turn/start.collaborationMode requires
 * experimentalApi capability", "unknown variant `plan`").
 */
export function refusesPlanMode(error: unknown): boolean {
  if (!(error instanceof AppServerError) || error.code !== 'rpc' || error.rpcCode !== -32600) return false;
  return /collaborationMode|experimentalApi|unknown variant `(?:plan|default)`/.test(error.message);
}

/**
 * Codex's config for a read-only thread (a pipeline's read-only step): no MCP server at all. With approval `never`,
 * Codex calls MCP tools without asking, and its sandbox doesn't reach them: the only way to keep such a thread from
 * changing things through one is not to start them. A server of a plugin goes with its plugin, ChatGPT's apps with the
 * apps feature, any other by its own `enabled`.
 */
export function noMcpConfig(servers: ReadonlyArray<{ name: string; pluginId: string | null }>, skip: ReadonlySet<string> = new Set()): Record<string, unknown> {
  const plugins: Record<string, { enabled: false }> = {};
  const mcp: Record<string, { enabled: false }> = {};
  for (const { name, pluginId } of servers) {
    if (pluginId) plugins[pluginId] = { enabled: false };
    else if (name !== 'codex_apps' && !skip.has(name)) mcp[name] = { enabled: false };
  }
  return { features: { apps: false }, ...(Object.keys(plugins).length ? { plugins } : {}), ...(Object.keys(mcp).length ? { mcp_servers: mcp } : {}) };
}

/** What a crash says on each session it took down. */
const CRASHED = 'Codex stopped. Send a message to continue the session.';

const obj = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** The thread a notification or a request of Codex's is about. */
const threadOf = (params: unknown): string | null => str(obj(params).threadId) ?? str(obj(obj(params).thread).id);

/** A model of Codex's as the model picker shows it, with the effort levels Seshboard has a name for. */
export function codexModelOption(model: Model): ModelOption {
  const efforts = effortsOf(model.supportedReasoningEfforts?.map((e) => e.reasoningEffort)) ?? [];
  return { value: model.model || model.id, displayName: model.displayName || model.model || model.id, description: model.description ?? '', supportsEffort: efforts.length > 0, ...(efforts.length ? { efforts } : {}) };
}

/** One session running here, as the driver keeps it. */
interface Running {
  threadId: string;
  /** Codex's notification about this thread. */
  notify(notification: ServerNotification): void;
  /** One of Codex's requests about this thread; resolves with Codex's answer. `signal`: Codex no longer waits for it. */
  request(request: ServerRequest, signal: AbortSignal): Promise<unknown>;
  /** The process went: the thread must be resumed in the next one. */
  crashed(): void;
  /** The app quits: lets go of everything, quietly. */
  letGo(): void;
}

/**
 * Runs Codex sessions through the profile's `codex app-server`: `thread/start` or `thread/resume`, then a `turn/start`
 * per message with the mode's sandbox and approval policy (`codexModes.ts`), the model and the effort, set on every
 * turn, so a change applies from the next message. Notifications go through `CodexLive`, Codex's approvals and questions
 * through `codexPermissions.ts`. The sandbox does what Copilot's driver does by answering requests itself: Seshboard
 * answers none of Codex's on its own. Signing in stays Codex's own.
 */
export function codexDriver(options: CodexDriverOptions): CodexDriver {
  const { server } = options;
  const log = options.log ?? (() => {});
  // Cards are named by thread and Codex's request id: Codex numbers its requests from 0 in each process.
  const makeLive = options.live ?? ((threadId: string, events: DriverEvents) => new CodexLive(threadId, events, { requestId: (id) => codexCardId(threadId, id) }));
  const permissions = options.permissions ?? { request: codexPermissionRequest, answer: codexAnswer };
  const messageIdMs = options.messageIdMs ?? MESSAGE_ID_MS;
  const running = new Map<string, Running>();
  /**
   * The app-server process (by pid) that refused `collaborationMode`: Plan mode is the read-only sandbox alone while it
   * runs. Another process (Codex updated, restarted) is asked again.
   */
  let refusedPlanIn: number | null | undefined;
  const noPlanMode = () => refusedPlanIn !== undefined && refusedPlanIn === server.pid();

  // Wired once, on the first session: the server is the profile's, shared with reading its sessions.
  let wired: Array<() => void> | null = null;
  const wire = () => {
    if (wired) return;
    wired = [
      server.onNotification((notification) => {
        const threadId = threadOf(notification.params);
        const session = threadId ? running.get(threadId) : undefined;
        session?.notify(notification);
      }),
      server.onExit(() => {
        // The next process may be another Codex: its models are read again.
        models = undefined;
        for (const session of running.values()) session.crashed();
      }),
    ];
    server.handleRequests(async (request, signal) => {
      const threadId = threadOf(request.params);
      const session = threadId ? running.get(threadId) : undefined;
      // Nothing here asked for it (a thread another client loaded in this process): refused, never answered for you.
      if (!session) throw new Error(`No session in Seshboard for ${request.method}`);
      return session.request(request, signal);
    });
  };
  const unwire = () => {
    for (const off of wired ?? []) off();
    if (wired) server.handleRequests(null);
    wired = null;
  };

  /** The account's models, read once per app-server process (they change with a Codex update, which restarts it). */
  let models: Promise<Model[]> | undefined;
  let modelsIn: number | null = null;
  const listModels = () => {
    if (models && modelsIn !== null && modelsIn !== server.pid()) models = undefined;
    return (models ??= (async () => {
      const all: Model[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_MODEL_PAGES; page++) {
        const { data, nextCursor }: { data: Model[]; nextCursor: string | null } = await server.request('model/list', { cursor, includeHidden: false });
        all.push(...data);
        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
      }
      modelsIn = server.pid();
      return all;
    })().catch((error: unknown) => {
      // Not kept: signing in later should work without restarting Seshboard.
      models = undefined;
      throw error;
    }));
  };
  /** Codex's MCP servers, for a read-only thread's config. */
  const mcpServers = async () => {
    const all: Array<{ name: string; pluginId: string | null }> = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_MCP_PAGES; page++) {
      const { data, nextCursor }: { data: Array<{ name: string; pluginId: string | null }>; nextCursor: string | null } = await server.request('mcpServerStatus/list', { cursor });
      all.push(...data);
      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }
    return all;
  };
  // The account's rate limits as plan usage: read when asked, and kept up to date from Codex's rolling updates, which
  // come without a thread while any of its sessions runs. Listened to from the first ask: until then nothing of the
  // server is made.
  const usage = new CodexUsage({ read: () => server.request('account/rateLimits/read', { excludeResetCreditDetails: true }) });
  let offUsage: (() => void) | null = null;
  const followUsage = () => {
    offUsage ??= server.onNotification((notification) => {
      if (notification.method === 'account/rateLimits/updated') usage.update(notification.params);
    });
    return usage;
  };

  const defaultModel = async () => (await listModels().catch(() => [])).find((m) => m.isDefault) ?? null;
  const defaultEffort = async (model: string | null) => {
    const models = await listModels().catch(() => []);
    const found = model ? models.find((m) => m.model === model || m.id === model) : models.find((m) => m.isDefault);
    return found?.defaultReasoningEffort ?? null;
  };

  return {
    modes: CODEX_MODES,

    threads: () => new Set(running.keys()),

    status: () => options.status(),

    planUsage: (refresh) => followUsage().get(refresh),

    onPlanUsage: (listener) => followUsage().onChange(listener),

    async models() {
      return (await listModels()).filter((m) => !m.hidden).map(codexModelOption);
    },

    // Codex's slash commands are its TUI's: none goes through the app-server as a command.
    commands: async () => [],

    async start(config: DriverSessionConfig, events: DriverEvents): Promise<DriverSession> {
      wire();
      let mode: PermissionMode = config.permissionMode;
      /** What Seshboard asked for (null: Codex's default), and whether a change is still to go with the next turn. */
      let model = config.model;
      let effort: Effort | null = config.effort ?? null;
      let modelChanged = false;
      let effortChanged = false;
      /** The model Codex runs it on, which Plan mode names (`collaborationMode.settings.model` is required). */
      let threadModel: string | null = null;
      /** Plan mode went with the last turn: leaving it says so once. */
      let planSent = false;
      /** The turn under way, which steering and Stop name. */
      let turnId: string | null = null;
      /** A `turn/start` waits for its answer: Stop pressed meanwhile waits for the turn's id (`stopAsked`). */
      let starting = false;
      let stopAsked = false;
      /** It crashed: the next message resumes it, with a new `CodexLive` (the old one's running items are gone). */
      let crashed = false;
      /** Loaded in the app-server process now; false after a crash, until the next message resumes it. */
      let loaded = false;
      let release: (() => void) | null = null;
      let closed = false;
      /**
       * Codex's requests waiting on a card, by the card's id: Codex's own request id, which `CodexLive` takes the card
       * away by when Codex says the request is resolved (`serverRequest/resolved`).
       */
      const pending = new Map<string, { request: ServerRequest; resolve: (answer: unknown) => void; reject: (error: Error) => void }>();
      /** Sends the card's decision back; an answer Codex can't take refuses the request. */
      const answer = (open: { request: ServerRequest; resolve: (answer: unknown) => void; reject: (error: Error) => void }, decision: PermissionDecision) => {
        let reply: unknown = null;
        try {
          reply = permissions.answer(open.request, decision);
        } catch (error) {
          log('warn', `Codex ${open.request.method}: ${(error as Error).message}`);
        }
        if (reply === null || reply === undefined) open.reject(new Error(`Seshboard can't answer ${open.request.method} that way`));
        else open.resolve(reply);
      };
      /** Messages sent, waiting for the `userMessage` item that names them (by `clientUserMessageId`). */
      const naming = new Map<string, (id: string) => void>();

      const settings = () => codexModeSettings(mode, config.readOnly === true);
      /** Starts or resumes the thread; a read-only one without MCP servers (`noMcpConfig`). */
      const open = async (resume: string | null): Promise<ThreadStartResponse> => {
        const { sandbox, approvalPolicy } = settings();
        const common = { cwd: config.cwd, approvalPolicy, sandbox, ...(model ? { model } : {}) };
        const request = (extra: { config?: Record<string, unknown> }) =>
          resume ? server.request('thread/resume', { threadId: resume, ...common, ...extra, excludeTurns: true }) : server.request('thread/start', { ...common, ...extra });
        let response: ThreadStartResponse | undefined;
        if (config.readOnly) {
          const servers = await mcpServers().catch((error: Error) => {
            throw new Error(`Codex didn't list its MCP servers, so a read-only session can't start without them: ${error.message}`);
          });
          const skip = new Set<string>();
          for (let attempt = 0; !response; attempt++) {
            try {
              response = await request({ config: noMcpConfig(servers, skip) });
            } catch (error) {
              // A server Codex lists that isn't one of its config's (a built-in): its `enabled` is no setting to change.
              const named = error instanceof AppServerError && error.code === 'rpc' ? /in `mcp_servers\.([^`.]+)`/.exec(error.message)?.[1] : undefined;
              if (!named || skip.has(named) || attempt >= MAX_CONFIG_RETRIES) throw error;
              skip.add(named);
            }
          }
        } else response = await request({});
        threadModel = response.model ?? threadModel;
        loaded = true;
        // The thread lives in this process: it must not stop for being idle while the session runs here.
        release?.();
        release = server.hold();
        return response;
      };

      const started = await open(config.resume ?? null);
      const threadId = started.thread.id;
      let live = makeLive(threadId, events);
      /** The turn's id is known now: a Stop pressed while it started goes out. */
      const turnKnown = (id: string) => {
        turnId = id;
        if (!stopAsked) return;
        stopAsked = false;
        void server.request('turn/interrupt', { threadId, turnId: id }).catch((error: Error) => log('warn', `Stopping ${threadId}: ${error.message}`));
      };

      /** Answers every open request as declined (a stopped turn, a closed session, a crash) and takes its card away. */
      const dropAll = () => {
        for (const [requestId, open] of pending) {
          answer(open, { behavior: 'deny', message: 'The turn was stopped.' });
          events.permissionDone(requestId);
        }
        pending.clear();
      };

      const session: Running = {
        threadId,
        notify(notification) {
          const params = obj(notification.params);
          if (notification.method === 'turn/started') {
            const id = str(obj(params.turn).id);
            if (id) turnKnown(id);
          } else if (notification.method === 'turn/completed') {
            if (str(obj(params.turn).id) === turnId) turnId = null;
            stopAsked = false;
          } else if (notification.method === 'item/started') {
            const item = obj(params.item);
            const name = item.type === 'userMessage' ? naming.get(str(item.clientId) ?? '') : undefined;
            const itemId = str(item.id);
            const itemTurn = str(params.turnId) ?? turnId;
            if (name && itemId && itemTurn) name(codexItemId(itemTurn, itemId));
          }
          try {
            live.handle(notification);
          } catch (error) {
            log('warn', `Codex ${notification.method} for ${threadId}: ${(error as Error).message}`);
          }
        },
        request(request, signal) {
          const requestId = codexCardId(threadId, request.id);
          let card: Omit<PermissionRequest, 'sessionId'> | null;
          try {
            // A file change's card shows its diff, from the item as it is now.
            const itemId = str(obj(request.params).itemId);
            card = permissions.request(requestId, request, itemId ? (live.item?.(itemId) ?? null) : null);
          } catch (error) {
            log('warn', `Codex ${request.method}: ${(error as Error).message}`);
            card = null;
          }
          // One Seshboard can't show is refused: Codex then goes on without it, or says it can't.
          if (!card) return Promise.reject(new Error(`Seshboard can't answer ${request.method}`));
          return new Promise((resolve, reject) => {
            pending.set(requestId, { request, resolve, reject });
            // Codex is done with it (answered elsewhere, the turn ended, the process went): the card goes.
            signal.addEventListener(
              'abort',
              () => {
                if (!pending.delete(requestId)) return;
                resolve(null);
                events.permissionDone(requestId);
              },
              { once: true },
            );
            events.permission(card);
          });
        },
        crashed() {
          loaded = false;
          crashed = true;
          turnId = null;
          starting = false;
          stopAsked = false;
          release?.();
          release = null;
          dropAll();
          for (const name of naming.values()) name('');
          events.state('error', CRASHED);
        },
        letGo() {
          closed = true;
          release?.();
          release = null;
          dropAll();
        },
      };
      running.set(threadId, session);

      /** The mode's settings, the model and the effort, as each turn takes them. */
      const turnSettings = async (): Promise<Omit<TurnStartParams, 'threadId' | 'input'>> => {
        const { sandbox, approvalPolicy, plan } = settings();
        const out: Omit<TurnStartParams, 'threadId' | 'input'> = { approvalPolicy, sandboxPolicy: sandboxPolicy(sandbox) };
        // Back to Codex's default model (and that model's default effort) is a model of its own to send.
        if (model) out.model = model;
        else if (modelChanged) out.model = (await defaultModel())?.model ?? null;
        if (effort) out.effort = effort;
        else if (effortChanged || modelChanged) out.effort = await defaultEffort(out.model ?? model ?? threadModel);
        if (out.model === null) delete out.model;
        if (out.effort === null) delete out.effort;
        const planModel = out.model ?? model ?? threadModel;
        if (!noPlanMode() && planModel && (plan || planSent)) {
          const collaborationMode: CollaborationMode = { mode: plan ? 'plan' : 'default', settings: { model: planModel, reasoning_effort: out.effort ?? effort ?? null, developer_instructions: null } };
          out.collaborationMode = collaborationMode;
        }
        return out;
      };

      /** Waits for Codex to name the message, as the transcript names it; its own id when Codex doesn't say in time. */
      const nameOf = (clientId: string) =>
        new Promise<string>((resolve) => {
          const timer = setTimeout(() => done(''), messageIdMs);
          const done = (id: string) => {
            clearTimeout(timer);
            naming.delete(clientId);
            resolve(id || clientId);
          };
          naming.set(clientId, done);
        });

      const startTurn = async (input: UserInput[], clientId: string) => {
        const turn = await turnSettings();
        starting = true;
        try {
          let started: { id: string };
          try {
            ({ turn: started } = await server.request('turn/start', { threadId, input, clientUserMessageId: clientId, ...turn }));
          } catch (error) {
            // Plan mode is experimental: a Codex that refuses it runs the turn in the read-only sandbox alone, in this process.
            if (!turn.collaborationMode || !refusesPlanMode(error)) throw error;
            const { collaborationMode: _dropped, ...without } = turn;
            // Only a turn that then starts shows it was Plan mode Codex refused.
            ({ turn: started } = await server.request('turn/start', { threadId, input, clientUserMessageId: clientId, ...without }));
            refusedPlanIn = server.pid();
            log('warn', `Codex refused Plan mode (${(error as Error).message}): it runs in the read-only sandbox instead`);
          }
          turnKnown(started.id);
        } finally {
          starting = false;
        }
        planSent = !noPlanMode() && settings().plan;
        modelChanged = false;
        effortChanged = false;
      };

      return {
        sessionId: threadId,
        commands: async () => [],
        // Codex's MCP servers, skills and agents come with Phase 3 of #276.
        capabilities: async () => ({ live: true, mcp: [], agents: [], commands: [], plugins: [] }),
        async mcp() {
          throw new Error("Codex's MCP servers can't be changed from Seshboard yet");
        },
        async send(text: string, attachments: readonly ImageAttachment[], steer?: boolean) {
          if (closed) throw new Error('This Codex session was closed');
          // Gone with a crashed process: the thread is resumed in the next one first, read by a new `CodexLive`.
          if (!loaded) {
            await open(threadId);
            if (crashed) live = makeLive(threadId, events);
            crashed = false;
          }
          const input = codexInput(text, attachments, config.cwd);
          const clientId = randomUUID();
          const named = nameOf(clientId);
          try {
            if (steer && turnId) {
              try {
                await server.request('turn/steer', { threadId, input, expectedTurnId: turnId, clientUserMessageId: clientId });
              } catch (error) {
                // The turn ended meanwhile: the message starts the next one.
                if (!(error instanceof AppServerError) || error.code !== 'rpc') throw error;
                await startTurn(input, clientId);
              }
            } else await startTurn(input, clientId);
          } catch (error) {
            naming.get(clientId)?.('');
            throw error;
          }
          return named;
        },
        async setMode(next: PermissionMode) {
          // The sandbox and approval policy go with each turn: the next message runs in the new mode.
          mode = next;
        },
        async interrupt() {
          dropAll();
          if (turnId && loaded) await server.request('turn/interrupt', { threadId, turnId });
          // Sent a moment ago: Codex hasn't named the turn yet. It stops as soon as it does.
          else if (starting) stopAsked = true;
        },
        async setModel(next: string | null) {
          model = next;
          modelChanged = true;
          // Another model starts on its own default effort.
          effort = null;
          effortChanged = true;
        },
        async setEffort(next: Effort | null) {
          effort = next;
          effortChanged = true;
        },
        respond(requestId: string, decision: PermissionDecision) {
          const open = pending.get(requestId);
          if (!open) return;
          pending.delete(requestId);
          answer(open, decision);
          events.permissionDone(requestId);
          if (decision.behavior === 'deny' && decision.interrupt && turnId && loaded) void server.request('turn/interrupt', { threadId, turnId }).catch(() => {});
        },
        async close() {
          if (closed) return;
          closed = true;
          dropAll();
          running.delete(threadId);
          try {
            if (loaded && turnId) await server.request('turn/interrupt', { threadId, turnId }).catch((error: Error) => log('warn', `Stopping ${threadId}: ${error.message}`));
            else if (starting) stopAsked = true;
            if (loaded) await server.request('thread/unsubscribe', { threadId });
          } finally {
            release?.();
            release = null;
            loaded = false;
            if (!running.size) unwire();
          }
        },
      };
    },

    async dispose() {
      offUsage?.();
      offUsage = null;
      for (const session of running.values()) session.letGo();
      running.clear();
      unwire();
      models = undefined;
    },
  };
}
