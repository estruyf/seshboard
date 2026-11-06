import { randomUUID } from 'node:crypto';
import type { Effort, ImageAttachment, LogLevel, ModelOption, PermissionDecision, PermissionMode, PermissionRequest } from '@seshboard/protocol';
import { effortsOf } from '../copilot/copilotActions.ts';
import type { DriverEvents, DriverSession, DriverSessionConfig, DriverStatus, ProviderDriver } from '../provider.ts';
import { AppServerError, type AppServer } from './appServer.ts';
import { codexInput } from './codexInput.ts';
import { CodexLive } from './codexLive.ts';
import { CODEX_MODES, codexModeSettings, sandboxPolicy } from './codexModes.ts';
import { codexAnswer, codexPermissionRequest } from './codexPermissions.ts';
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
  /** One of Codex's requests about this thread; resolves with Codex's answer. */
  request(request: ServerRequest): Promise<unknown>;
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
  const makeLive = options.live ?? ((threadId: string, events: DriverEvents) => new CodexLive(threadId, events));
  const permissions = options.permissions ?? { request: codexPermissionRequest, answer: codexAnswer };
  const messageIdMs = options.messageIdMs ?? MESSAGE_ID_MS;
  const running = new Map<string, Running>();
  /** Codex refused `collaborationMode` once: Plan mode is the read-only sandbox alone from then on. */
  let noPlanMode = false;

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
        for (const session of running.values()) session.crashed();
      }),
    ];
    server.handleRequests(async (request) => {
      const threadId = threadOf(request.params);
      const session = threadId ? running.get(threadId) : undefined;
      // Nothing here asked for it (a thread another client loaded in this process): refused, never answered for you.
      if (!session) throw new Error(`No session in Seshboard for ${request.method}`);
      return session.request(request);
    });
  };
  const unwire = () => {
    for (const off of wired ?? []) off();
    if (wired) server.handleRequests(null);
    wired = null;
  };

  /** The account's models, read once per driver (they change with a Codex update, which restarts the app-server). */
  let models: Promise<Model[]> | undefined;
  const listModels = () =>
    (models ??= (async () => {
      const all: Model[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_MODEL_PAGES; page++) {
        const { data, nextCursor }: { data: Model[]; nextCursor: string | null } = await server.request('model/list', { cursor, includeHidden: false });
        all.push(...data);
        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
      }
      return all;
    })().catch((error: unknown) => {
      // Not kept: signing in later should work without restarting Seshboard.
      models = undefined;
      throw error;
    }));
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
      const open = async (resume: string | null): Promise<ThreadStartResponse> => {
        const { sandbox, approvalPolicy } = settings();
        const common = { cwd: config.cwd, approvalPolicy, sandbox, ...(model ? { model } : {}) };
        const response = resume ? await server.request('thread/resume', { threadId: resume, ...common, excludeTurns: true }) : await server.request('thread/start', common);
        threadModel = response.model ?? threadModel;
        loaded = true;
        // The thread lives in this process: it must not stop for being idle while the session runs here.
        release?.();
        release = server.hold();
        return response;
      };

      const started = await open(config.resume ?? null);
      const threadId = started.thread.id;
      const live = makeLive(threadId, events);

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
          if (notification.method === 'turn/started') turnId = str(obj(params.turn).id) ?? turnId;
          else if (notification.method === 'turn/completed') {
            if (str(obj(params.turn).id) === turnId) turnId = null;
          } else if (notification.method === 'item/started') {
            const item = obj(params.item);
            const name = item.type === 'userMessage' ? naming.get(str(item.clientId) ?? '') : undefined;
            if (name) name(`${str(params.turnId) ?? turnId ?? ''}:${str(item.id) ?? ''}`);
          } else if (notification.method === 'serverRequest/resolved') {
            // Codex is done with it (answered, or the turn ended): nothing waits on it any more. `CodexLive` takes the card away.
            const requestId = String(params.requestId);
            const open = pending.get(requestId);
            pending.delete(requestId);
            open?.resolve(null);
          }
          try {
            live.handle(notification);
          } catch (error) {
            log('warn', `Codex ${notification.method} for ${threadId}: ${(error as Error).message}`);
          }
        },
        request(request) {
          const requestId = String(request.id);
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
            events.permission(card);
          });
        },
        crashed() {
          loaded = false;
          turnId = null;
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
        if (!noPlanMode && planModel && (plan || planSent)) {
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
        try {
          const { turn: started } = await server.request('turn/start', { threadId, input, clientUserMessageId: clientId, ...turn });
          turnId = started.id;
        } catch (error) {
          // Plan mode is experimental: a Codex that refuses it runs the turn in the read-only sandbox alone, from now on.
          if (!turn.collaborationMode || !(error instanceof AppServerError) || error.code !== 'rpc') throw error;
          log('warn', `Codex refused Plan mode (${error.message}): it runs in the read-only sandbox instead`);
          noPlanMode = true;
          const { collaborationMode: _dropped, ...without } = turn;
          const { turn: started } = await server.request('turn/start', { threadId, input, clientUserMessageId: clientId, ...without });
          turnId = started.id;
        }
        planSent = !noPlanMode && settings().plan;
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
          // Gone with a crashed process: the thread is resumed in the next one first.
          if (!loaded) await open(threadId);
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
      for (const session of running.values()) session.letGo();
      running.clear();
      unwire();
      models = undefined;
    },
  };
}
