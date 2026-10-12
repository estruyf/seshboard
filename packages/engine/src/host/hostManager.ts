import { randomUUID } from 'node:crypto';
import type { CanUseTool, Options, PermissionResult, PermissionUpdate, Query, SDKUserMessage, WarmQuery } from '@anthropic-ai/claude-agent-sdk';
import {
  RpcError,
  type Capabilities,
  type ContextUsage,
  type Effort,
  type ImageAttachment,
  type LogLevel,
  type ModelOption,
  type PermissionDecision,
  type PermissionMode,
  type PermissionRequest,
  type PluginInfo,
  type RewindResult,
  type SessionHostInfo,
  type SlashCommand,
  type StreamDelta,
  type WorktreeRequest,
} from '@switchboard/protocol';
import { clipJson } from '../claude/transcript.ts';
import type { RawSessionMessage } from '../claude/transcript.ts';
import { describeSuggestions } from './permissions.ts';
import { readCapabilities } from './capabilities.ts';
import { buildOptions, SessionHost, toModelOption, type HostConfig, type StartQuery } from './sessionHost.ts';
import { createMemorySessionSettings, type SessionSettingsStore } from './sessionSettings.ts';

/** The two SDK entry points the manager needs; injected so tests can fake Claude Code. */
export interface SdkRuntime {
  query(args: { prompt: AsyncIterable<SDKUserMessage>; options: Options }): Query;
  startup(args: { options: Options }): Promise<WarmQuery>;
}

export interface HostManagerDeps {
  sdk: () => Promise<SdkRuntime>;
  /** The full login-shell environment for Claude Code processes, pointed at a profile's config folder. */
  env: (profileId: string) => Promise<Record<string, string>>;
  claudePath: () => Promise<string | undefined>;
  /** True when a Claude Code process outside this app has the session open. */
  isOpenElsewhere: (sessionId: string) => boolean;
  /** Re-reads the live registry now (instead of waiting for the next poll). */
  refreshLive?: () => void;
  /** The folder a session ran in (resumes must start there, or tools act in the wrong place). */
  sessionCwd: (sessionId: string) => string | null;
  /** The profile a session was created with (resumes and forks must use the same login). */
  sessionProfile: (sessionId: string) => string;
  onInfo: (info: SessionHostInfo) => void;
  onStream: (delta: StreamDelta) => void;
  onMessages: (sessionId: string, messages: RawSessionMessage[]) => void;
  onPermission: (request: PermissionRequest) => void;
  onPermissionResolved: (requestId: string, sessionId: string) => void;
  /** A session this app created (for the "Switchboard" origin badge). */
  onCreated: (sessionId: string) => void;
  /** You sent a message to an existing session from this app (it now counts as a Switchboard session). */
  onContinued?: (sessionId: string) => void;
  log: (level: LogLevel, message: string) => void;
  /** Close processes idle for longer than this (default 30 min). The transcript stays; sending resumes. */
  idleTimeoutMs?: number;
  /** Discard an unused pre-warmed process after this long (default 2 min). */
  warmTtlMs?: number;
  /** Plan usage of this profile probably changed. */
  onUsageHint?: (profileId: string) => void;
  /** A session's turn reported where a plan window stands (Claude Code's `rate_limit_event`). */
  onRateLimit?: (profileId: string, sessionId: string, info: { rateLimitType?: string; utilization?: number; resetsAt?: number }) => void;
  /** Helper processes register in the live registry while they run; the engine hides them. */
  ephemeral?: { add(sessionId: string): void; delete(sessionId: string): void };
  /** A profile's installed plugins, for sessions that aren't running (their own list comes from Claude Code). */
  installedPlugins?: (profileId: string) => PluginInfo[];
  /** What each session last ran with; without it, resumes only remember it until the engine restarts. */
  sessionSettings?: SessionSettingsStore;
  /** The model list saved last time, until Claude Code reports a fresh one. */
  models?: ModelOption[] | null;
  /** Claude Code reported a (new) model list. */
  onModels?: (models: ModelOption[]) => void;
  /**
   * Persisted command lists per profile and folder, so the palette is instant after a restart.
   * `forget` drops every list of a profile (a skill was added or removed).
   */
  commandCache?: { get(key: CommandKey): SlashCommand[] | null; set(key: CommandKey, commands: SlashCommand[]): void; forget(profileId: string): void };
}

