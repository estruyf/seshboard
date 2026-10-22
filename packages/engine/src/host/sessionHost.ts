import { randomUUID } from 'node:crypto';
import type { CanUseTool, HookCallback, ModelInfo, Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { cacheTtlOf, type CacheTtl } from '@switchboard/protocol';
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
  ClaudeWorktreeRequest,
} from '@switchboard/protocol';
import type { RawSessionMessage } from '../claude/transcript.ts';
import { pluginsFromInit, readCapabilities } from './capabilities.ts';
import { commandEcho } from './commandEcho.ts';
import { isReadOnlyTool, READ_ONLY_STEP_REASON } from './sideQuestions.ts';
import { InputQueue } from './inputQueue.ts';
import { sessionFolder } from './sessionFolder.ts';
import { modsBridge } from './modsBridge.ts';
import { ModsSurface, type ModsEvents } from './modsSurface.ts';
import { summarise, type StoredUpNext } from './upNextStore.ts';
import { limitStop, type LimitStop, type RateLimitUpdate } from '../usageLimit/usageLimit.ts';

/** Starts the Claude Code process for a host. Real hosts use the SDK's `query()` (or a pre-warmed one). */
export type StartQuery = (args: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query | Promise<Query>;

export interface HostEvents {
  info(info: SessionHostInfo): void;
  stream(delta: StreamDelta): void;
  /**
   * Complete messages as they happen, for the live transcript (same uuids as the file). `held`: Claude Code doesn't
   * have it yet (a new session's first message while Auto chooses), so the file won't either for a while.
   */
  messages(sessionId: string, messages: RawSessionMessage[], held?: boolean): void;
  log(level: LogLevel, message: string): void;
  /** Plan usage probably changed (a turn finished, or Claude Code reported a rate-limit update). */
  usageHint?(): void;
  /** Claude Code's rate-limit update during a turn of this session (`rate_limit_event`), for the plan % history. */
  rateLimit?(sessionId: string, info: { rateLimitType?: string; utilization?: number; resetsAt?: number }): void;
  /** Commands already listed for this folder, for a message sent before this session has listed its own. */
  knownCommands?(): readonly SlashCommand[];
  /** The command list changed while running (a skill was added or removed), so lists cached for the profile are stale. */
  commandsChanged?(): void;
  /** Up next changed: the whole list with its images, to keep it when the app quits or the session stops. */
  queue?(sessionId: string, messages: StoredUpNext[]): void;
  /**
   * Claude's turn ended (its `result`): finished, or stopped with an error, with Claude Code's message. `stopped`: you
   * stopped it (Stop); `superseded`: Send now stopped it to send a message, so another turn follows at once.
   */
  turnEnded?(sessionId: string, outcome: TurnOutcome): void;
  /** A usage limit stopped Claude's turn (called before the session goes idle, so the queue already waits). */
  limitHit?(sessionId: string, stop: LimitStop): void;
  /** A turn finished without an error: whatever limit the profile was at no longer holds. */
  turnOk?(sessionId: string): void;
  /** The profile is at a usage limit: what is queued waits until it is cleared. */
  limited?(): boolean;
  /** What this session's mods tell the windows; without it, mods never attach. */
  mods?: ModsEvents;
  /**
   * A message as Claude reads it: linked sessions' stubs turned into briefs (session linking). Called for every message
   * right as it goes to Claude Code, so a queued one carries what is true then. Must not wait.
   */
  expand?(sessionId: string, text: string): string;
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
  worktree: ClaudeWorktreeRequest | null;
  env: Record<string, string>;
  claudePath: string | undefined;
  canUseTool: CanUseTool;
  /** The SDK's messages for a usage limit that was reached (`limitPrefixes`); empty when this SDK has none. */
  limitPrefixes?: readonly string[];
  /** Show mods (Settings › Mods): attach when Claude Code can draw mods. On unless said otherwise. */
  showMods?: boolean;
  /** Use Claude in Chrome (Settings › General): start Claude Code with `--chrome`. Off unless said otherwise. */
  chrome?: boolean;
  /** Only tools that read (`isReadOnlyTool`), through a PreToolUse hook: a read-only pipeline step (#179). */
  readOnly?: boolean;
}

/** Said instead of the SDK's own error when no `claude` was found, so the fix is clear. */
export const CLAUDE_MISSING_MESSAGE = 'Claude Code isn’t installed, or Switchboard can’t find it. Install it, then try again.';

/**
 * Without a `claude` of the user's, the SDK falls back to a native binary it doesn't ship with Switchboard and fails
 * with "Native CLI binary for darwin-arm64 not found. Reinstall @anthropic-ai/claude-agent-sdk": say what's really wrong.
 */
export function failureMessage(message: string, claudePath: string | undefined): string {
  return claudePath === undefined && /native cli binary .*not found/i.test(message) ? CLAUDE_MISSING_MESSAGE : message;
}

/** A host nobody listens to for mods (tests, helpers): it never attaches. */
const NO_MODS: ModsEvents = {
  state: () => {},
  toast: () => {},
  statuses: () => {},
  log: () => {},
  invalidate: () => {},
  panes: () => {},
  scroll: () => {},
  focus: () => {},
  ask: async () => null,
  diagnostics: () => {},
};

const STATE_FROM_SDK: Record<string, HostState> = { running: 'running', requires_action: 'needs-you', idle: 'idle' };

/** How a turn ended, as `turnEnded` reports it. */
export interface TurnOutcome {
  ok: boolean;
  error: string | null;
  stopped?: boolean;
  superseded?: boolean;
}

/** How a turn ended, from its `result`: Claude Code's first error, or its text when it flagged the result as one. */
export function resultOutcome(message: Extract<SDKMessage, { type: 'result' }>): { ok: boolean; error: string | null } {
  if (message.subtype === 'success' && !message.is_error) return { ok: true, error: null };
  const errors = (message as { errors?: unknown }).errors;
  const first = Array.isArray(errors) ? errors.find((e): e is string => typeof e === 'string' && e.trim() !== '') : undefined;
  const text = message.subtype === 'success' ? message.result : undefined;
  return { ok: false, error: (first ?? text ?? null)?.trim().slice(0, 300) || null };
}
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
  if (config.readOnly) {
    // Every tool call goes through it, whatever the mode or the settings allow.
    const guard: HookCallback = async (hook) => {
      const tool = hook as { tool_name?: string; tool_input?: unknown };
      const allowed = isReadOnlyTool(tool.tool_name ?? '', (tool.tool_input ?? {}) as Record<string, unknown>);
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: allowed ? 'allow' : 'deny', ...(allowed ? {} : { permissionDecisionReason: READ_ONLY_STEP_REASON }) } };
    };
    options.hooks = { PreToolUse: [{ hooks: [guard] }] };
  }
  if (config.mode === 'new') options.sessionId = config.sessionId;
  else if (config.mode === 'resume') options.resume = config.sessionId;
  else {
    if (!config.forkFrom) throw new Error('A fork needs the session it forks from');
    // Claude Code accepts a custom id with --resume only together with --fork-session.
    options.resume = config.forkFrom;
    options.forkSession = true;
    options.sessionId = config.sessionId;
  }
  const extraArgs: Record<string, string | null> = {};
  if (config.worktree) {
    // Claude Code creates the worktree itself (same place and naming as `claude --worktree`).
    extraArgs.worktree = config.worktree.name;
    if (config.worktree.baseRef === 'head') options.settings = { worktree: { baseRef: 'head' } };
  }
  // Claude Code's "Enabled by default" for Claude in Chrome only applies in a terminal; an SDK host turns it on itself.
  // The SDK passes a null value as a bare flag: `--chrome`.
  if (config.chrome) extraArgs.chrome = null;
  if (Object.keys(extraArgs).length > 0) options.extraArgs = extraArgs;
  return options;
}

