import { randomUUID } from 'node:crypto';
import type { CanUseTool, ModelInfo, Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type {
  Effort,
  HostState,
  ImageAttachment,
  LogLevel,
  ModelOption,
  PermissionMode,
  Capabilities,
  PluginInfo,
  RewindResult,
  ContextUsage,
  SessionHostInfo,
  SlashCommand,
  StreamDelta,
  WorktreeRequest,
} from '@switchboard/protocol';
import type { RawSessionMessage } from '../claude/transcript.ts';
import { pluginsFromInit, readCapabilities } from './capabilities.ts';
import { commandEcho } from './commandEcho.ts';
import { InputQueue } from './inputQueue.ts';

/** Starts the Claude Code process for a host. Real hosts use the SDK's `query()` (or a pre-warmed one). */
export type StartQuery = (args: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query | Promise<Query>;

export interface HostEvents {
  info(info: SessionHostInfo): void;
  stream(delta: StreamDelta): void;
  /** Complete messages as they happen, for the live transcript (same uuids as the file). */
  messages(sessionId: string, messages: RawSessionMessage[]): void;
  log(level: LogLevel, message: string): void;
  /** Plan usage probably changed (a turn finished, or Claude Code reported a rate-limit update). */
  usageHint?(): void;
  /** Claude Code's rate-limit update during a turn of this session (`rate_limit_event`), for the plan % history. */
  rateLimit?(sessionId: string, info: { rateLimitType?: string; utilization?: number; resetsAt?: number }): void;
  /** Commands already listed for this folder, for a message sent before this session has listed its own. */
  knownCommands?(): readonly SlashCommand[];
  /** The command list changed while running (a skill was added or removed), so lists cached for the profile are stale. */
  commandsChanged?(): void;
}

export interface HostConfig {
  /**
   * The id this host runs under: the one we assign to a new session or a fork, or the one being resumed.
   * Forks get theirs up front, so the original's id never stands in for the fork.
   */
  sessionId: string;
  /** For forks: the session being forked. */
  forkFrom?: string;
  cwd: string;
  /** The Claude profile (login); `env` already points at its config folder. */
  profileId: string;
  mode: 'new' | 'resume' | 'fork';
  model: string | null;
  permissionMode: PermissionMode;
  effort: Effort | null;
  worktree: WorktreeRequest | null;
  env: Record<string, string>;
  claudePath: string | undefined;
  canUseTool: CanUseTool;
}

const STATE_FROM_SDK: Record<string, HostState> = { running: 'running', requires_action: 'needs-you', idle: 'idle' };
const STREAM_FLUSH_MS = 30;

export function buildOptions(config: HostConfig, log: HostEvents['log']): Options {
  const options: Options = {
    cwd: config.cwd,
    // Session state events drive the status dot; they are opt-in.
    env: { ...config.env, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' },
    pathToClaudeCodeExecutable: config.claudePath,
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    settingSources: ['user', 'project', 'local'],
    includePartialMessages: true,
    enableFileCheckpointing: true,
    permissionMode: config.permissionMode,
    canUseTool: config.canUseTool,
    stderr: (data) => log('debug', `[claude] ${data.trimEnd()}`),
  };
  if (config.model) options.model = config.model;
  if (config.effort) options.effort = config.effort;
  if (config.mode === 'new') options.sessionId = config.sessionId;
  else if (config.mode === 'resume') options.resume = config.sessionId;
  else {
    if (!config.forkFrom) throw new Error('A fork needs the session it forks from');
    // Claude Code accepts a custom id with --resume only together with --fork-session.
    options.resume = config.forkFrom;
    options.forkSession = true;
    options.sessionId = config.sessionId;
  }
  if (config.worktree) {
    // Claude Code creates the worktree itself (same place and naming as `claude --worktree`).
    options.extraArgs = { worktree: config.worktree.name };
    if (config.worktree.baseRef === 'head') options.settings = { worktree: { baseRef: 'head' } };
  }
  return options;
}

function toRaw(message: Extract<SDKMessage, { type: 'assistant' | 'user' }>): RawSessionMessage {
  return {
    type: message.type,
    uuid: message.uuid ?? randomUUID(),
    message: message.message,
    parent_tool_use_id: message.parent_tool_use_id ?? null,
    timestamp: new Date().toISOString(),
  };
}

/** Claude Code's model row, as the window shows it. */
export function toModelOption(m: ModelInfo): ModelOption {
  return {
    value: m.value,
    resolvedModel: m.resolvedModel,
    displayName: m.displayName,
    description: m.description,
    supportsEffort: m.supportsEffort ?? false,
  };
}

/**
 * One Claude Code process driven through the SDK in streaming-input mode.
 * Never throws out of its message loop: failures become the `error` state,
 * because one broken session must not take the engine (and every other session) down.
 */
export class SessionHost {
  private readonly input = new InputQueue<SDKUserMessage>();
  private query: Promise<Query | undefined> = Promise.resolve(undefined);
  private closing = false;
  private initResolve!: (sessionId: string) => void;
  private initReject!: (error: Error) => void;
  /** Resolves with the real session id once Claude Code has started (matters for forks). */
  readonly initialized: Promise<string>;
  private streamBuffer: StreamDelta | null = null;
  private streamTimer: ReturnType<typeof setTimeout> | undefined;
  commands: SlashCommand[] = [];
  /** Plugins from Claude Code's startup message (null until it has started a turn). */
  plugins: PluginInfo[] | null = null;
  /** Commands that only work in the terminal UI (reported by Claude Code at init). */
  terminalOnly: string[] = [];
  models: ModelOption[] = [];
  lastActivity = Date.now();
  /** When the process ended (closed or crashed), for telling our own exiting process apart from another window. */
  closedAt: number | undefined;
  info: SessionHostInfo;

  constructor(
    private readonly config: HostConfig,
    private readonly events: HostEvents,
    private readonly startQuery: StartQuery,
  ) {
    this.info = {
      sessionId: config.sessionId,
      cwd: config.cwd,
      state: 'starting',
      model: config.model,
      permissionMode: config.permissionMode,
      effort: config.effort,
      costUsd: 0,
      contextPercent: null,
      contextTokens: null,
      contextMax: null,
      error: null,
      startedAt: Date.now(),
      promptedAt: null,
      queued: 0,
      profileId: config.profileId,
      backgroundTasks: [],
    };
    this.initialized = new Promise((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
    });
    // Nobody may be awaiting it; a rejection here must not become an unhandled rejection.
    this.initialized.catch(() => {});
  }

  get sessionId(): string {
    return this.info.sessionId;
  }

  get active(): boolean {
    return this.info.state !== 'closed' && this.info.state !== 'error';
  }

  start(): void {
    this.query = (async () => this.startQuery({ prompt: this.input, options: buildOptions(this.config, this.events.log) }))().then(
      (query) => {
        void this.loop(query);
        return query;
      },
      (error: unknown) => {
        this.fail(error);
        this.input.end();
        return undefined;
      },
    );
    this.events.info(this.info);
  }

  /**
   * Queues a user message. It shows up in the transcript immediately, with the uuid Claude Code will store.
   * `after`: Claude Code only gets it once that has settled (Auto choosing the model of a new session).
   */
  send(text: string, attachments: readonly ImageAttachment[] = [], after?: Promise<unknown>): string {
    if (!this.active) throw new Error('This session is not running');
    const uuid = randomUUID();
    const content = [
      ...attachments.map((a) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: a.mediaType, data: a.data } })),
      ...(text ? [{ type: 'text' as const, text }] : []),
    ];
    const message: SDKUserMessage = { type: 'user', uuid, parent_tool_use_id: null, message: { role: 'user', content } };
    if (after) void after.then(() => this.active && this.input.push(message));
    else this.input.push(message);
    this.lastActivity = Date.now();
    // Claude Code gets the text as typed; the echo shows a slash command the way the stored transcript will.
    const commands = this.commands.length ? this.commands : (this.events.knownCommands?.() ?? []);
    const echo = attachments.length === 0 && text ? { role: 'user' as const, content: [{ type: 'text' as const, text: commandEcho(text, commands.map((c) => c.name)) }] } : message.message;
    this.events.messages(this.sessionId, [{ type: 'user', uuid, message: echo, parent_tool_use_id: null, timestamp: new Date().toISOString() }]);
    const busy = this.info.state === 'running' || this.info.state === 'needs-you';
    this.update({ promptedAt: this.lastActivity, ...(busy ? { queued: this.info.queued + 1 } : {}) });
    return uuid;
  }

  async capabilities(fallbackPlugins: () => PluginInfo[]): Promise<Capabilities> {
    const query = await this.query;
    if (!query) throw new Error('This session is not running');
    return readCapabilities(query, this.plugins ?? fallbackPlugins(), true);
  }

  async mcp(server: string, action: 'enable' | 'disable' | 'reconnect'): Promise<void> {
    const query = await this.query;
    if (!query) throw new Error('This session is not running');
    if (action === 'reconnect') await query.reconnectMcpServer(server);
    else await query.toggleMcpServer(server, action === 'enable');
  }

  /** Restores the files Claude changed to how they were before `userMessageId` (Claude Code's own checkpoints). */
  async rewindFiles(userMessageId: string, dryRun: boolean): Promise<RewindResult> {
    const query = await this.query;
    if (!query) throw new Error('This session is not running');
    const result = await query.rewindFiles(userMessageId, { dryRun });
    return {
      canRewind: result.canRewind,
      error: result.error ?? null,
      files: result.filesChanged ?? [],
      insertions: result.insertions ?? 0,
      deletions: result.deletions ?? 0,
    };
  }

  async interrupt(): Promise<void> {
    await (await this.query)?.interrupt();
  }

  /** Stops one background task; the next `background_tasks_changed` drops it from the list. */
  async stopTask(taskId: string): Promise<void> {
    await (await this.query)?.stopTask(taskId);
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    await (await this.query)?.setPermissionMode(mode);
    this.update({ permissionMode: mode });
  }

  async setEffort(effort: Effort | null): Promise<void> {
    await (await this.query)?.applyFlagSettings({ effortLevel: effort });
    this.update({ effort });
  }

  async contextUsage(): Promise<ContextUsage> {
    const query = await this.query;
    if (!query) throw new Error('This session is not running');
    const usage = await query.getContextUsage({ detail: 'summary' });
    return {
      totalTokens: usage.totalTokens,
      maxTokens: usage.maxTokens,
      percentage: usage.percentage,
      model: usage.model,
      categories: usage.categories.map((c) => ({ name: c.name, tokens: c.tokens, color: c.color, kind: c.kind })),
    };
  }

  async setModel(model: string | null): Promise<void> {
    await (await this.query)?.setModel(model ?? undefined);
    this.update({ model });
  }

  close(): void {
    if (this.closing) return;
    this.closing = true;
    void this.query.then((query) => {
      try {
        query?.close();
      } catch (error) {
        this.events.log('warn', `Closing session ${this.sessionId} failed: ${(error as Error).message}`);
      }
    });
    this.flushStream();
    this.update({ state: 'closed' });
    this.release();
  }

  /**
   * Lets go of the process once the host has ended. Ending the input lets the SDK finish its
   * input stream, and dropping the Query lets it be collected: closed hosts stay in the manager's
   * map (their last state is still shown), and would otherwise keep the whole Query alive until quit.
   */
  private release(): void {
    this.input.end();
    this.query = Promise.resolve(undefined);
  }

  private update(patch: Partial<SessionHostInfo>): void {
    const ended = patch.state === 'closed' || patch.state === 'error';
    if (ended && this.closedAt === undefined) this.closedAt = Date.now();
    // Background tasks die with the process.
    this.info = { ...this.info, ...patch, ...(ended ? { backgroundTasks: [] } : {}) };
    this.events.info(this.info);
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.events.log('error', `Session ${this.sessionId} failed: ${message}`);
    this.initReject(new Error(message));
    this.update({ state: 'error', error: message });
  }

  private async loop(query: Query): Promise<void> {
    try {
      for await (const message of query) {
        try {
          this.handle(message);
        } catch (error) {
          this.events.log('warn', `Could not handle ${message.type} message: ${(error as Error).message}`);
        }
      }
      if (!this.closing) this.update({ state: 'closed' });
    } catch (error) {
      if (this.closing) return;
      this.fail(error);
    } finally {
      this.flushStream();
      this.initReject(new Error('Session ended before it started'));
      // The process has ended (or failed); make sure the SDK has cleaned up after it before letting go.
      try {
        query.close();
      } catch {
        // Already closed.
      }
      this.release();
    }
  }

  private handle(message: SDKMessage): void {
    this.lastActivity = Date.now();
    switch (message.type) {
      case 'system':
        return this.handleSystem(message);
      case 'stream_event':
        if (message.parent_tool_use_id === null) this.handleStreamEvent(message.event as { type: string; [key: string]: unknown });
        return;
      // Subagent messages live in their own transcript file (shown inside the Task card),
      // so only the main conversation is pushed live.
      case 'assistant':
        if (message.parent_tool_use_id !== null) return;
        this.events.messages(this.sessionId, [toRaw(message)]);
        this.pushStream('clear', '');
        return;
      // Synthetic messages are what Claude Code adds for the model only (a loaded skill's
      // instructions, compact summaries). The transcript readers leave them out, so live does too.
      case 'user':
        if (message.parent_tool_use_id !== null || ('isReplay' in message && message.isReplay) || message.isSynthetic) return;
        this.events.messages(this.sessionId, [toRaw(message)]);
        return;
      case 'result':
        this.update({ costUsd: message.total_cost_usd ?? this.info.costUsd });
        void this.refreshContext();
        this.events.usageHint?.();
        return;
      case 'rate_limit_event':
        this.events.rateLimit?.(this.sessionId, message.rate_limit_info);
        this.events.usageHint?.();
        return;
      default:
        return;
    }
  }

  private handleSystem(message: Extract<SDKMessage, { type: 'system' }>): void {
    if (message.subtype === 'init') {
      const init = message as Extract<SDKMessage, { subtype: 'init' }>;
      const first = this.info.state === 'starting';
      this.update({
        sessionId: init.session_id,
        cwd: init.cwd,
        model: init.model,
        permissionMode: init.permissionMode as PermissionMode,
        state: first ? 'idle' : this.info.state,
      });
      const terminalOnly = (init as { terminal_slash_commands?: unknown }).terminal_slash_commands;
      if (Array.isArray(terminalOnly)) this.terminalOnly = terminalOnly.filter((c): c is string => typeof c === 'string');
      this.plugins = pluginsFromInit((init as { plugins?: unknown }).plugins);
      this.initResolve(init.session_id);
      if (first) {
        void this.loadCatalogs();
        void this.refreshContext();
      }
      return;
    }
    if (message.subtype === 'status') {
      // Claude Code reports mode changes it makes itself here (leaving plan mode, auto mode falling back).
      const mode = (message as { permissionMode?: PermissionMode }).permissionMode;
      if (mode && mode !== this.info.permissionMode) this.update({ permissionMode: mode });
      return;
    }
    if (message.subtype === 'background_tasks_changed') {
      // The full set every time (replace, don't pair start/finish events). Ambient tasks such as
      // live-update watchers aren't activity, so they don't count as background work.
      const tasks = (message as { tasks?: Array<{ task_id: string; task_type: string; description: string; ambient?: boolean }> }).tasks ?? [];
      if (this.closing) return;
      // Keep the time a task was first seen, so its running time doesn't restart with every change.
      const seen = new Map(this.info.backgroundTasks.map((t) => [t.taskId, t.startedAt]));
      const now = Date.now();
      this.update({
        backgroundTasks: tasks
          .filter((t) => !t.ambient)
          .map((t) => ({ taskId: t.task_id, type: t.task_type, description: t.description, startedAt: seen.get(t.task_id) ?? now })),
      });
      return;
    }
    if (message.subtype === 'commands_changed') {
      // The full list after a skill appeared or went away mid-session; it replaces ours.
      if (this.setCommands((message as Extract<SDKMessage, { subtype: 'commands_changed' }>).commands)) this.events.info(this.info);
      return;
    }
    if (message.subtype === 'session_state_changed') {
      const state = STATE_FROM_SDK[(message as { state: string }).state];
      if (!state || this.closing) return;
      this.update(state === 'idle' ? { state, queued: 0 } : { state });
      if (state === 'idle') this.pushStream('clear', '');
    }
  }

  private handleStreamEvent(event: { type: string; [key: string]: unknown }): void {
    if (event.type === 'content_block_start') {
      const block = event.content_block as { type?: string; name?: string } | undefined;
      if (block?.type === 'tool_use' || block?.type === 'server_tool_use') this.pushStream('tool', block.name ?? 'tool');
      else this.pushStream('clear', '');
    } else if (event.type === 'content_block_delta') {
      const delta = event.delta as { type?: string; text?: string; thinking?: string } | undefined;
      if (delta?.type === 'text_delta' && delta.text) this.pushStream('text', delta.text);
      else if (delta?.type === 'thinking_delta' && delta.thinking) this.pushStream('thinking', delta.thinking);
    }
  }

  /** Coalesces token deltas so the UI gets ~30 updates a second instead of one per token. */
  private pushStream(kind: StreamDelta['kind'], text: string): void {
    const buffered = this.streamBuffer;
    if (buffered && buffered.kind === kind && (kind === 'text' || kind === 'thinking')) {
      buffered.text += text;
      return;
    }
    this.flushStream();
    this.streamBuffer = { sessionId: this.sessionId, kind, text };
    if (kind === 'clear' || kind === 'tool') this.flushStream();
    else this.streamTimer = setTimeout(() => this.flushStream(), STREAM_FLUSH_MS);
  }

  private flushStream(): void {
    if (this.streamTimer) clearTimeout(this.streamTimer);
    this.streamTimer = undefined;
    const buffered = this.streamBuffer;
    this.streamBuffer = null;
    if (buffered) this.events.stream(buffered);
  }

  private async loadCatalogs(): Promise<void> {
    try {
      const query = await this.query;
      if (!query) return;
      const [commands, models] = await Promise.all([query.supportedCommands(), query.supportedModels()]);
      this.setCommands(commands);
      this.models = models.map(toModelOption);
      // Let the manager see the new lists (it passes the models on to the window).
      this.events.info(this.info);
    } catch (error) {
      this.events.log('debug', `Loading commands/models failed: ${(error as Error).message}`);
    }
  }

  /**
   * Has Claude Code re-read the skill folders, so a skill written during the session (by Claude
   * itself, or in another window) shows up without restarting it. Only while idle: the list is
   * asked for when a turn ends, and a running turn is left alone.
   */
  async refreshCommands(): Promise<void> {
    if (this.info.state !== 'idle') return;
    try {
      const query = await this.query;
      if (!query) return;
      // A Claude Code that doesn't know the request may never answer it; the list we have stays.
      const reload = query.reloadSkills().then(() => query.supportedCommands());
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000).unref?.());
      const commands = await Promise.race([reload, timeout]);
      if (commands && this.setCommands(commands)) this.events.info(this.info);
    } catch (error) {
      this.events.log('debug', `Reloading skills failed: ${(error as Error).message}`);
    }
  }

  /** Replaces the command list; true when it changed. A change after the first list is reported. */
  private setCommands(commands: readonly SlashCommand[]): boolean {
    const next = commands.map((c) => ({ name: c.name, description: c.description, argumentHint: c.argumentHint }));
    if (JSON.stringify(next) === JSON.stringify(this.commands)) return false;
    const first = this.commands.length === 0;
    this.commands = next;
    if (!first) this.events.commandsChanged?.();
    return true;
  }

  private async refreshContext(): Promise<void> {
    try {
      // `summary` answers from the last response and local estimates, without extra API calls.
      const usage = await (await this.query)?.getContextUsage({ detail: 'summary' });
      if (usage) this.update({ contextPercent: Math.round(usage.percentage), contextTokens: usage.totalTokens, contextMax: usage.maxTokens });
    } catch {
      // Context usage is informational only.
    }
  }
}
