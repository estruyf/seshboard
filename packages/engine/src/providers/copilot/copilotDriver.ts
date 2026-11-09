import { randomUUID } from 'node:crypto';
import type { Effort, ImageAttachment, ModelOption, PermissionDecision, PermissionMode, ProviderMode, ProviderQuota, RewindResult } from '@seshboard/protocol';
import type { DriverEvents, DriverSession, DriverSessionConfig, DriverStatus, ProviderDriver } from '../provider.ts';
import { backgroundTasks, cannotRewind, effortsOf, rewindOutcome, rewindPreview, rewindProblem, type CopilotTask } from './copilotActions.ts';
import { mentionAttachments, type CopilotFileAttachment } from './copilotAttachments.ts';
import { ASK_TIMEOUT_MS, isReadOnlyTool, READ_ONLY_REASON } from '../../host/sideQuestions.ts';
import type { CopilotEvent } from './copilotEvents.ts';
import { CopilotLive } from './copilotLive.ts';
import { commandList, commandOutcome, parseCommand, type CopilotCommand } from './copilotCommands.ts';
import { copilotCapabilities, type CopilotMcpServer, type CopilotSkill } from './copilotCapabilities.ts';
import { toCopilotDecision, toPermissionRequest } from './copilotPermissions.ts';
import { copilotModel, fusionModels, isTierModel, modelOfChange, withFusion, type CopilotAutoTier } from './copilotFusion.ts';

/** The subset of the Copilot SDK's `CopilotSession` the driver uses (tests fake it). */
export interface CopilotSdkSession {
  readonly sessionId: string;
  on(handler: (event: CopilotEvent) => void): () => void;
  send(options: { prompt: string; attachments?: Array<{ type: 'blob'; data: string; mimeType: string; displayName?: string } | CopilotFileAttachment>; mode?: 'enqueue' | 'immediate' }): Promise<string>;
  abort(): Promise<void>;
  /** The session's RPC: its agent mode (interactive, plan, autopilot) and its slash commands. */
  readonly rpc: {
    mode: { set(params: { mode: CopilotAgentMode }): Promise<unknown> };
    commands: { list(params: Record<string, never>): Promise<{ commands: CopilotCommand[] }>; invoke(params: { name: string; input?: string }): Promise<Record<string, unknown>> };
    mcp: {
      list(): Promise<{ servers: CopilotMcpServer[] }>;
      enable(params: { serverName: string }): Promise<unknown>;
      disable(params: { serverName: string }): Promise<unknown>;
      restartServer(params: { serverName: string }): Promise<unknown>;
    };
    skills: { list(): Promise<{ skills: CopilotSkill[] }> };
    agent: { list(): Promise<{ agents: Array<{ name: string; description?: string; model?: string }> }> };
    /** Its name, as Copilot CLI shows it too. */
    name: { set(params: { name: string }): Promise<unknown> };
    /** Rewinding to before one of your messages, restoring the files Copilot changed since (with file-change tracking). */
    history: {
      listRewindPoints(): Promise<{ fileChangeTrackingEnabled: boolean; unavailableReason?: string; points: Array<{ eventId: string }> }>;
      previewRewind(params: { eventId: string }): Promise<{ available: boolean; reason?: string; files: Array<{ path: string; linesAdded: number; linesRemoved: number }> }>;
      rewind(params: { eventId: string; mode: 'conversation' | 'conversation-and-files' }): Promise<{ outcome: string; restoredFiles: string[]; error?: string }>;
    };
    /** Its shell commands and agents, the ones running in the background among them. */
    tasks: { list(): Promise<{ tasks: CopilotTask[] }>; cancel(params: { id: string }): Promise<{ cancelled: boolean }> };
  };
  /** `autoTier`: one of Auto's routing preferences (Fusion), only with `auto`; null goes back to Auto's default. */
  setModel(model: string, options?: { reasoningEffort?: Effort; autoTier?: string | null }): Promise<void>;
  disconnect(): Promise<void>;
}


type PermissionAnswer = ReturnType<typeof toCopilotDecision> | { kind: 'user-not-available' };