/** The text of an assistant message (Claude Code's error messages are one text block). */
function textOf(message: Extract<SDKMessage, { type: 'assistant' }>): string | null {
  const content = message.message.content as Array<{ type: string; text?: string }>;
  const text = content.filter((block) => block.type === 'text' && block.text).map((block) => block.text).join('\n');
  return text || null;
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
  /** Messages held back until Claude's turn ends, in the order they go. Their images stay here. */
  private readonly pending: StoredUpNext[] = [];
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
  /**
   * Tool calls Claude has made that haven't returned yet, subagents' too. Claude Code may have checked their
   * permission already (Auto mode does as they arrive), so a mode change can come too late for them.
   */
  readonly openToolCalls = new Set<string>();
  /** The prompt cache of this turn's last response: reported with the turn's end, so the window hears it once a turn. */
  private cacheSeen: { at: number; ttl: CacheTtl | null } | null = null;
  /** When the process ended (closed or crashed), for telling our own exiting process apart from another window. */
  closedAt: number | undefined;
  info: SessionHostInfo;
  /** The session's Claude Code mods (attached when it reports `ui_surface_v1` and Show mods is on). */
  readonly mods: ModsSurface;

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
      queue: [],
      queueHold: null,
      profileId: config.profileId,
      backgroundTasks: [],
    };
    this.mods = new ModsSurface(() => this.info.sessionId, events.mods ?? NO_MODS, events.mods !== undefined && config.showMods !== false);
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
        // The loop catches its own failures; this is the last line, so nothing becomes an unhandled rejection.
        this.loop(query).catch((error: unknown) => this.events.log('error', `Session ${this.sessionId} broke: ${(error as Error).message}`));
        this.mods.setBridge(modsBridge(query));
        void this.readInitCapabilities(query);
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

  /** Whether Claude is in the middle of a turn (working, or waiting on you). */
  get busy(): boolean {
    return this.info.state === 'running' || this.info.state === 'needs-you';
  }

  /**
   * Hands a user message to Claude Code. It shows up in the transcript immediately, with the uuid Claude Code will store.
   * `after`: Claude Code only gets it once that has settled (Auto choosing the model of a new session).
   * While Claude works, Claude reads it at its next step (a steer); `sendNow` stops the turn first instead.
   * Sending yourself means you are back in charge of the queue, so a hold on it ends.
   */
  send(text: string, attachments: readonly ImageAttachment[] = [], after?: Promise<unknown>): string {
    if (!this.active) throw new Error('This session is not running');
    if (this.queueHold) {
      this.queueHold = null;
      this.publishQueue();
    }
    return this.push(text, attachments, after);
  }

  /**
   * Stops Claude's turn, then sends the message, so it runs at once. Not `priority: 'now'`: Claude Code folds such a
   * message into a turn that hasn't started answering yet instead of stopping it (spike 12). Up next waits meanwhile,
   * so it can't slip in ahead of this message.
   */
  async sendNow(text: string, attachments: readonly ImageAttachment[] = []): Promise<string> {
    if (!this.active) throw new Error('This session is not running');
    if (!this.busy) return this.send(text, attachments);
    this.nowPhase = 'stopping';
    clearTimeout(this.nowTimer);
    try {
      await (await this.query)?.interrupt();
    } finally {
      this.nowPhase = 'sent';
      // Claude Code says `running` or answers once it takes the message; if neither comes, the queue mustn't stay stuck.
      this.nowTimer = setTimeout(() => this.nowStarted(), 5_000);
    }
    return this.send(text, attachments);
  }

  /** The message sent now has its turn: Up next may move on again when that turn ends. */
  private nowStarted(): void {
    clearTimeout(this.nowTimer);
    if (this.nowPhase === null) return;
    this.nowPhase = null;
    this.drain();
  }

  private push(typed: string, attachments: readonly ImageAttachment[], after?: Promise<unknown>): string {
    const uuid = randomUUID();
    const text = this.events.expand ? this.expandSafely(typed) : typed;
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
    this.events.messages(this.sessionId, [{ type: 'user', uuid, message: echo, parent_tool_use_id: null, timestamp: new Date().toISOString() }], after !== undefined);
    this.update({ promptedAt: this.lastActivity });
    return uuid;
  }

  /** A brief that can't be written is no reason to lose the message: it then goes as it was typed. */
  private expandSafely(text: string): string {
    try {
      return this.events.expand!(this.sessionId, text);
    } catch (error) {
      this.events.log('warn', `Could not write a linked session's brief: ${error instanceof Error ? error.message : String(error)}`);
      return text;
    }
  }

  /** You stopped Claude in this turn: its end is a stop, whatever the result says. */
  private stopRequested = false;
  /** Why the queue isn't sending by itself (see `SessionHostInfo.queueHold`). */
  private queueHold: SessionHostInfo['queueHold'] = null;
  /**
   * Send now in progress: `stopping` while the turn is being stopped, `sent` until the message's own turn starts.
   * The stopped turn's end is no failure and no cue for Up next.
   */
  private nowPhase: 'stopping' | 'sent' | null = null;
  private nowTimer: ReturnType<typeof setTimeout> | undefined;
  /** This turn's `rejected` rate-limit update, and the latest of any status: what a usage limit that stops it says. */
  private rejected: RateLimitUpdate | null = null;
  private lastRateLimit: RateLimitUpdate | null = null;
  /** The text of an error Claude Code reported as an assistant message this turn (a usage limit comes as one). */
  private assistantError: string | null = null;

  /**
   * Holds a message until Claude's turn ends, then sends it, one message per turn. The transcript doesn't show
   * it until then, so it can still be edited, moved or taken back. Returns the queue entry's id.
   */
  enqueue(text: string, attachments: readonly ImageAttachment[] = []): string {
    if (!this.active) throw new Error('This session is not running');
    const id = randomUUID();
    this.pending.push({ id, text, attachments: [...attachments], createdAt: Date.now() });
    this.lastActivity = Date.now();
    this.publishQueue({ promptedAt: this.lastActivity });
    // Claude may have finished between the window's check and now.
    this.drain();
    return id;
  }

  /** Takes a queued message out; what it held goes back to the caller for the message box. */
  dequeue(id: string): { text: string; attachments: ImageAttachment[] } | null {
    const at = this.pending.findIndex((m) => m.id === id);
    if (at < 0) return null;
    const [removed] = this.pending.splice(at, 1);
    this.publishQueue();
    return { text: removed!.text, attachments: removed!.attachments };
  }

  /** Moves a queued message to a place in the queue (0 is next). */
  moveQueued(id: string, toIndex: number): void {
    const at = this.pending.findIndex((m) => m.id === id);
    if (at < 0) return;
    const [moved] = this.pending.splice(at, 1);
    this.pending.splice(Math.min(toIndex, this.pending.length), 0, moved!);
    this.publishQueue();
  }

  /** Sends one queued message right now, stopping Claude's turn when it is in one; the others keep waiting. */
  async sendQueuedNow(id: string): Promise<string | null> {
    const message = this.dequeue(id);
    return message ? this.sendNow(message.text, message.attachments) : null;
  }

  /** Sends the next queued message and lets the queue move on by itself again (after a stopped or failed turn). */
  resumeQueue(): void {
    this.queueHold = null;
    this.publishQueue();
    this.drain();
  }

  /** Claude was stopped: what is queued stays put until you send it or move on. */
  holdQueue(reason: 'stopped' | 'error'): void {
    if (this.pending.length === 0 && reason === 'stopped') {
      this.queueHold = null;
      return;
    }
    this.queueHold = reason;
    this.publishQueue();
  }

  /**
   * Up next as it was kept from before this process (the app quit, or the session stopped). It waits for you: Send
   * next, Send now on one of them, or a message of your own lets it move on. Call before `start`.
   */
  restoreQueue(messages: readonly StoredUpNext[]): void {
    if (messages.length === 0) return;
    this.pending.splice(0, this.pending.length, ...messages);
    this.queueHold = 'saved';
    this.info = { ...this.info, queue: this.pending.map(summarise), queueHold: this.queueHold };
  }

  /** The profile left its usage limit: what is queued may move on again. */
  drainQueue(): void {
    this.drain();
  }

  /** When Claude is ready for the next message: sends the first queued one, unless the queue is on hold or the profile is at a usage limit. */
  private drain(): void {
    if (!this.active || this.busy || this.queueHold || this.nowPhase || this.pending.length === 0 || this.events.limited?.()) return;
    const next = this.pending.shift()!;
    this.push(next.text, next.attachments);
    this.publishQueue();
  }

  private publishQueue(extra: Partial<SessionHostInfo> = {}): void {
    // An empty queue has nothing to hold.
    if (this.pending.length === 0) this.queueHold = null;
    this.update({ queue: this.pending.map(summarise), queueHold: this.queueHold, ...extra });
    this.events.queue?.(this.sessionId, [...this.pending]);
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

  /**
   * Stops Claude's turn. `hold`: stopping Claude is not a reason to fire off what is queued, so it waits for you.
   * `continue`: Up next moves on once the turn has ended (Stop on a phone, where Send next is out of reach).
   */
  async interrupt(upNext: 'hold' | 'continue' = 'hold'): Promise<void> {
    if (this.busy) {
      this.stopRequested = true;
      if (upNext === 'hold') this.holdQueue('stopped');
      else if (this.queueHold) {
        this.queueHold = null;
        this.publishQueue();
      }
    }
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
    this.mods.close();
    this.input.end();
    this.query = Promise.resolve(undefined);
  }

  /** Capabilities from the initialize result, which comes before any turn's init message. */
  private async readInitCapabilities(query: Query): Promise<void> {
    try {
      const init = (await query.initializationResult()) as { capabilities?: unknown };
      if (Array.isArray(init?.capabilities) && this.active) this.mods.setCapabilities(init.capabilities.filter((c): c is string => typeof c === 'string'));
    } catch {
      // The init message carries them too.
    }
  }

  /** A compact is over (its boundary, the turn's result or the session going idle). */
  private endCompacting(): void {
    if (this.info.compacting) this.update({ compacting: false });
  }

  private update(patch: Partial<SessionHostInfo>): void {
    const ended = patch.state === 'closed' || patch.state === 'error';
    if (ended && this.closedAt === undefined) this.closedAt = Date.now();
    // Background tasks die with the process.
    this.info = { ...this.info, ...patch, ...(ended ? { backgroundTasks: [], compacting: false } : {}) };
    try {
      this.events.info(this.info);
    } catch (error) {
      // Whoever listens failing must not stop this host from tracking its own state.
      this.events.log('warn', `Could not report session ${this.sessionId}: ${(error as Error).message}`);
    }
  }

  private fail(error: unknown): void {
    const message = failureMessage(error instanceof Error ? error.message : String(error), this.config.claudePath);
    this.events.log('error', `Session ${this.sessionId} failed: ${message}`);
    this.initReject(new Error(message));
    this.update({ state: 'error', error: message, ...(this.pending.length > 0 ? { queueHold: 'error' as const } : {}) });
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
    this.trackToolCalls(message);
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
        // Claude answering after Send now's message went means its turn has started (Claude Code doesn't always say `running` in between).
        if (this.nowPhase === 'sent') this.nowStarted();
        if (message.error) this.assistantError = textOf(message) ?? this.assistantError;
        this.noteCache(message.message as unknown as { usage?: Record<string, unknown> | null } | undefined);
        this.events.messages(this.sessionId, [toRaw(message)]);
        this.pushStream('clear', '');
        return;
      // Synthetic messages are what Claude Code adds for the model only (a loaded skill's
      // instructions, compact summaries). The transcript readers leave them out, so live does too.
      case 'user':
        if (message.parent_tool_use_id !== null || ('isReplay' in message && message.isReplay) || message.isSynthetic) return;
        this.events.messages(this.sessionId, [toRaw(message)]);
        return;
      case 'result': {
        const outcome = resultOutcome(message);
        const stop = outcome.ok
          ? null
          : limitStop({ error: outcome.error ?? this.assistantError, rejected: this.rejected, last: this.lastRateLimit, prefixes: this.config.limitPrefixes ?? [] });
        this.rejected = null;
        this.assistantError = null;
        // A failed turn leaves the queue for you to decide, unless you stopped it yourself (held already, or let go on
        // purpose) or sent a message now. A usage limit holds it instead, until the limit is cleared.
        if (!outcome.ok && !stop && !this.nowPhase && !this.queueHold && !this.stopRequested) this.holdQueue('error');
        if (stop) this.events.limitHit?.(this.sessionId, stop);
        else if (outcome.ok) this.events.turnOk?.(this.sessionId);
        this.update({ costUsd: message.total_cost_usd ?? this.info.costUsd, ...this.takeCache(), ...(this.info.compacting ? { compacting: false } : {}) });
        void this.refreshContext();
        this.events.usageHint?.();
        const stopped = this.stopRequested;
        this.stopRequested = false;
        this.events.turnEnded?.(this.sessionId, { ...outcome, stopped, superseded: this.nowPhase !== null });
        return;
      }
      case 'rate_limit_event':
        this.lastRateLimit = message.rate_limit_info;
        if (message.rate_limit_info.status === 'rejected') this.rejected = message.rate_limit_info;
        this.events.rateLimit?.(this.sessionId, message.rate_limit_info);
        this.events.usageHint?.();
        return;
      default:
        return;
    }
  }

  private trackToolCalls(message: SDKMessage): void {
    if (message.type === 'result') return this.openToolCalls.clear();
    if (message.type !== 'assistant' && message.type !== 'user') return;
    const content = (message.message as { content?: unknown }).content;
    if (!Array.isArray(content)) return;
    for (const block of content as Array<{ type?: string; id?: unknown; tool_use_id?: unknown }>) {
      if (block.type === 'tool_use' && typeof block.id === 'string') this.openToolCalls.add(block.id);
      else if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') this.openToolCalls.delete(block.tool_use_id);
    }
  }

  private handleSystem(message: Extract<SDKMessage, { type: 'system' }>): void {
    // Mods' toasts, statuses, panes and logs never reach the transcript.
    if (this.mods.handleSystem(message as unknown as { subtype?: unknown } & Record<string, unknown>)) return;
    if (message.subtype === 'init') {
      const init = message as Extract<SDKMessage, { subtype: 'init' }>;
      // Without an id the session would be filed under `undefined` (and break every list that looks it up): skip it.
      if (typeof init.session_id !== 'string' || !init.session_id) {
        this.events.log('warn', `Session ${this.sessionId}: ignored a startup message from Claude Code without a session id`);
        return;
      }
      const first = this.info.state === 'starting';
      this.update({
        sessionId: init.session_id,
        cwd: typeof init.cwd === 'string' && init.cwd ? sessionFolder(this.info.cwd, init.cwd) : this.info.cwd,
        model: typeof init.model === 'string' ? init.model : this.info.model,
        permissionMode: typeof init.permissionMode === 'string' ? (init.permissionMode as PermissionMode) : this.info.permissionMode,
        state: first ? 'idle' : this.info.state,
      });
      const terminalOnly = (init as { terminal_slash_commands?: unknown }).terminal_slash_commands;
      if (Array.isArray(terminalOnly)) this.terminalOnly = terminalOnly.filter((c): c is string => typeof c === 'string');
      this.plugins = pluginsFromInit((init as { plugins?: unknown }).plugins);
      const capabilities = (init as { capabilities?: unknown }).capabilities;
      // Every turn's init lists them: one without `ui_surface_v1` means the mods are gone.
      if (Array.isArray(capabilities)) this.mods.setCapabilities(capabilities.filter((c): c is string => typeof c === 'string'));
      this.initResolve(init.session_id);
      if (first) {
        void this.loadCatalogs();
        void this.refreshContext();
      }
      return;
    }
    if (message.subtype === 'status') {
      // Claude Code reports mode changes it makes itself here (leaving plan mode, auto mode falling back).
      const { permissionMode: mode, status, compact_result: compactResult, compact_error: compactError } = message as { permissionMode?: PermissionMode; status?: unknown; compact_result?: string; compact_error?: string };
      // 'compacting' while Claude Code summarises the conversation; null or 'requesting' once it moves on. Kept on the
      // host so a view opened mid-compact (switching back to the session, a pop-out) still says so.
      const compacting = status === 'compacting';
      if (compactResult === 'failed') this.events.log('warn', `Session ${this.sessionId}: compacting failed${compactError ? `: ${compactError}` : ''}`);
      const patch: Partial<SessionHostInfo> = {
        ...(mode && mode !== this.info.permissionMode ? { permissionMode: mode } : {}),
        ...(compacting !== (this.info.compacting === true) ? { compacting } : {}),
      };
      if (Object.keys(patch).length > 0) this.update(patch);
      return;
    }
    if (message.subtype === 'compact_boundary') {
      this.endCompacting();
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
      this.update({ state, ...(state === 'idle' && this.info.compacting ? { compacting: false } : {}) });
      if (state === 'running' && this.nowPhase === 'sent') this.nowStarted();
      if (state === 'idle') {
        this.pushStream('clear', '');
        if (this.pluginsReloadOwed) void this.reloadPlugins();
        this.drain();
      }
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

  /** A reload asked for during a turn, done when the turn ends. */
  private pluginsReloadOwed = false;

  /**
   * Has Claude Code read its plugins and MCP servers again, as /reload-plugins does in the terminal, so an
   * MCP server added to the settings or `.mcp.json` after the session started is there for its next turn.
   * A running turn is left alone: the session reloads when it ends.
   */
  async reloadPlugins(): Promise<void> {
    if (this.busy) {
      this.pluginsReloadOwed = true;
      return;
    }
    this.pluginsReloadOwed = false;
    // A session that is still starting reads the settings as it starts.
    if (this.info.state !== 'idle') return;
    try {
      const query = await this.query;
      if (!query) return;
      // Connecting a new server can take a while; a Claude Code that doesn't know the request may never answer.
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000).unref?.());
      const result = await Promise.race([query.reloadPlugins(), timeout]);
      if (!result) return;
      this.plugins = pluginsFromInit(result.plugins) ?? this.plugins;
      if (this.setCommands(result.commands)) this.events.info(this.info);
    } catch (error) {
      this.events.log('debug', `Reloading plugins failed: ${(error as Error).message}`);
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

  /**
   * A response that read or wrote the prompt cache started its time again. Which cache it is comes from the responses
   * that wrote to it; one that only read keeps the last one known.
   */
  private noteCache(message: { usage?: Record<string, unknown> | null } | undefined): void {
    const usage = message?.usage;
    if (!usage) return;
    const touched = [usage.cache_read_input_tokens, usage.cache_creation_input_tokens].some((n) => typeof n === 'number' && n > 0);
    if (!touched) return;
    this.cacheSeen = { at: Date.now(), ttl: cacheTtlOf(usage) ?? this.cacheSeen?.ttl ?? this.info.cacheTtl ?? null };
  }

  private takeCache(): Pick<SessionHostInfo, 'cacheAt' | 'cacheTtl'> {
    const seen = this.cacheSeen;
    if (!seen) return {};
    this.cacheSeen = null;
    return { cacheAt: seen.at, cacheTtl: seen.ttl };
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