/** Command lists differ per folder (project commands) and per profile (user commands, skills, plugins). */
export interface CommandKey {
  profileId: string;
  cwd: string;
}
const keyOf = ({ profileId, cwd }: CommandKey) => `${profileId}\0${cwd}`;

/** Commands that only work in the terminal UI; Claude Code reports more at init. */
const TERMINAL_ONLY = new Set(['doctor', 'color', 'focus', 'reload-plugins']);

interface Pending {
  request: PermissionRequest;
  input: Record<string, unknown>;
  suggestions: PermissionUpdate[] | undefined;
  resolve: (result: PermissionResult) => void;
}

interface Warm {
  cwd: string;
  profileId: string;
  sessionId: string;
  warm: Promise<WarmQuery>;
  /** canUseTool is fixed at startup, so it forwards to whichever host adopts this process. */
  route: { canUseTool: CanUseTool | null };
  timer: ReturnType<typeof setTimeout>;
}

export interface CreateParams {
  cwd: string;
  /** The Claude profile (login) to run with. */
  profileId: string;
  prompt: string;
  attachments: ImageAttachment[];
  model: string | null;
  permissionMode: PermissionMode;
  effort: Effort | null;
  worktree: WorktreeRequest | null;
  /**
   * Runs after Claude Code has started (and created the worktree) but before
   * the first message, e.g. setup actions. Failures are logged; the message still goes.
   */
  beforeFirstMessage?: (sessionId: string) => Promise<void>;
}

const DEFAULT_MODELS: ModelOption[] = [
  { value: 'default', displayName: 'Default', description: 'Your Claude Code default', supportsEffort: true },
  { value: 'opus', displayName: 'Opus', description: 'Most capable', supportsEffort: true },
  { value: 'sonnet', displayName: 'Sonnet', description: 'Fast and capable', supportsEffort: true },
  { value: 'haiku', displayName: 'Haiku', description: 'Fastest', supportsEffort: false },
];

/** Owns every Claude Code process this app runs, and brokers their permission prompts. */
export class HostManager {
  private readonly hosts = new Map<string, SessionHost>();
  private readonly pending = new Map<string, Pending>();
  private readonly commandsByCwd = new Map<string, SlashCommand[]>();
  private models: ModelOption[] = DEFAULT_MODELS;
  private warm: Warm | undefined;
  /** When this app stopped a session's process; its registry entry lingers until the process exits. */
  private readonly closedAt = new Map<string, number>();
  /**
   * What each session last ran with. Claude Code resumes in its own defaults (and the project's), so a
   * resume after Stop, the idle reaper, a rewind or an app restart would otherwise drop back to them.
   */
  private readonly settings: SessionSettingsStore;
  /** The mode last saved per session, so info updates don't write to the database every time. */
  private readonly lastMode = new Map<string, PermissionMode>();
  private readonly reaper: ReturnType<typeof setInterval>;

  constructor(private readonly deps: HostManagerDeps) {
    this.settings = deps.sessionSettings ?? createMemorySessionSettings();
    if (deps.models?.length) this.models = deps.models;
    this.reaper = setInterval(() => this.reapIdle(), 60_000);
    this.reaper.unref?.();
  }

  list(): { hosts: SessionHostInfo[]; permissions: PermissionRequest[] } {
    return {
      hosts: [...this.hosts.values()].map((h) => h.info),
      permissions: [...this.pending.values()].map((p) => p.request),
    };
  }

  has(sessionId: string): boolean {
    return this.hosts.get(sessionId)?.active ?? false;
  }

  async create(params: CreateParams): Promise<string> {
    const warm = this.takeWarm(params);
    const sessionId = warm?.sessionId ?? randomUUID();
    const host = await this.spawn(
      {
        sessionId,
        cwd: params.cwd,
        profileId: params.profileId,
        mode: 'new',
        model: params.model,
        permissionMode: params.permissionMode,
        effort: params.effort,
        worktree: params.worktree,
      },
      warm,
    );
    this.deps.onCreated(sessionId);
    if (params.model || params.effort) this.settings.set(sessionId, { model: params.model, effort: params.effort });
    if (warm) {
      // The warm process started with defaults; apply this session's choices before the first message.
      if (params.model) await host.setModel(params.model).catch(() => {});
      if (params.permissionMode !== 'default') await host.setPermissionMode(params.permissionMode).catch(() => {});
    }
    if (params.beforeFirstMessage) {
      // Return the id now, so the window can show the session (and its setup terminals) right away.
      const before = params.beforeFirstMessage;
      void before(sessionId)
        .catch((error: Error) => this.deps.log('warn', `Worktree setup failed: ${error.message}`))
        .then(() => host.active && host.send(params.prompt, params.attachments));
    } else {
      host.send(params.prompt, params.attachments);
    }
    return sessionId;
  }

