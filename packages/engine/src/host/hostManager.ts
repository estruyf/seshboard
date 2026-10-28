import { randomUUID } from 'node:crypto';
import type { CanUseTool, HookCallback, Options, PermissionResult, PermissionUpdate, Query, SDKUserMessage, WarmQuery } from '@anthropic-ai/claude-agent-sdk';
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
  type QueuedMessage,
  type RewindResult,
  type AutoPick,
  type SendMode,
  type SessionHostInfo,
  type SlashCommand,
  type StreamDelta,
  type UsageLimitHit,
  type ClaudeWorktreeRequest,
  type ModLog,
  type ModPromptAnswer,
  type ModPromptAsk,
  type ModsSnapshot,
} from '@seshboard/protocol';
import { clipJson } from '../claude/transcript.ts';
import type { RawSessionMessage } from '../claude/transcript.ts';
import { describeSuggestions, RECHECK_MESSAGE, recheckAfterModeChange } from './permissions.ts';
import { readCapabilities } from './capabilities.ts';
import type { ModsEvents, ModsSurface } from './modsSurface.ts';
import { buildOptions, SessionHost, toModelOption, type HostConfig, type StartQuery, type TurnOutcome } from './sessionHost.ts';
import { ASK_MAX_TURNS, ASK_TIMEOUT_MS, isReadOnlyTool, readUsage, READ_ONLY_REASON, sumByModel, type AskResult, type AskText, type AskUsage } from './sideQuestions.ts';
import { createMemorySessionSettings, type SessionSettingsStore } from './sessionSettings.ts';
import { summarise, type StoredUpNext } from './upNextStore.ts';
import { limitPrefixes, type LimitStop } from '../usageLimit/usageLimit.ts';

/** The two SDK entry points the manager needs; injected so tests can fake Claude Code. */
export interface SdkRuntime {
  query(args: { prompt: AsyncIterable<SDKUserMessage>; options: Options }): Query;
  startup(args: { options: Options }): Promise<WarmQuery>;
  /** The messages that mean a usage limit was reached (alpha in the SDK, so it may be missing: see `limitPrefixes`). */
  USAGE_LIMIT_ERROR_PREFIXES?: readonly string[];
}

export interface HostManagerDeps {
  sdk: () => Promise<SdkRuntime>;
  /** The full login-shell environment for Claude Code processes, pointed at a profile's config folder. */
  env: (profileId: string) => Promise<Record<string, string>>;
  claudePath: () => Promise<string | undefined>;
  /** True when a Claude Code process outside this app has the session open. */
  isOpenElsewhere: (sessionId: string) => boolean;
  /** Stops the process an earlier run of the engine left holding the session, when that is what has it open. True when it did. */
  stopLeftover?: (sessionId: string) => boolean;
  /** Re-reads the live registry now (instead of waiting for the next poll). */
  refreshLive?: () => void;
  /** The folder a session ran in (resumes must start there, or tools act in the wrong place). */
  sessionCwd: (sessionId: string) => string | null;
  /** The profile a session was created with (resumes and forks must use the same login). */
  sessionProfile: (sessionId: string) => string;
  onInfo: (info: SessionHostInfo) => void;
  onStream: (delta: StreamDelta) => void;
  /** `held`: a message Claude Code doesn't have yet (see `HostEvents.messages`). */
  onMessages: (sessionId: string, messages: RawSessionMessage[], held?: boolean) => void;
  /** A session this app ran was stopped: a message it still held back will never be sent. */
  onClosed?: (sessionId: string) => void;
  onPermission: (request: PermissionRequest) => void;
  onPermissionResolved: (requestId: string, sessionId: string) => void;
  /** A session this app created (for the "Seshboard" origin badge). */
  onCreated: (sessionId: string) => void;
  /** You sent a message to an existing session from this app (it now counts as a Seshboard session). */
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
  /** Where Up next is kept, so it outlives the session's process and the app; without it, it lives as long as the process. */
  upNext?: { list(sessionId: string): StoredUpNext[]; all(): Array<{ sessionId: string; queue: QueuedMessage[] }>; save(sessionId: string, messages: readonly StoredUpNext[]): void };
  /** A session's Up next changed (running or not), for windows showing it. */
  onUpNext?: (sessionId: string, queue: QueuedMessage[]) => void;
  /** A session's turn ended: finished, or stopped with an error. */
  onTurnEnd?: (sessionId: string, outcome: TurnOutcome) => void;
  /**
   * Plan usage limits per profile (`UsageLimits`): a turn a limit stopped sets one, a turn that gets through clears it,
   * and while one is set the profile's queues wait. Call `limitChanged` when one is set or cleared from elsewhere.
   */
  limits?: { of(profileId: string): UsageLimitHit | null; hit(profileId: string, sessionId: string, stop: LimitStop): void; ok(profileId: string, sessionId: string): void };
  /** Profiles whose login stopped working: a failed turn reports it, a turn that gets through clears it. */
  signIns?: { hit(profileId: string, sessionId: string, message: string | null): void; ok(profileId: string): void };
  /**
   * Where sessions' mods report to (the `mods.*` events). `ask` goes to the windows; their answer comes back through
   * `answerModPrompt`. Without it, sessions never attach mods.
   */
  mods?: Omit<ModsEvents, 'ask' | 'diagnostics'> & { ask(ask: ModPromptAsk): void };
  /**
   * Session linking (`LinkService`): `expand` turns a message's stubs into briefs as it goes to Claude Code, `warm`
   * reads gh and git for them first (briefly) when a message is sent or queued.
   */
  links?: { expand(sessionId: string, text: string): string; warm(text: string): Promise<void> };
  /** A read-only pipeline step (#179): its resumes keep the read-only hook. */
  readOnly?: (sessionId: string) => boolean;
  /**
   * You approved a plan (`ExitPlanMode`). A pipeline's plan step keeps it and answers with what Claude Code gets
   * instead of the approval (the next step builds it); null lets the approval through as it is.
   */
  planApproved?: (sessionId: string, plan: string) => string | null;
  /**
   * Answers a permission request before it is shown (a pipeline step that approves its own plan, a run that goes on
   * without you); null shows it as usual.
   */
  autoAnswer?: (request: PermissionRequest) => PermissionDecision | null;
}