export interface CopilotSessionOptions {
  workingDirectory: string;
  model?: string;
  /** One of Auto's routing preferences (Fusion), with `model: 'auto'`. */
  autoTier?: string;
  reasoningEffort?: Effort;
  streaming: boolean;
  /** Copilot keeps what each turn changed in files, which Rewind restores. */
  enableFileChangeTracking?: boolean;
  /** MCP servers of Seshboard's, besides the user's own (Visuals in replies). */
  mcpServers?: Record<string, { type: 'local'; command: string; args: string[]; env: Record<string, string>; tools: string[] }>;
  /** Seshboard's text after Copilot's own prompt (Skim's marks). */
  systemMessage?: { mode: 'append'; content: string };
  clientName: string;
  onPermissionRequest(request: Record<string, unknown>, invocation: { sessionId: string }): Promise<PermissionAnswer>;
}

/** The subset of the Copilot SDK's `CopilotClient` the driver uses (tests fake it). */
export interface CopilotSdkClient {
  start(): Promise<void>;
  stop(): Promise<unknown>;
  getAuthStatus(): Promise<{ isAuthenticated: boolean; login?: string; statusMessage?: string }>;
  listModels(): Promise<Array<{ id: string; name: string; supportedReasoningEfforts?: string[]; capabilities?: { supports?: { reasoningEffort?: boolean } }; defaultReasoningEffort?: string }>>;
  createSession(options: CopilotSessionOptions): Promise<CopilotSdkSession>;
  resumeSession(sessionId: string, options: CopilotSessionOptions): Promise<CopilotSdkSession>;
  /** The headless `copilot` the SDK started (its locks on sessions are Seshboard's own). */
  readonly cliProcess?: { pid?: number } | null;
  /** Deletes a session for good: only Seshboard's own throwaway forks (Ask), never one of yours (they go to the Trash). */
  deleteSession?(sessionId: string): Promise<void>;
  /**
   * The runtime's RPC: the slash commands a new session has, the account's premium requests, and the sessions on disk
   * (forking one, reading its events without resuming it, which are open in another process).
   */
  readonly rpc?: {
    commands?: { list(): Promise<{ commands: CopilotCommand[] }> };
    /** The account's models, with Auto's routing preferences (Fusion's tiers) on runtimes that have them. */
    models?: { list(params: Record<string, never>): Promise<{ auto?: { tiers: CopilotAutoTier[] } }> };
    account?: { getQuota(params: Record<string, never>): Promise<{ quotaSnapshots: Record<string, CopilotQuotaSnapshot | undefined> }> };
    sessions?: {
      fork(params: { sessionId: string; toEventId?: string; name?: string }): Promise<{ sessionId: string }>;
      readPersistedEvents(params: { sessionId: string; cursor?: string; max?: number }): Promise<{ events: CopilotEvent[]; cursor: string; hasMore: boolean; cursorStatus: string }>;
      checkInUse(params: { sessionIds: string[] }): Promise<{ inUse: string[] }>;
    };
  };
}

/** One of the account's quotas, as the SDK's `account.getQuota` has it. */
export interface CopilotQuotaSnapshot {
  isUnlimitedEntitlement: boolean;
  entitlementRequests: number;
  usedRequests: number;
  remainingPercentage: number;
  resetDate?: string;
}

/** The premium requests of a quota answer, in Seshboard's shape; null when Copilot says nothing about them. */
export function premiumQuota(snapshots: Record<string, CopilotQuotaSnapshot | undefined>): ProviderQuota | null {
  const premium = snapshots.premium_interactions;
  if (!premium) return null;
  const unlimited = premium.isUnlimitedEntitlement || premium.entitlementRequests < 0;
  const percentUsed = unlimited ? 0 : Math.min(100, Math.max(0, 100 - premium.remainingPercentage));
  return { used: Math.max(0, premium.usedRequests), entitlement: unlimited ? null : premium.entitlementRequests, percentUsed, resetsAt: premium.resetDate ?? null };
}

/** Makes the client for the user's `copilot` (the real one loads the SDK; tests pass a fake). */
/** `cliArgs`: what goes before the SDK's own arguments (`node`'s script for npm's install on Windows). */
export type CreateCopilotClient = (options: { cliPath: string; cliArgs?: string[]; env: Record<string, string | undefined> }) => Promise<CopilotSdkClient>;

type CopilotAgentMode = 'interactive' | 'plan' | 'autopilot';