  /** Resumes that are starting, so a second send while the first is still starting joins it instead of starting another process. */
  private readonly starting = new Map<string, Promise<SessionHost>>();

  /** The running host for a session, resuming it (or starting a fork) when it isn't running here. */
  private ensureHost(sessionId: string, fork: boolean, busyMessage: string): Promise<SessionHost> {
    if (fork) return this.startHost(sessionId, true, busyMessage);
    const running = this.hosts.get(sessionId);
    if (running?.active) return Promise.resolve(running);
    let pending = this.starting.get(sessionId);
    if (!pending) {
      pending = this.startHost(sessionId, false, busyMessage).finally(() => this.starting.delete(sessionId));
      this.starting.set(sessionId, pending);
    }
    return pending;
  }

  private async startHost(sessionId: string, fork: boolean, busyMessage: string): Promise<SessionHost> {
    if (!fork && this.deps.isOpenElsewhere(sessionId) && this.recentlyClosed(sessionId)) {
      await this.waitForExit(sessionId);
    }
    if (!fork && this.deps.isOpenElsewhere(sessionId)) throw new RpcError('SESSION_BUSY_ELSEWHERE', busyMessage);
    const cwd = this.deps.sessionCwd(sessionId);
    if (!cwd) throw new RpcError('NOT_FOUND', 'Unknown session, or its folder is not recorded');
    const profileId = this.deps.sessionProfile(sessionId);
    const saved = this.settings.get(sessionId);
    const permissionMode = this.lastMode.get(sessionId) ?? saved?.permissionMode ?? 'default';
    const model = saved?.model ?? null;
    const effort = saved?.effort ?? null;
    const common = { cwd, profileId, model, permissionMode, effort, worktree: null };
    // A fork gets its own id up front, so it is never stored or reported under the original's id
    // (which would show the original as starting, or replace it in the map while it runs here).
    if (fork) return this.spawn({ ...common, sessionId: randomUUID(), forkFrom: sessionId, mode: 'fork' });
    return this.spawn({ ...common, sessionId, mode: 'resume' });
  }

  /**
   * Sends a message. `now`: while Claude is busy, its current turn is stopped first, so this message (and
   * any sent before it that still wait, which survive an interrupt) runs right away instead of after it.
   */
  async send(params: { sessionId: string; text: string; attachments: ImageAttachment[]; fork: boolean; now?: boolean }): Promise<{ sessionId: string; messageUuid: string }> {
    const host = await this.ensureHost(params.sessionId, params.fork, 'This session is open in another Claude Code window. Fork it to continue here.');
    if (params.now && !params.fork && (host.info.state === 'running' || host.info.state === 'needs-you')) await this.interrupt(host.sessionId);
    const messageUuid = host.send(params.text, params.attachments);
    // Wait for a fork to start, so a fork that fails says so, and in case Claude Code settled on another id than the one we gave it.
    const sessionId = params.fork ? await host.initialized : host.sessionId;
    if (params.fork) {
      this.deps.onCreated(sessionId);
      // A fork carries on with the model and effort picked for the original.
      const saved = this.settings.get(params.sessionId);
      if (saved?.model || saved?.effort) this.settings.set(sessionId, { model: saved.model, effort: saved.effort });
    } else this.deps.onContinued?.(sessionId);
    return { sessionId, messageUuid };
  }

  /**
   * Restores files to how they were before one of your messages. `dryRun` only reports what would change.
   * Needs the session's process, so it is resumed here if it isn't running (not while open elsewhere).
   */
  async rewind(sessionId: string, userMessageId: string, dryRun: boolean): Promise<RewindResult> {
    const host = await this.ensureHost(sessionId, false, 'This session is open in another Claude Code window. Close it there to rewind its files.');
    if (host.info.state === 'running' || host.info.state === 'needs-you') {
      throw new RpcError('SESSION_BUSY', 'Claude is working in this session. Stop it first, then rewind.');
    }
    try {
      return await host.rewindFiles(userMessageId, dryRun);
    } catch (error) {
      throw new RpcError('REWIND_FAILED', (error as Error).message);
    }
  }