/** How long Claude Code waits for the message box (it settles on an empty one after 5 s). */
const MOD_ASK_MS = 5_000;

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
  /** A user's ask rule forced this prompt, so no mode answers it. */
  matchedAskRule: boolean;
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
  worktree: ClaudeWorktreeRequest | null;
  /**
   * Runs after Claude Code has started (and created the worktree) but before
   * the first message, e.g. setup actions. Failures are logged; the message still goes.
   */
  beforeFirstMessage?: (sessionId: string) => Promise<void>;
  /** Auto picked `model`: kept with the session and reported in its info. */
  autoPick?: AutoPick | null;
  /** Only tools that read: a read-only pipeline step (#179). */
  readOnly?: boolean;
  /**
   * Auto picks the model after the session has opened: it starts on `model`, shows your message and that Auto is
   * choosing, and the message goes once the pick is in (and setup has finished). Null model: the default model.
   */
  pickModel?: (sessionId: string) => Promise<{ model: string | null; autoPick: AutoPick }>;
}

const NOT_RUNNING_MESSAGE = 'This session is not running in Seshboard';

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
  /**
   * Per session, the tool calls that were under way when the mode last changed, and that mode. A prompt one of
   * them asks for later was decided under the old mode, so it goes back to Claude Code like a waiting one.
   */
  private readonly callsBeforeMode = new Map<string, { mode: PermissionMode; toolUseIds: Set<string> }>();
  /** The mode last saved per session, so info updates don't write to the database every time. */
  private readonly lastMode = new Map<string, PermissionMode>();
  /** What Auto picked per session, read once from the settings (null: it didn't), so info updates don't hit the database. */
  private readonly picks = new Map<string, AutoPick | null>();
  /** Sessions whose first message waits for Auto's pick. */
  private readonly choosing = new Set<string>();
  private readonly reaper: ReturnType<typeof setInterval>;

  /** Show mods (Settings › Mods); every session follows it, without a restart. */
  private showMods = true;
  /** Use Claude in Chrome (Settings › General): sessions, and the pre-warmed process, start with `--chrome`. */
  private chrome = false;
  private readonly modAsks = new Map<string, (answer: ModPromptAnswer | null) => void>();

  constructor(private readonly deps: HostManagerDeps) {
    this.settings = deps.sessionSettings ?? createMemorySessionSettings();
    if (deps.models?.length) this.models = deps.models;
    this.reaper = setInterval(() => this.reapIdle(), 60_000);
    this.reaper.unref?.();
  }

  list(): { hosts: SessionHostInfo[]; permissions: PermissionRequest[] } {
    return {
      hosts: [...this.hosts.values()].map((h) => this.withPick(h.info)),
      permissions: [...this.pending.values()].map((p) => p.request),
    };
  }

  has(sessionId: string): boolean {
    return this.hosts.get(sessionId)?.active ?? false;
  }

  async create(params: CreateParams): Promise<string> {
    await this.deps.links?.warm(params.prompt);
    // A warm process started without the read-only hook.
    const warm = params.readOnly ? undefined : this.takeWarm(params);
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
        ...(params.readOnly ? { readOnly: true } : {}),
      },
      warm,
    );
    this.deps.onCreated(sessionId);
    if (params.model || params.effort || params.autoPick) this.settings.set(sessionId, { model: params.model, effort: params.effort, autoPick: params.autoPick ?? null });
    this.picks.set(sessionId, params.autoPick ?? null);
    if (warm) {
      // The warm process started with defaults; apply this session's choices before the first message.
      if (params.model) await host.setModel(params.model).catch(() => {});
      if (params.permissionMode !== 'default') await host.setPermissionMode(params.permissionMode).catch(() => {});
    }
    // Claude Code has already failed (no login, a folder it can't start in): no message can go, so say why.
    if (!host.active) throw new RpcError('START_FAILED', host.info.error ?? 'Claude Code stopped before the session started');
    // Return the id now, so the window can show the session (and its setup terminals) right away.
    const setup = params.beforeFirstMessage?.(sessionId).catch((error: Error) => this.deps.log('warn', `Worktree setup failed: ${error.message}`));
    if (params.pickModel) {
      // Your message shows while Auto chooses; Claude Code gets it once the model is set.
      host.send(params.prompt, params.attachments, Promise.all([setup, this.pickModel(host, sessionId, params.pickModel)]));
    } else if (setup) {
      void setup.then(() => host.active && host.send(params.prompt, params.attachments));
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
    // A process the engine left running when it last ended (killed or crashed) still holds the session, and nothing can
    // talk to it: stop it and resume here, as if the engine had closed it then.
    if (!fork && this.deps.isOpenElsewhere(sessionId) && this.deps.stopLeftover?.(sessionId)) await this.waitForExit(sessionId);
    if (!fork && this.deps.isOpenElsewhere(sessionId)) throw new RpcError('SESSION_BUSY_ELSEWHERE', busyMessage);
    const cwd = this.deps.sessionCwd(sessionId);
    if (!cwd) throw new RpcError('NOT_FOUND', 'Unknown session, or its folder is not recorded');
    const profileId = this.deps.sessionProfile(sessionId);
    const saved = this.settings.get(sessionId);
    const permissionMode = this.lastMode.get(sessionId) ?? saved?.permissionMode ?? 'default';
    const model = saved?.model ?? null;
    const effort = saved?.effort ?? null;
    const common = { cwd, profileId, model, permissionMode, effort, worktree: null, ...(this.deps.readOnly?.(sessionId) ? { readOnly: true } : {}) };
    // A fork gets its own id up front, so it is never stored or reported under the original's id
    // (which would show the original as starting, or replace it in the map while it runs here).
    if (fork) return this.spawn({ ...common, sessionId: randomUUID(), forkFrom: sessionId, mode: 'fork' });
    return this.spawn({ ...common, sessionId, mode: 'resume' });
  }

  /**
   * Sends a message. While Claude is busy, `mode` decides: `queue` holds it until the turn ends, `steer` hands it to
   * Claude to read at its next step, `now` stops the turn first (and any message waiting in the queue stays queued).
   * A fork, or an idle session, just sends.
   */
  async send(params: { sessionId: string; text: string; attachments: ImageAttachment[]; fork: boolean; mode?: SendMode }): Promise<{ sessionId: string; messageUuid: string; queued: boolean }> {
    const [host] = await Promise.all([this.ensureHost(params.sessionId, params.fork, 'This session is open in another Claude Code window. Fork it to continue here.'), this.deps.links?.warm(params.text)]);
    const mode = params.mode ?? 'queue';
    let messageUuid: string;
    let queued = false;
    if (!params.fork && host.busy && mode === 'queue') {
      messageUuid = host.enqueue(params.text, params.attachments);
      queued = true;
    } else if (!params.fork && host.busy && mode === 'now') {
      this.denyPending(host.sessionId, 'Interrupted by the user.');
      messageUuid = await host.sendNow(params.text, params.attachments);
    } else messageUuid = host.send(params.text, params.attachments);
    // Wait for a fork to start, so a fork that fails says so, and in case Claude Code settled on another id than the one we gave it.
    const sessionId = params.fork ? await host.initialized : host.sessionId;
    if (params.fork) {
      this.deps.onCreated(sessionId);
      // A fork carries on with the model and effort picked for the original.
      const saved = this.settings.get(params.sessionId);
      if (saved?.model || saved?.effort) this.settings.set(sessionId, { model: saved.model, effort: saved.effort });
    } else this.deps.onContinued?.(sessionId);
    return { sessionId, messageUuid, queued };
  }

  /**
   * After Claude Code failed before it started (a binary that won't launch, a login that ran out): starts the session
   * again and sends what the failed process never got, under the same uuids, so the transcript shows each message once.
   */
  async retry(sessionId: string): Promise<void> {
    const unsent = this.hosts.get(sessionId)?.unsent ?? [];
    if (unsent.length === 0) throw new RpcError('NOT_RUNNING', 'Nothing to send again. Send a message to start the session.');
    const host = await this.ensureHost(sessionId, false, 'This session is open in another Claude Code window. Fork it to continue here.');
    if (!host.active) throw new RpcError('START_FAILED', host.info.error ?? 'Claude Code stopped before the session started');
    for (const message of unsent) host.send(message.text, message.attachments, undefined, message.uuid);
    this.deps.onContinued?.(sessionId);
  }

  /**
   * Forks a session with its own model, effort and mode, and the first message: a pipeline step that starts as a fork
   * of an earlier one (#179). Waits for the fork to start; its id.
   */
  async fork(params: { from: string; text: string; model: string | null; effort: Effort | null; permissionMode: PermissionMode; readOnly?: boolean }): Promise<string> {
    const cwd = this.deps.sessionCwd(params.from);
    if (!cwd) throw new RpcError('NOT_FOUND', 'Unknown session, or its folder is not recorded');
    await this.deps.links?.warm(params.text);
    const saved = this.settings.get(params.from);
    const model = params.model ?? saved?.model ?? null;
    const effort = params.effort ?? saved?.effort ?? null;
    const host = await this.spawn({
      sessionId: randomUUID(),
      forkFrom: params.from,
      mode: 'fork',
      cwd,
      profileId: this.deps.sessionProfile(params.from),
      model,
      permissionMode: params.permissionMode,
      effort,
      worktree: null,
      ...(params.readOnly ? { readOnly: true } : {}),
    });
    host.send(params.text, []);
    const sessionId = await host.initialized;
    this.deps.onCreated(sessionId);
    if (model || effort) this.settings.set(sessionId, { model, effort });
    return sessionId;
  }

  /** Takes a message out of a session's queue (null when it was already sent). Works while the session isn't running too. */
  dequeue(sessionId: string, id: string): { text: string; attachments: ImageAttachment[] } | null {
    const host = this.running(sessionId);
    if (host) return host.dequeue(id);
    const stored = this.deps.upNext?.list(sessionId) ?? [];
    const taken = stored.find((m) => m.id === id);
    if (!taken) return null;
    this.saveQueue(sessionId, stored.filter((m) => m !== taken));
    return { text: taken.text, attachments: taken.attachments };
  }

  moveQueued(sessionId: string, id: string, toIndex: number): void {
    const host = this.running(sessionId);
    if (host) return host.moveQueued(id, toIndex);
    const stored = this.deps.upNext?.list(sessionId) ?? [];
    const at = stored.findIndex((m) => m.id === id);
    if (at < 0) return;
    const [moved] = stored.splice(at, 1);
    stored.splice(Math.min(toIndex, stored.length), 0, moved!);
    this.saveQueue(sessionId, stored);
  }

  /** Sends one queued message now, stopping the turn it waits behind, or resuming the session that kept it. */
  async sendQueuedNow(sessionId: string, id: string): Promise<void> {
    const host = await this.ensureHost(sessionId, false, 'This session is open in another Claude Code window. Close it there to send from Up next.');
    if (host.busy) this.denyPending(sessionId, 'Interrupted by the user.');
    await host.sendQueuedNow(id);
    this.deps.onContinued?.(sessionId);
  }

  /** Sends the next queued message and lets the queue move on again, resuming the session when it isn't running. */
  async resumeQueue(sessionId: string): Promise<void> {
    const host = await this.ensureHost(sessionId, false, 'This session is open in another Claude Code window. Close it there to send from Up next.');
    host.resumeQueue();
    this.deps.onContinued?.(sessionId);
  }

  /** Every session's Up next as it is kept, running here or not; `onUpNext` reports each change after this. */
  upNextLists(): Array<{ sessionId: string; queue: QueuedMessage[] }> {
    return this.deps.upNext?.all() ?? [];
  }

  private running(sessionId: string): SessionHost | null {
    const host = this.hosts.get(sessionId);
    return host?.active ? host : null;
  }

  private saveQueue(sessionId: string, messages: readonly StoredUpNext[]): void {
    this.deps.upNext?.save(sessionId, messages);
    this.deps.onUpNext?.(sessionId, messages.map(summarise));
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

  /** Stops Claude's turn; `upNext` says whether the queue waits for you after it (see `SessionHost.interrupt`). */
  async interrupt(sessionId: string, upNext: 'hold' | 'continue' = 'hold'): Promise<void> {
    this.denyPending(sessionId, 'Interrupted by the user.');
    await this.require(sessionId).interrupt(upNext);
  }

  /**
   * Sends back the session's waiting prompts that `mode` would let run. Claude Code checks a tool call once, when
   * it asks, and answering one prompt lets the next one ask at once: without this, switching to Auto mode right
   * after answering still left that next prompt waiting. Claude makes the call again and it is checked anew.
   * Calls under way are remembered too: Auto mode checks a call as it arrives, so some ask only later (`ask`).
   */
  private recheckPending(sessionId: string, mode: PermissionMode): void {
    const host = this.hosts.get(sessionId);
    if (host?.openToolCalls.size) this.callsBeforeMode.set(sessionId, { mode, toolUseIds: new Set(host.openToolCalls) });
    else this.callsBeforeMode.delete(sessionId);
    for (const [requestId, pending] of this.pending) {
      if (pending.request.sessionId !== sessionId || !recheckAfterModeChange({ toolName: pending.request.toolName, matchedAskRule: pending.matchedAskRule }, mode)) continue;
      this.settle(requestId, { behavior: 'deny', message: RECHECK_MESSAGE });
    }
  }

  /** Pending prompts would otherwise keep the turn alive after it is stopped. */
  private denyPending(sessionId: string, message: string): void {
    for (const [requestId, pending] of this.pending) {
      if (pending.request.sessionId === sessionId) this.settle(requestId, { behavior: 'deny', message, interrupt: true });
    }
  }

  stopTask(sessionId: string, taskId: string): Promise<void> {
    return this.require(sessionId).stopTask(taskId);
  }

  /**
   * What a session resumes with, for the chips of a session that isn't running here. Setting the model, effort or
   * mode while it isn't running only saves it: the next message resumes the session that way.
   */
  savedSettings(sessionId: string): { model: string | null; effort: Effort | null; permissionMode: PermissionMode } {
    const saved = this.settings.get(sessionId);
    return { model: saved?.model ?? null, effort: saved?.effort ?? null, permissionMode: this.lastMode.get(sessionId) ?? saved?.permissionMode ?? 'default' };
  }

  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    if (this.running(sessionId)) {
      await this.require(sessionId).setPermissionMode(mode);
      this.recheckPending(sessionId, mode);
      return;
    }
    // Bypass needs an extra flag at startup, so a resume never starts in it.
    if (mode === 'bypassPermissions') throw new RpcError('INVALID', 'Bypass permissions can only be turned on while the session runs.');
    this.lastMode.set(sessionId, mode);
    this.settings.set(sessionId, { permissionMode: mode });
  }

  async setEffort(sessionId: string, effort: Effort | null): Promise<void> {
    if (this.running(sessionId)) await this.require(sessionId).setEffort(effort);
    this.settings.set(sessionId, { effort });
  }

  async context(sessionId: string): Promise<ContextUsage> {
    const host = this.require(sessionId);
    try {
      return await host.contextUsage();
    } catch (error) {
      if (error instanceof RpcError) throw error;
      // While its process starts or exits, Claude Code can't answer ("ProcessTransport is not ready for writing").
      if (!host.active || host.info.state === 'starting') throw new RpcError('NOT_RUNNING', NOT_RUNNING_MESSAGE);
      throw new RpcError('CONTEXT_FAILED', (error as Error).message);
    }
  }

  /**
   * Waits for Auto's pick and switches the new session to it. Picking the model yourself meanwhile wins: the pick
   * is dropped. A failure starts on the default model, as a pick that failed does.
   */
  private async pickModel(host: SessionHost, sessionId: string, pick: NonNullable<CreateParams['pickModel']>): Promise<void> {
    this.choosing.add(sessionId);
    this.deps.onInfo(this.withPick(host.info));
    try {
      const { model, autoPick } = await pick(sessionId);
      if (!this.choosing.has(sessionId)) return;
      if (model) await host.setModel(model).catch(() => {});
      this.picks.set(sessionId, autoPick);
      this.settings.set(sessionId, { model, autoPick });
    } catch (error) {
      this.deps.log('warn', `Auto couldn't pick a model: ${(error as Error).message}`);
    } finally {
      this.choosing.delete(sessionId);
      this.deps.onInfo(this.withPick(host.info));
    }
  }

  async setModel(sessionId: string, model: string | null): Promise<void> {
    // Changed while Auto was still choosing: your model stays, and Auto's pick won't replace it.
    this.choosing.delete(sessionId);
    const host = this.running(sessionId);
    await host?.setModel(model);
    // Once you pick a model yourself, the session is no longer on Auto's pick: its chip shows the plain model.
    const pick = this.autoPick(sessionId);
    const left = pick && !pick.left ? { ...pick, left: true } : null;
    this.settings.set(sessionId, { model, ...(left ? { autoPick: left } : {}) });
    if (!left) return;
    this.picks.set(sessionId, left);
    // The host already reported the new model, with the pick it had then: report it again so the chip drops "Auto".
    if (host) this.deps.onInfo(this.withPick(host.info));
  }

  /** What Auto picked for a session (null: it didn't), also when it isn't running. */
  autoPick(sessionId: string): AutoPick | null {
    // A host without a proper id must not break the whole list.
    if (typeof sessionId !== 'string' || !sessionId) return null;
    if (!this.picks.has(sessionId)) this.picks.set(sessionId, this.settings.get(sessionId)?.autoPick ?? null);
    return this.picks.get(sessionId) ?? null;
  }

  private withPick(info: SessionHostInfo): SessionHostInfo {
    return {
      ...info,
      autoPick: this.autoPick(info.sessionId),
      ...(this.choosing.has(info.sessionId) ? { autoChoosing: true } : {}),
      usageLimit: this.deps.limits?.of(info.profileId) ?? null,
    };
  }

  /** A profile hit or left a usage limit: its sessions report it, and their queues move on once it is cleared. */
  limitChanged(profileId: string): void {
    for (const host of this.hosts.values()) {
      if (!host.active || host.info.profileId !== profileId) continue;
      this.deps.onInfo(this.withPick(host.info));
      host.drainQueue();
    }
  }

  close(sessionId: string): void {
    const host = this.hosts.get(sessionId);
    if (host?.active) this.closedAt.set(sessionId, Date.now());
    // Stopped while Auto was choosing: the message never goes, and the session no longer says Auto is choosing.
    this.choosing.delete(sessionId);
    host?.close();
    this.callsBeforeMode.delete(sessionId);
    this.deps.onClosed?.(sessionId);
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
    if (decision.behavior === 'allow' && pending.request.toolName === 'ExitPlanMode') {
      const input = decision.updatedInput ?? pending.input;
      const instead = this.deps.planApproved?.(pending.request.sessionId, typeof input.plan === 'string' ? input.plan : '') ?? null;
      if (instead) {
        this.settle(requestId, { behavior: 'deny', message: instead, interrupt: false });
        return;
      }
    }
    if (decision.behavior === 'allow') {
      const result: PermissionResult = {
        behavior: 'allow',
        updatedInput: decision.updatedInput ?? pending.input,
      };
      if (decision.always && pending.suggestions) result.updatedPermissions = pending.suggestions;
      this.settle(requestId, result);
      // "Always" can switch the mode too (Accept edits for this session), which the other waiting prompts miss.
      const mode = result.updatedPermissions?.findLast((u) => u.type === 'setMode');
      if (mode?.type === 'setMode') this.recheckPending(pending.request.sessionId, mode.mode);
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

  /**
   * Has every session running here read its plugins and MCP servers again (a session in a turn does so when the
   * turn ends), and forgets the cached lists, so an MCP server added after the sessions started shows up.
   */
  async reloadPlugins(profileIds: readonly string[]): Promise<void> {
    this.reloadSkills(profileIds);
    await Promise.all([...this.hosts.values()].filter((host) => host.active).map((host) => host.reloadPlugins()));
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
   * `reload` has a running session read its plugins and MCP servers again first.
   */
  async capabilities(sessionId: string | undefined, cwd: string, refresh: boolean, profileId: string, reload = false): Promise<Capabilities> {
    const host = sessionId ? this.hosts.get(sessionId) : undefined;
    const plugins = (profile: string) => () => this.deps.installedPlugins?.(profile) ?? [];
    if (host?.active) {
      if (reload) await host.reloadPlugins();
      return host.capabilities(plugins(host.info.profileId));
    }
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
    if (!host?.active) throw new RpcError('NOT_RUNNING', 'Start the session in Seshboard to change its MCP servers.');
    try {
      await host.mcp(server, action);
    } catch (error) {
      throw new RpcError('MCP_FAILED', (error as Error).message);
    }
  }

  /**
   * Answers a question about a session (Ask about this session) from a short-lived fork of it: resumed with
   * `forkSession` and `persistSession: false`, so the session isn't touched (also while it runs a turn here or in
   * another Claude Code window) and nothing is written. It keeps the session's model, effort and tools, so the prompt
   * cache still matches, and a PreToolUse hook lets only reading through (spike 14). Text comes in through `onText`.
   */
  async askAbout(sessionId: string, prompt: string, onText: (text: AskText) => void): Promise<AskResult> {
    const cwd = this.deps.sessionCwd(sessionId);
    if (!cwd) throw new RpcError('NOT_FOUND', 'Unknown session, or its folder is not recorded');
    const profileId = this.deps.sessionProfile(sessionId);
    const running = this.running(sessionId)?.info;
    const settings = this.settings.get(sessionId);
    const model = running?.model ?? settings?.model ?? null;
    const effort = running?.effort ?? settings?.effort ?? null;
    const [env, claudePath, sdk] = await Promise.all([this.deps.env(profileId), this.deps.claudePath(), this.deps.sdk()]);
    const helperId = randomUUID();
    this.deps.ephemeral?.add(helperId);
    const message: SDKUserMessage = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] }, parent_tool_use_id: null };
    const input: AsyncIterable<SDKUserMessage> = (async function* () {
      yield message;
    })();
    const guard: HookCallback = async (hook) => {
      const tool = hook as { tool_name?: string; tool_input?: unknown };
      const allowed = isReadOnlyTool(tool.tool_name ?? '', (tool.tool_input ?? {}) as Record<string, unknown>);
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: allowed ? 'allow' : 'deny', ...(allowed ? {} : { permissionDecisionReason: READ_ONLY_REASON }) } };
    };
    const query = sdk.query({
      prompt: input,
      options: {
        resume: sessionId,
        forkSession: true,
        // Claude Code takes a custom id with --resume only together with --fork-session; the engine hides it by this id.
        sessionId: helperId,
        persistSession: false,
        cwd,
        env,
        pathToClaudeCodeExecutable: claudePath,
        settingSources: ['user', 'project', 'local'],
        systemPrompt: { type: 'preset', preset: 'claude_code' },
        includePartialMessages: true,
        maxTurns: ASK_MAX_TURNS,
        permissionMode: 'default',
        hooks: { PreToolUse: [{ hooks: [guard] }] },
        // The hook already allowed or denied; this only answers what it let through that would otherwise prompt.
        canUseTool: async (name, toolInput) => (isReadOnlyTool(name, toolInput) ? { behavior: 'allow', updatedInput: toolInput } : { behavior: 'deny', message: READ_ONLY_REASON }),
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        stderr: (data) => this.deps.log('debug', `[claude ask] ${data.trimEnd()}`),
      },
    });
    // Each API response once, by its message id: Claude Code repeats a message's usage on every block of it.
    const responses = new Map<string, AskUsage>();
    let answer: string | null = null;
    let error: string | undefined;
    const run = async () => {
      for await (const event of query) {
        if (event.type === 'stream_event') {
          const raw = event.event as { type?: string; delta?: { type?: string; text?: string } };
          if (event.parent_tool_use_id === null && raw.type === 'content_block_delta' && raw.delta?.type === 'text_delta' && raw.delta.text) onText({ delta: raw.delta.text });
        } else if (event.type === 'assistant') {
          const usage = readUsage(event.message);
          if (usage) responses.set(usage.key, { model: usage.model, tokens: usage.tokens });
          // Text before a tool call is Claude saying what it reads next; the answer comes after.
          if (event.parent_tool_use_id === null && event.message.content.some((block: { type: string }) => block.type === 'tool_use')) onText({ reset: true });
        } else if (event.type === 'result') {
          if (event.subtype === 'success' && !event.is_error) answer = event.result;
          else error = event.subtype === 'error_max_turns' ? 'Claude needed more steps than a side question gets. Ask something narrower.' : (('errors' in event && event.errors[0]) || 'Claude could not answer.');
          break;
        }
      }
    };
    try {
      await Promise.race([run(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Claude took too long to answer.')), ASK_TIMEOUT_MS))]);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      query.close();
      // Its registry entry stays until the process has exited.
      setTimeout(() => this.deps.ephemeral?.delete(helperId), 30_000).unref?.();
    }
    return { answer, ...(error ? { error } : {}), usage: sumByModel([...responses.values()]) };
  }

  /**
   * Runs `ask` against a short-lived Claude Code process for `cwd` that never gets a prompt,
   * so no session is written. It answers control requests (commands, agents, MCP) and is closed after.
   */
  private async withHelper<T>(cwd: string, profileId: string, ask: (query: Query) => Promise<T>, more: { extra?: Partial<Options>; timeoutMs?: number } = {}): Promise<T> {
    const [env, claudePath, sdk] = await Promise.all([this.deps.env(profileId), this.deps.claudePath(), this.deps.sdk()]);
    // A prompt that never yields: Claude Code starts, answers the question, and no session is written.
    const idle: AsyncIterable<SDKUserMessage> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
    const helperId = randomUUID();
    this.deps.ephemeral?.add(helperId);
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
        ...more.extra,
      },
    });
    try {
      return await Promise.race([ask(query), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), more.timeoutMs ?? 20_000))]);
    } finally {
      query.close();
      // Its registry entry stays until the process has exited.
      setTimeout(() => this.deps.ephemeral?.delete(helperId), 30_000).unref?.();
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

  /** Show mods on or off: open sessions attach or detach at once. */
  setShowMods(enabled: boolean): void {
    this.showMods = enabled;
    for (const host of this.hosts.values()) if (host.active) host.mods.setEnabled(enabled);
  }

  /**
   * Use Claude in Chrome on or off. Claude Code reads `--chrome` only at startup, so running sessions keep what they
   * started with; the warm process is dropped, or the next new session would take one started with the old value.
   */
  setChrome(enabled: boolean): void {
    // Main sends every engine setting after any preference change: only a real change costs the warm process.
    if (enabled === this.chrome) return;
    this.chrome = enabled;
    this.discardWarm();
  }

  /** The mods surface of a running session (NOT_RUNNING otherwise). */
  mods(sessionId: string): ModsSurface {
    return this.require(sessionId).mods;
  }

  /** What every running session's mods show. */
  modsSnapshots(): ModsSnapshot[] {
    return [...this.hosts.values()].filter((h) => h.active).map((h) => h.mods.snapshot());
  }

  /** Mod log lines of one session, or of all of them. */
  modLogs(sessionId?: string): ModLog[] {
    const hosts = sessionId ? [this.hosts.get(sessionId)].filter((h) => h !== undefined) : [...this.hosts.values()];
    return hosts.flatMap((h) => h.mods.logLines()).sort((a, b) => a.at - b.at);
  }

  /** A window answered Claude Code's question about its message box; the first answer wins. */
  answerModPrompt(answer: ModPromptAnswer): void {
    const resolve = this.modAsks.get(answer.requestId);
    this.modAsks.delete(answer.requestId);
    resolve?.(answer);
  }

  private askWindow(ask: ModPromptAsk): Promise<ModPromptAnswer | null> {
    const mods = this.deps.mods;
    if (!mods) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.modAsks.delete(ask.requestId);
        resolve(null);
      }, MOD_ASK_MS);
      timer.unref?.();
      this.modAsks.set(ask.requestId, (answer) => {
        clearTimeout(timer);
        resolve(answer);
      });
      mods.ask(ask);
    });
  }

  /** Forgets what a session ran with (it was moved to the Trash). */
  forget(sessionId: string): void {
    this.lastMode.delete(sessionId);
    this.picks.delete(sessionId);
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
        chrome: this.chrome,
        env,
        claudePath,
        canUseTool: (...args) => (route.canUseTool ? route.canUseTool(...args) : Promise.resolve({ behavior: 'deny', message: 'Not ready' })),
      },
      this.deps.log,
    );
    const warm = sdk.startup({ options });
    const timer = setTimeout(() => this.discardWarm(), this.deps.warmTtlMs ?? 120_000);
    timer.unref?.();
    const entry: Warm = { cwd, profileId, sessionId, warm, route, timer };
    this.warm = entry;
    // A process that failed (no login, crashed) is no use to a session: drop it, so the next pre-warm tries again.
    warm.catch((error: unknown) => {
      this.deps.log('debug', `Pre-warm failed: ${(error as Error).message}`);
      if (this.warm === entry) this.discardWarm();
    });
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
    if (!host?.active) throw new RpcError('NOT_RUNNING', NOT_RUNNING_MESSAGE);
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
      ? async (args) => {
          warm.route.canUseTool = canUseTool;
          // It failed after this session took it: start a fresh process, which fails with its own reason if Claude Code can't run.
          const started = await warm.warm.catch((error: Error) => {
            this.deps.log('info', `Pre-warmed process failed (${error.message}); starting a fresh one`);
            return null;
          });
          return started ? started.query(args.prompt) : sdk.query(args);
        }
      : (args) => sdk.query(args);
    const host = new SessionHost(
      { ...config, env, claudePath, canUseTool, limitPrefixes: limitPrefixes(sdk), showMods: this.showMods, chrome: this.chrome },
      {
        info: (info) => this.onInfo(host, info),
        stream: (delta) => this.deps.onStream(delta),
        messages: (id, messages, held) => this.deps.onMessages(id, messages, held),
        log: this.deps.log,
        usageHint: () => this.deps.onUsageHint?.(config.profileId),
        rateLimit: (sessionId, info) => this.deps.onRateLimit?.(config.profileId, sessionId, info),
        knownCommands: () => this.commandsByCwd.get(keyOf({ profileId: config.profileId, cwd: config.cwd })) ?? [],
        // onInfo stores this session's new list right after.
        commandsChanged: () => this.forgetCommands(config.profileId),
        queue: (sessionId, messages) => this.saveQueue(sessionId, messages),
        turnEnded: (sessionId, outcome) => {
          this.callsBeforeMode.delete(sessionId);
          this.deps.onTurnEnd?.(sessionId, outcome);
        },
        limitHit: (sessionId, stop) => this.deps.limits?.hit(config.profileId, sessionId, stop),
        turnOk: (sessionId) => {
          this.deps.limits?.ok(config.profileId, sessionId);
          this.deps.signIns?.ok(config.profileId);
        },
        signedOut: (sessionId, message) => this.deps.signIns?.hit(config.profileId, sessionId, message),
        limited: () => !!this.deps.limits?.of(config.profileId),
        ...(this.deps.links ? { expand: (id: string, text: string) => this.deps.links!.expand(id, text) } : {}),
        mods: this.deps.mods ? { ...this.deps.mods, ask: (ask) => this.askWindow(ask), diagnostics: this.deps.log } : undefined,
      },
      startQuery,
    );
    // A resumed session gets back what was waiting in Up next when it stopped.
    if (config.mode === 'resume') host.restoreQueue(this.deps.upNext?.list(config.sessionId) ?? []);
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
    this.deps.onInfo(this.withPick(info));
  }

  private ask(sessionId: string, toolName: string, input: Record<string, unknown>, options: Parameters<CanUseTool>[2]): Promise<PermissionResult> {
    // Once per call: Claude's new attempt has a new id, so it can't come back here again.
    const before = this.callsBeforeMode.get(sessionId);
    if (before?.toolUseIds.delete(options.toolUseID) && recheckAfterModeChange({ toolName, matchedAskRule: Boolean(options.matchedAskRule) }, before.mode)) {
      return Promise.resolve({ behavior: 'deny', message: RECHECK_MESSAGE });
    }
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
      this.pending.set(requestId, { request, input, suggestions: options.suggestions, matchedAskRule: Boolean(options.matchedAskRule), resolve });
      options.signal.addEventListener('abort', () => this.settle(requestId, { behavior: 'deny', message: 'Cancelled.' }), { once: true });
      // Answered for you: through `respond`, so an approved plan goes through `planApproved` as a click would.
      const auto = this.deps.autoAnswer?.(request) ?? null;
      if (auto) {
        this.respond(requestId, auto);
        return;
      }
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