/**
 * Seshboard's permission modes, named as Claude Code's are, mapped to Copilot's agent modes (interactive, plan and
 * autopilot). Accepting edits, and Auto mode's approving everything (Copilot's autopilot with all permissions), are
 * Seshboard answering Copilot's requests itself (`approvesItself`).
 */
export const COPILOT_MODES: ProviderMode[] = [
  { value: 'default', label: 'Ask before edits', description: 'Approve every edit and command' },
  { value: 'acceptEdits', label: 'Accept edits', description: 'File edits apply, commands still ask' },
  { value: 'plan', label: 'Plan mode', description: 'Copilot plans before it changes anything' },
  { value: 'auto', label: 'Auto mode', description: 'Copilot keeps going until the task is done, without asking' },
];

/** Copilot's agent mode for one of Seshboard's. */
export const agentModeOf = (mode: PermissionMode): CopilotAgentMode => (mode === 'plan' ? 'plan' : mode === 'auto' ? 'autopilot' : 'interactive');

/** Requests Seshboard approves without asking in a mode: file reads and edits in Accept edits, everything in Auto mode. */
export function approvesItself(mode: PermissionMode, request: Record<string, unknown>): boolean {
  if (mode === 'auto') return true;
  return mode === 'acceptEdits' && (request.kind === 'write' || request.kind === 'read');
}

/** The name Copilot records for sessions Seshboard starts (`client_name` in `workspace.yaml`). */
export const SESHBOARD_CLIENT = 'seshboard';

/**
 * The real client: the Copilot SDK (loaded on first use), running the user's own `copilot` in headless mode. No token
 * is passed: `copilot` uses its own login (`copilot` then `/login`, or the GitHub CLI's), which Seshboard never sees.
 */
export const sdkCopilotClient: CreateCopilotClient = async ({ cliPath, cliArgs, env }) => {
  const { CopilotClient, RuntimeConnection } = await import('@github/copilot-sdk');
  const clean = Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === 'string'));
  return new CopilotClient({ connection: RuntimeConnection.forStdio({ path: cliPath, ...(cliArgs?.length ? { args: cliArgs } : {}), env: clean }), logLevel: 'error' }) as unknown as CopilotSdkClient;
};

export interface CopilotDriverOptions {
  /** The user's `copilot` (null: not installed), looked up when first needed. */
  binary(): Promise<{ path: string; args?: string[]; version: string | null } | null>;
  /** The environment `copilot` runs with: the login shell's, so its own config and login are found. */
  env(): Promise<Record<string, string | undefined>>;
  createClient?: CreateCopilotClient;
}

/** Copilot's driver, with what the Copilot adapter uses besides `ProviderDriver`: the runtime's sessions on disk. */
export interface CopilotDriver extends ProviderDriver {
  /** The headless `copilot`'s process id, once it runs (its locks on sessions are Seshboard's own). */
  runtimePid(): number | null;
  /** A session's events, read through the runtime without resuming it. Null while the runtime isn't running: it isn't started just to read. */
  readEvents(sessionId: string): Promise<CopilotEvent[] | null>;
  /** Which of `sessionIds` another process has open (Copilot CLI in a terminal). Null while the runtime isn't running. */
  inUse(sessionIds: readonly string[]): Promise<Set<string> | null>;
  /** A new session with `sessionId`'s events before `toEventId` (all of them when null). Returns its id. */
  fork(sessionId: string, toEventId: string | null): Promise<string>;
  /** Renames a session that isn't running here: resumed for the change, then let go. */
  renameSession(sessionId: string, cwd: string, title: string): Promise<void>;
  ask: NonNullable<ProviderDriver['ask']>;
}

/** A session's model in its options: Fusion's tiers are Auto with the tier. */
const modelOptions = (model: string | null | undefined): Pick<CopilotSessionOptions, 'model' | 'autoTier'> => {
  if (!model) return {};
  const { model: id, autoTier } = copilotModel(model);
  return { model: id, ...(autoTier ? { autoTier } : {}) };
};

/** Copilot takes names of 1 to 100 characters. */
const sessionName = (title: string) => title.trim().slice(0, 100);

/** Pages of a persisted read; a session larger than this many is read from its file instead. */
const MAX_PAGES = 500;

const INSTALL = 'Install GitHub Copilot CLI to start Copilot sessions here.';
const SIGN_IN = 'Not signed in to GitHub Copilot CLI. Use Sign in on this profile in Settings › Profiles, or run `copilot login`. Seshboard uses that login.';