  async interrupt(sessionId: string): Promise<void> {
    // Pending prompts would otherwise keep the turn alive after the interrupt.
    for (const [requestId, pending] of this.pending) {
      if (pending.request.sessionId === sessionId) this.settle(requestId, { behavior: 'deny', message: 'Interrupted by the user.', interrupt: true });
    }
    await this.require(sessionId).interrupt();
  }

  stopTask(sessionId: string, taskId: string): Promise<void> {
    return this.require(sessionId).stopTask(taskId);
  }

  setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    return this.require(sessionId).setPermissionMode(mode);
  }

  async setEffort(sessionId: string, effort: Effort | null): Promise<void> {
    await this.require(sessionId).setEffort(effort);
    this.settings.set(sessionId, { effort });
  }

  async context(sessionId: string): Promise<ContextUsage> {
    try {
      return await this.require(sessionId).contextUsage();
    } catch (error) {
      if (error instanceof RpcError) throw error;
      throw new RpcError('CONTEXT_FAILED', (error as Error).message);
    }
  }

  async setModel(sessionId: string, model: string | null): Promise<void> {
    await this.require(sessionId).setModel(model);
    this.settings.set(sessionId, { model });
  }

  close(sessionId: string): void {
    const host = this.hosts.get(sessionId);
    if (host?.active) this.closedAt.set(sessionId, Date.now());
    host?.close();
    for (const [requestId, pending] of this.pending) {
      if (pending.request.sessionId === sessionId) this.settle(requestId, { behavior: 'deny', message: 'Session closed.' });
    }
  }

  /** Stops a session this app runs (if it does) and waits for its process to leave the registry. */
  async release(sessionId: string): Promise<void> {
    if (!this.has(sessionId)) return;
    this.close(sessionId);
    await this.waitForExit(sessionId);
  }

  respond(requestId: string, decision: PermissionDecision): void {
    const pending = this.pending.get(requestId);
    if (!pending) throw new RpcError('NOT_FOUND', 'This request was already answered or cancelled');
    if (decision.behavior === 'allow') {
      const result: PermissionResult = {
        behavior: 'allow',
        updatedInput: decision.updatedInput ?? pending.input,
      };
      if (decision.always && pending.suggestions) result.updatedPermissions = pending.suggestions;
      this.settle(requestId, result);
    } else {
      this.settle(requestId, { behavior: 'deny', message: decision.message ?? 'The user declined this action.', interrupt: decision.interrupt ?? false });
    }
  }

  /**
   * Slash commands (built-ins, custom commands, skills, plugins) for a session
   * or folder. Without a running session, a short-lived Claude Code process is
   * asked once (~0.6 s, no prompt is sent) and the answer is cached.
   */
  async commands(sessionId: string | undefined, cwd: string | undefined, profileId: string): Promise<SlashCommand[]> {
    const host = sessionId ? this.hosts.get(sessionId) : undefined;
    if (host?.active) await host.refreshCommands();
    const folder = host?.info.cwd ?? cwd;
    const key = folder ? { profileId: host?.info.profileId ?? profileId, cwd: folder } : null;
    const list = host?.commands.length ? host.commands : key ? (this.commandsByCwd.get(keyOf(key)) ?? (await this.fetchCommands(key))) : [];
    for (const name of host?.terminalOnly ?? []) TERMINAL_ONLY.add(name);
    // Names starting with `__` (such as `__remote-workflow`) are Claude Code's own plumbing, not for people.
    return list.filter((c) => !TERMINAL_ONLY.has(c.name) && !c.name.startsWith('__'));
  }

  private readonly commandFetches = new Map<string, Promise<SlashCommand[]>>();

  /** User skills and commands apply to every folder, so a change seen in one session makes the profile's other lists stale. */
  private forgetCommands(profileId: string): void {
    for (const id of this.commandsByCwd.keys()) if (id.startsWith(`${profileId}\0`)) this.commandsByCwd.delete(id);
    this.deps.commandCache?.forget(profileId);
  }

  /**
   * Forgets every cached command and capability list, so the next ask reads the skill folders again.
   * A running session reloads its skills itself when it is next asked (`commands`).
   */
  reloadSkills(profileIds: readonly string[]): void {
    for (const profileId of profileIds) this.forgetCommands(profileId);
    this.capabilityCache.clear();
  }

  private fetchCommands(key: CommandKey): Promise<SlashCommand[]> {
    const id = keyOf(key);
    const cached = this.deps.commandCache?.get(key);
    if (cached) {
      this.commandsByCwd.set(id, cached);
      return Promise.resolve(cached);
    }
    let pending = this.commandFetches.get(id);
    if (!pending) {
      pending = this.listCommands(key)
        .then((commands) => {
          this.commandsByCwd.set(id, commands);
          this.deps.commandCache?.set(key, commands);
          return commands;
        })
        .catch((error: Error) => {
          this.deps.log('debug', `Listing commands in ${key.cwd} failed: ${error.message}`);
          return [];
        })
        .finally(() => this.commandFetches.delete(id));
      this.commandFetches.set(id, pending);
    }
    return pending;
  }

  private listCommands({ cwd, profileId }: CommandKey): Promise<SlashCommand[]> {
    return this.withHelper(cwd, profileId, async (query) => {
      // The same process knows the models, so the pickers get the real list without a session running.
      const [commands, models] = await Promise.all([query.supportedCommands(), query.supportedModels().catch(() => [])]);
      if (models.length) this.setModels(models.map(toModelOption));
      return commands.map((c) => ({ name: c.name, description: c.description, argumentHint: c.argumentHint }));
    });
  }

  private readonly capabilityCache = new Map<string, { at: number; value: Promise<Capabilities> }>();

  /**
   * What a session can use. A session running here answers live (and its MCP servers can be
   * toggled); otherwise a helper process for the folder answers, cached for a minute.
   */
  async capabilities(sessionId: string | undefined, cwd: string, refresh: boolean, profileId: string): Promise<Capabilities> {
    const host = sessionId ? this.hosts.get(sessionId) : undefined;
    const plugins = (profile: string) => () => this.deps.installedPlugins?.(profile) ?? [];
    if (host?.active) return host.capabilities(plugins(host.info.profileId));
    const key = keyOf({ profileId, cwd });
    const cached = this.capabilityCache.get(key);
    if (cached && !refresh && Date.now() - cached.at < 60_000) return cached.value;
    // A fresh helper has every MCP server pending; give them up to 5 s to connect.
    const value = this.withHelper(cwd, profileId, (query) => readCapabilities(query, plugins(profileId)(), false, 5_000));
    this.capabilityCache.set(key, { at: Date.now(), value });
    value.catch(() => this.capabilityCache.delete(key));
    return value;
  }

  async mcp(sessionId: string, server: string, action: 'enable' | 'disable' | 'reconnect'): Promise<void> {
    const host = this.hosts.get(sessionId);
    if (!host?.active) throw new RpcError('NOT_RUNNING', 'Start the session in Switchboard to change its MCP servers.');
    try {
      await host.mcp(server, action);
    } catch (error) {
      throw new RpcError('MCP_FAILED', (error as Error).message);
    }
  }

  /**
   * Runs `ask` against a short-lived Claude Code process for `cwd` that never gets a prompt,
   * so no session is written. It answers control requests (commands, agents, MCP) and is closed after.
   */
  private async withHelper<T>(cwd: string, profileId: string, ask: (query: Query) => Promise<T>): Promise<T> {
    const [env, claudePath, sdk] = await Promise.all([this.deps.env(profileId), this.deps.claudePath(), this.deps.sdk()]);
    // A prompt that never yields: Claude Code starts, answers the question, and no session is written.
    const idle: AsyncIterable<SDKUserMessage> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
    const helperId = randomUUID();
    this.deps.ephemeral?.add(helperId);
    setTimeout(() => this.deps.ephemeral?.delete(helperId), 30_000).unref?.();
    const query = sdk.query({
      prompt: idle,
      options: {
        sessionId: helperId,
        persistSession: false,
        cwd,
        env,
        pathToClaudeCodeExecutable: claudePath,
        settingSources: ['user', 'project', 'local'],
        systemPrompt: { type: 'preset', preset: 'claude_code' },
      },
    });
    try {
      return await Promise.race([ask(query), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), 20_000))]);
    } finally {
      query.close();
    }
  }

  listModels(): ModelOption[] {
    return this.models;
  }

  private setModels(models: ModelOption[]): void {
    if (models === this.models || JSON.stringify(models) === JSON.stringify(this.models)) return;
    this.models = models;
    this.deps.onModels?.(models);
  }

  /** Forgets what a session ran with (it was moved to the Trash). */
  forget(sessionId: string): void {
    this.lastMode.delete(sessionId);
    this.settings.delete(sessionId);
  }

  /** Bumped whenever the warm process is replaced or discarded, so a pre-warm that finishes late knows it lost. */
  private warmGeneration = 0;
  /** The folder and profile a pre-warm is starting for, until it has stored its process. */
  private warming: { cwd: string; profileId: string } | undefined;

  /** Starts a Claude Code process for `cwd` so a new session there answers about a second faster. */
  async prewarm(cwd: string, profileId: string): Promise<void> {
    const target = this.warm ?? this.warming;
    if (target?.cwd === cwd && target.profileId === profileId) return;
    this.discardWarm();
    const generation = this.warmGeneration;
    this.warming = { cwd, profileId };
    let env: Record<string, string>, claudePath: string | undefined, sdk: SdkRuntime;
    try {
      [env, claudePath, sdk] = await Promise.all([this.deps.env(profileId), this.deps.claudePath(), this.deps.sdk()]);
    } finally {
      if (generation === this.warmGeneration) this.warming = undefined;
    }
    // Another pre-warm (or a shutdown) took over while this one waited: start nothing, or its process would leak.
    if (generation !== this.warmGeneration) return;
    const sessionId = randomUUID();
    // Until a new session takes it over, the waiting process is no session: keep its registry entry out of the list.
    this.deps.ephemeral?.add(sessionId);
    const route: Warm['route'] = { canUseTool: null };
    const options = buildOptions(
      {
        sessionId,
        cwd,
        profileId,
        mode: 'new',
        model: null,
        permissionMode: 'default',
        effort: null,
        worktree: null,
        env,
        claudePath,
        canUseTool: (...args) => (route.canUseTool ? route.canUseTool(...args) : Promise.resolve({ behavior: 'deny', message: 'Not ready' })),
      },
      this.deps.log,
    );
    const warm = sdk.startup({ options });
    warm.catch((error: unknown) => this.deps.log('debug', `Pre-warm failed: ${(error as Error).message}`));
    const timer = setTimeout(() => this.discardWarm(), this.deps.warmTtlMs ?? 120_000);
    timer.unref?.();
    this.warm = { cwd, profileId, sessionId, warm, route, timer };
  }

  closeAll(): void {
    clearInterval(this.reaper);
    this.discardWarm();
    for (const id of [...this.hosts.keys()]) this.close(id);
  }

  // ---------------------------------------------------------------------------

  private recentlyClosed(sessionId: string): boolean {
    // The later of the two: a stop recorded here can be older than the exit of a host resumed since.
    const at = Math.max(this.closedAt.get(sessionId) ?? -Infinity, this.hosts.get(sessionId)?.closedAt ?? -Infinity);
    return Date.now() - at < 15_000;
  }

  /** Gives a process this app just stopped up to 5 s to exit and leave the registry. */
  private async waitForExit(sessionId: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      this.deps.refreshLive?.();
      if (!this.deps.isOpenElsewhere(sessionId)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private require(sessionId: string): SessionHost {
    const host = this.hosts.get(sessionId);
    if (!host?.active) throw new RpcError('NOT_RUNNING', 'This session is not running in Switchboard');
    return host;
  }

  /** A warm process is only usable for a plain new session in the same folder (effort and worktree are fixed at startup). */
  private takeWarm(params: CreateParams): Warm | undefined {
    const warm = this.warm;
    if (!warm || warm.cwd !== params.cwd || warm.profileId !== params.profileId || params.worktree || params.effort) return undefined;
    clearTimeout(warm.timer);
    this.warm = undefined;
    this.deps.ephemeral?.delete(warm.sessionId);
    return warm;
  }

  private discardWarm(): void {
    this.warmGeneration++;
    this.warming = undefined;
    const warm = this.warm;
    if (!warm) return;
    this.warm = undefined;
    clearTimeout(warm.timer);
    void warm.warm.then((w) => w.close()).catch(() => {});
    // Its registry entry stays until the process has exited.
    setTimeout(() => this.deps.ephemeral?.delete(warm.sessionId), 30_000).unref?.();
  }

  private async spawn(config: Omit<HostConfig, 'env' | 'claudePath' | 'canUseTool'>, warm?: Warm): Promise<SessionHost> {
    const [env, claudePath, sdk] = await Promise.all([this.deps.env(config.profileId), this.deps.claudePath(), this.deps.sdk()]);
    // The session id can change (forks), so permission prompts look it up through the host.
    let hostRef: SessionHost | undefined;
    const canUseTool: CanUseTool = (toolName, input, options) => this.ask(hostRef!.sessionId, toolName, input, options);
    const startQuery: StartQuery = warm
      ? async ({ prompt }) => {
          warm.route.canUseTool = canUseTool;
          return (await warm.warm).query(prompt);
        }
      : (args) => sdk.query(args);
    const host = new SessionHost(
      { ...config, env, claudePath, canUseTool },
      {
        info: (info) => this.onInfo(host, info),
        stream: (delta) => this.deps.onStream(delta),
        messages: (id, messages) => this.deps.onMessages(id, messages),
        log: this.deps.log,
        usageHint: () => this.deps.onUsageHint?.(config.profileId),
        rateLimit: (sessionId, info) => this.deps.onRateLimit?.(config.profileId, sessionId, info),
        knownCommands: () => this.commandsByCwd.get(keyOf({ profileId: config.profileId, cwd: config.cwd })) ?? [],
        // onInfo stores this session's new list right after.
        commandsChanged: () => this.forgetCommands(config.profileId),
      },
      startQuery,
    );
    hostRef = host;
    this.hosts.set(config.sessionId, host);
    host.start();
    return host;
  }

  private onInfo(host: SessionHost, info: SessionHostInfo): void {
    // Re-key when Claude Code reports a different id (forks get a new one at startup).
    for (const [key, value] of this.hosts) {
      if (value === host && key !== info.sessionId) {
        this.hosts.delete(key);
        this.hosts.set(info.sessionId, host);
      }
    }
    if (host.commands.length) {
      const key = { profileId: info.profileId, cwd: info.cwd };
      this.commandsByCwd.set(keyOf(key), host.commands);
      this.deps.commandCache?.set(key, host.commands);
    }
    if (host.models.length) this.setModels(host.models);
    // Bypass needs an extra flag at startup, so a resume never brings it back on its own.
    // Before init the mode is only what we asked for; Claude Code may have settled on another.
    if (info.state !== 'starting' && info.permissionMode !== 'bypassPermissions' && this.lastMode.get(info.sessionId) !== info.permissionMode) {
      this.lastMode.set(info.sessionId, info.permissionMode);
      this.settings.set(info.sessionId, { permissionMode: info.permissionMode });
    }
    this.deps.onInfo(info);
  }

  private ask(sessionId: string, toolName: string, input: Record<string, unknown>, options: Parameters<CanUseTool>[2]): Promise<PermissionResult> {
    return new Promise((resolve) => {
      const requestId = randomUUID();
      const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
      const request: PermissionRequest = {
        requestId,
        sessionId,
        toolName,
        toolUseId: str(options.toolUseID),
        input: clipJson(input, 20_000).value,
        title: str((options as { title?: unknown }).title),
        description: str((options as { description?: unknown }).description),
        decisionReason: str(options.decisionReason),
        blockedPath: str(options.blockedPath),
        alwaysLabel: describeSuggestions(options.suggestions),
        agentId: str(options.agentID),
        createdAt: Date.now(),
      };
      this.pending.set(requestId, { request, input, suggestions: options.suggestions, resolve });
      options.signal.addEventListener('abort', () => this.settle(requestId, { behavior: 'deny', message: 'Cancelled.' }), { once: true });
      this.deps.onPermission(request);
    });
  }

  private settle(requestId: string, result: PermissionResult): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    pending.resolve(result);
    this.deps.onPermissionResolved(requestId, pending.request.sessionId);
  }

  /**
   * Closes sessions that have been idle for a while. A session with background tasks is left
   * alone: closing the process would kill them before Claude could report back. Public for tests.
   */
  reapIdle(now = Date.now()): void {
    const limit = this.deps.idleTimeoutMs ?? 30 * 60_000;
    for (const host of this.hosts.values()) {
      if (host.active && host.info.state === 'idle' && host.info.backgroundTasks.length === 0 && now - host.lastActivity > limit) {
        this.deps.log('info', `Closing idle session ${host.sessionId}`);
        this.closedAt.set(host.sessionId, Date.now());
        host.close();
      }
    }
  }
}