/**
 * Starts and steers GitHub Copilot sessions through the Copilot SDK, with one headless `copilot` runtime for all of
 * them (started on first use). Events become Claude Code's shapes (`CopilotLive`), permission requests the permission
 * card's (`copilotPermissions.ts`).
 */
export function copilotDriver(options: CopilotDriverOptions): CopilotDriver {
  const create = options.createClient ?? sdkCopilotClient;
  let client: Promise<CopilotSdkClient> | undefined;
  /** The started client, once it is (for its process id). */
  let started: CopilotSdkClient | null = null;
  const connect = () => {
    client ??= (async () => {
      const binary = await options.binary();
      if (!binary) throw new Error(INSTALL);
      const made = await create({ cliPath: binary.path, ...(binary.args?.length ? { cliArgs: binary.args } : {}), env: await options.env() });
      await made.start();
      started = made;
      return made;
    })().catch((error: unknown) => {
      // Not cached: installing or signing in later should work without restarting Seshboard.
      client = undefined;
      throw error;
    });
    return client;
  };

  return {
    modes: COPILOT_MODES,
    runtimePid: () => started?.cliProcess?.pid ?? null,
    async status(): Promise<DriverStatus> {
      const binary = await options.binary();
      if (!binary) return { binary: null, version: null, signedIn: false, account: null, login: null, problem: INSTALL };
      try {
        const auth = await (await connect()).getAuthStatus();
        const login = auth.isAuthenticated ? (auth.login ?? null) : null;
        return { binary: binary.path, version: binary.version, signedIn: auth.isAuthenticated, account: auth.statusMessage ?? auth.login ?? null, login, problem: auth.isAuthenticated ? null : SIGN_IN };
      } catch (error) {
        return { binary: binary.path, version: binary.version, signedIn: false, account: null, login: null, problem: (error as Error).message };
      }
    },

    async quota(): Promise<ProviderQuota | null> {
      const account = (await connect()).rpc?.account;
      if (!account) return null;
      return premiumQuota((await account.getQuota({})).quotaSnapshots);
    },

    async commands() {
      const listed = await (await connect()).rpc?.commands?.list().catch(() => null);
      return commandList(listed?.commands ?? []);
    },

    async models(): Promise<ModelOption[]> {
      const sdk = await connect();
      // Fusion's tiers come with the model list on newer runtimes; an older one has none, and its models still show.
      const [models, listed] = await Promise.all([sdk.listModels(), sdk.rpc?.models?.list({}).catch(() => null)]);
      const options = models.map((m) => {
        const efforts = effortsOf(m.supportedReasoningEfforts);
        return { value: m.id, displayName: m.name, description: '', supportsEffort: m.capabilities?.supports?.reasoningEffort === true, ...(efforts ? { efforts } : {}) };
      });
      return withFusion(options, fusionModels(listed?.auto?.tiers));
    },

    async readEvents(sessionId) {
      const sessions = started?.rpc?.sessions;
      if (!sessions) return null;
      const events: CopilotEvent[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const read = await sessions.readPersistedEvents({ sessionId, max: 1000, ...(cursor ? { cursor } : {}) });
        // An expired cursor is a read that didn't finish: the file has it whole.
        if (read.cursorStatus !== 'ok') throw new Error(`Copilot couldn't read session ${sessionId} (${read.cursorStatus})`);
        events.push(...read.events);
        if (!read.hasMore) return events;
        cursor = read.cursor;
      }
      throw new Error(`Session ${sessionId} has more events than Seshboard reads through Copilot`);
    },

    async inUse(sessionIds) {
      const sessions = started?.rpc?.sessions;
      if (!sessions) return null;
      if (!sessionIds.length) return new Set();
      // Locks of Copilot's own runtime (Seshboard's) don't count: it answers for the other processes.
      return new Set((await sessions.checkInUse({ sessionIds: [...sessionIds] })).inUse);
    },

    async fork(sessionId, toEventId) {
      const sessions = (await connect()).rpc?.sessions;
      if (!sessions) throw new Error("This version of Copilot CLI can't fork sessions");
      return (await sessions.fork({ sessionId, ...(toEventId ? { toEventId } : {}) })).sessionId;
    },

    async ask({ sessionId, cwd, model, prompt, onText, onFork }) {
      const sdk = await connect();
      const sessions = sdk.rpc?.sessions;
      if (!sessions) throw new Error("This version of Copilot CLI can't fork sessions");
      // A fork of it answers: the session itself, and its conversation, are left alone.
      const { sessionId: forkId } = await sessions.fork({ sessionId });
      onFork(forkId);
      let answer: string | null = null;
      let error: string | undefined;
      let spent = 0;
      let off = () => {};
      try {
        const fork = await sdk.resumeSession(forkId, {
          workingDirectory: cwd,
          ...modelOptions(model),
          streaming: true,
          clientName: SESHBOARD_CLIENT,
          // Only tools that read, by the rule of Claude Code's Ask; the rest is denied without asking anyone.
          onPermissionRequest: async (request) => {
            const asked = toPermissionRequest('ask', request);
            const input = asked.input && typeof asked.input === 'object' && !Array.isArray(asked.input) ? (asked.input as Record<string, unknown>) : {};
            return isReadOnlyTool(asked.toolName, input) ? { kind: 'approve-once' } : toCopilotDecision({ behavior: 'deny', message: READ_ONLY_REASON });
          },
        });
        try {
          const finished = new Promise<void>((resolve) => {
            let turns = 0;
            off = fork.on((event) => {
              const data = (event.data ?? {}) as Record<string, unknown>;
              // Its own subagents' steps aren't the answer.
              if (typeof data.parentToolCallId === 'string') return;
              if (event.type === 'assistant.turn_start' && turns++ > 0) onText({ reset: true });
              else if (event.type === 'assistant.message_delta' && typeof data.deltaContent === 'string') onText({ delta: data.deltaContent });
              else if (event.type === 'assistant.message' && typeof data.content === 'string' && data.content.trim()) answer = data.content;
              else if (event.type === 'assistant.usage' && typeof data.cost === 'number') spent += data.cost;
              else if (event.type === 'session.error') {
                error = typeof data.message === 'string' ? data.message : 'GitHub Copilot stopped with an error';
                resolve();
              } else if (event.type === 'session.idle') resolve();
            });
          });
          await fork.send({ prompt });
          let timer: ReturnType<typeof setTimeout> | undefined;
          const late = new Promise<'late'>((resolve) => (timer = setTimeout(() => resolve('late'), ASK_TIMEOUT_MS)));
          if ((await Promise.race([finished, late])) === 'late') {
            error = 'Copilot took too long to answer';
            await fork.abort().catch(() => {});
          }
          clearTimeout(timer);
        } finally {
          off();
          await fork.disconnect().catch(() => {});
        }
      } finally {
        // The fork was only for this question: it goes, as Claude Code's never stays on disk.
        await sdk.deleteSession?.(forkId).catch(() => {});
      }
      return { answer, ...(error ? { error } : {}), spent };
    },

    async renameSession(sessionId, cwd, title) {
      const session = await (await connect()).resumeSession(sessionId, {
        workingDirectory: cwd,
        streaming: false,
        clientName: SESHBOARD_CLIENT,
        // Nothing runs: it is only resumed to be renamed.
        onPermissionRequest: async () => ({ kind: 'user-not-available' }),
      });
      try {
        await session.rpc.name.set({ name: sessionName(title) });
      } finally {
        await session.disconnect().catch(() => {});
      }
    },

    async start(config: DriverSessionConfig, events: DriverEvents): Promise<DriverSession> {
      const sdk = await connect();
      /** Requests waiting for an answer, with what they asked: a mode that asks less answers them. */
      const pending = new Map<string, { request: Record<string, unknown>; resolve: (answer: PermissionAnswer) => void }>();
      let mode = config.permissionMode;
      /** The model it runs on (null: Copilot's `auto` before it picks one), which an effort change keeps. */
      let model = config.model;
      // A read-only step: Accept edits and Auto mode approve only reads by themselves; every other request is asked.
      // Seshboard's own `visualize` server only draws in the conversation: its tools never ask.
      const ownTool = (request: Record<string, unknown>) => request.kind === 'mcp' && typeof request.serverName === 'string' && config.mcpServers?.[request.serverName] !== undefined;
      const approves = (request: Record<string, unknown>) => ownTool(request) || (approvesItself(mode, request) && (!config.readOnly || request.kind === 'read'));
      const sessionOptions: CopilotSessionOptions = {
        workingDirectory: config.cwd,
        ...modelOptions(config.model),
        ...(config.model && config.effort && !isTierModel(config.model) ? { reasoningEffort: config.effort } : {}),
        streaming: true,
        clientName: SESHBOARD_CLIENT,
        ...(config.mcpServers ? { mcpServers: Object.fromEntries(Object.entries(config.mcpServers).map(([name, server]) => [name, { type: 'local' as const, ...server, tools: ['*'] }])) } : {}),
        // For Rewind. On a resume it starts only when the session still has a baseline: earlier turns can't be restored.
        enableFileChangeTracking: true,
        ...(config.appendSystem ? { systemMessage: { mode: 'append' as const, content: config.appendSystem } } : {}),
        onPermissionRequest: (request) =>
          approves(request)
            ? Promise.resolve<PermissionAnswer>({ kind: 'approve-once' })
            : new Promise<PermissionAnswer>((resolve) => {
                // The SDK hands the request without its id: one of ours, for the card and the answer.
                const requestId = typeof request.requestId === 'string' ? request.requestId : `copilot-${randomUUID()}`;
                pending.set(requestId, { request, resolve });
                events.permission(toPermissionRequest(requestId, request));
              }),
      };
      const session = config.resume ? await sdk.resumeSession(config.resume, sessionOptions) : await sdk.createSession(sessionOptions);
      // Copilot starts interactive: another mode is set before the first message.
      if (agentModeOf(mode) !== 'interactive') await session.rpc.mode.set({ mode: agentModeOf(mode) });
      const live = new CopilotLive(events);
      /** Reads the session's tasks again: the background ones show in the pill and the panel. */
      const refreshTasks = () => {
        if (!events.tasks) return;
        void session.rpc.tasks.list().then(
          (r) => events.tasks?.(backgroundTasks(r.tasks)),
          () => {},
        );
      };
      const off = session.on((event) => {
        live.handle(event);
        // A command, or Auto picking one: the model shown is the one an effort applies to.
        if (event.type === 'session.model_change') model = modelOfChange(event.data) ?? model;
        // Copilot only says that its tasks changed; a turn's end settles the ones it waited for.
        if (event.type === 'session.background_tasks_changed' || event.type === 'session.idle') refreshTasks();
      });
      /** Answers every open request as nobody being there (a stopped turn, a closed session). */
      const dropAll = () => {
        for (const [requestId, { resolve }] of pending) {
          resolve({ kind: 'user-not-available' });
          events.permissionDone(requestId);
        }
        pending.clear();
      };
      /** The session's commands, read once (they change only with plugins and skills). */
      let commands: Promise<CopilotCommand[]> | undefined;
      const sessionCommands = () => (commands ??= session.rpc.commands.list({}).then((r) => r.commands, () => []));
      /** A line in the conversation that isn't Copilot's reply: what you typed, or what a command answered. */
      const line = (role: 'user' | 'assistant', text: string) => ({
        type: role,
        uuid: `copilot-command-${randomUUID()}`,
        parent_tool_use_id: null,
        timestamp: new Date().toISOString(),
        message: { role, content: [{ type: 'text', text }] },
      });
      /** Runs one of Copilot's slash commands: a prompt it makes goes as a turn; words it answers show in the conversation. */
      const runCommand = async (text: string, name: string, input: string): Promise<string> => {
        const result = await session.rpc.commands.invoke({ name, ...(input ? { input } : {}) });
        const outcome = commandOutcome(name, result);
        if (outcome.model) await session.setModel(outcome.model);
        if (outcome.prompt) return session.send({ prompt: outcome.prompt });
        // Copilot doesn't write a command it ran itself to its file: Seshboard keeps these lines for the next read.
        events.messages([line('user', text), ...(outcome.note ? [line('assistant', outcome.note)] : [])], { keep: true });
        // No turn: the session is ready for the next message.
        events.state('idle');
        return 'command';
      };
      return {
        sessionId: session.sessionId,
        commands: async () => commandList(await sessionCommands()),
        async capabilities() {
          // Each list on its own: one Copilot can't give leaves the others.
          const [mcp, skills, agents] = await Promise.all([
            session.rpc.mcp.list().then((r) => r.servers, () => []),
            session.rpc.skills.list().then((r) => r.skills, () => []),
            session.rpc.agent.list().then((r) => r.agents, () => []),
          ]);
          return copilotCapabilities({ mcp, skills, agents });
        },
        async mcp(server, action) {
          const params = { serverName: server };
          await (action === 'enable' ? session.rpc.mcp.enable(params) : action === 'disable' ? session.rpc.mcp.disable(params) : session.rpc.mcp.restartServer(params));
        },
        async send(text: string, attachments: readonly ImageAttachment[], steer?: boolean) {
          const command = !steer && !attachments.length ? parseCommand(text, await sessionCommands()) : null;
          if (command) return runCommand(text, command.name, command.input);
          const blobs = attachments.map((a) => ({ type: 'blob' as const, data: a.data, mimeType: a.mediaType, ...(a.name ? { displayName: a.name } : {}) }));
          // The files and lines the message box (or the VS Code companion) mentions: Copilot reads them as attachments.
          const files = mentionAttachments(text, config.cwd);
          const all = [...blobs, ...files];
          return session.send({ prompt: text, ...(all.length ? { attachments: all } : {}), ...(steer ? { mode: 'immediate' as const } : {}) });
        },
        async setMode(next: PermissionMode) {
          if (agentModeOf(next) !== agentModeOf(mode)) await session.rpc.mode.set({ mode: agentModeOf(next) });
          mode = next;
          // A request asked before the change waits on its card; the new mode answers the ones it approves.
          for (const [requestId, { request, resolve }] of pending) {
            if (!approves(request)) continue;
            pending.delete(requestId);
            resolve({ kind: 'approve-once' });
            events.permissionDone(requestId);
          }
        },
        async interrupt() {
          dropAll();
          await session.abort();
        },
        async setModel(next: string | null) {
          // Copilot's own default is `auto`. The effort goes back to the model's default.
          const { model: id, autoTier } = copilotModel(next ?? 'auto');
          // Leaving a Fusion tier for Auto takes Auto's default routing again; a runtime without tiers is never sent one.
          const tier = autoTier ? { autoTier } : id === 'auto' && isTierModel(model) ? { autoTier: null } : null;
          await session.setModel(id, tier ?? undefined);
          model = next;
        },
        async setEffort(effort: Effort | null) {
          if (!model) throw new Error("Copilot's Auto model has no effort setting. Pick a model first.");
          if (isTierModel(model)) throw new Error('Copilot Fusion picks its own effort. Pick a model to set one.');
          // No effort: the model's own default level, which Copilot doesn't go back to by itself.
          const level = effort ?? effortsOf([(await sdk.listModels()).find((m) => m.id === model)?.defaultReasoningEffort ?? ''])?.[0];
          await session.setModel(model, level ? { reasoningEffort: level } : undefined);
        },
        async rename(title: string) {
          await session.rpc.name.set({ name: sessionName(title) });
        },
        async rewind(messageId: string, dryRun: boolean): Promise<RewindResult> {
          const { points, unavailableReason } = await session.rpc.history.listRewindPoints();
          if (unavailableReason) return cannotRewind(rewindProblem(unavailableReason));
          if (!points.some((p) => p.eventId === messageId)) return cannotRewind("Copilot can't rewind to this message.");
          if (dryRun) return rewindPreview(await session.rpc.history.previewRewind({ eventId: messageId }));
          return rewindOutcome(await session.rpc.history.rewind({ eventId: messageId, mode: 'conversation-and-files' }));
        },
        async stopTask(taskId: string) {
          const { cancelled } = await session.rpc.tasks.cancel({ id: taskId });
          if (!cancelled) throw new Error('Copilot could not stop that task');
          refreshTasks();
        },
        respond(requestId: string, decision: PermissionDecision) {
          const open = pending.get(requestId);
          if (!open) return;
          pending.delete(requestId);
          open.resolve(toCopilotDecision(decision));
          events.permissionDone(requestId);
          if (decision.behavior === 'deny' && decision.interrupt) void session.abort().catch(() => {});
        },
        async close() {
          dropAll();
          off();
          await session.disconnect();
        },
      };
    },

    async dispose() {
      const current = client;
      client = undefined;
      started = null;
      if (current) await (await current.catch(() => null))?.stop();
    },
  };
}
