import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync, unwatchFile, watchFile, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  BACKUP_SECTIONS,
  BUILTIN_PROFILE_ID,
  COMPANION_DIR,
  contract,
  isSameOrInside,
  RpcError,
  serveRpc,
  type Contract,
  type HookableComponent,
  type HandlerContext,
  type LiveSession,
  type Handlers,
  type LogEntry,
  type LogLevel,
  type ModelOption,
  type RpcServer,
  type AskEvent,
  type SessionHostInfo,
  type TerminalInfo,
  type SlashCommand,
  type SystemInfo,
  type PrError,
  type PrProgress,
  type CloneProgress,
  type WorktreePullRequest,
  type WorktreeSize,
  type Transport,
  type UsageSnapshot,
  type TokenCounts,
  randomWorktreeName,
  worktreeRequestBase,
  isLocalAbsolutePath,
  DAY_MS,
  dueForDeletion,
  KEEP_REASON_TEXT,
  keepReason,
  type KeepReason,
  AUTO_MODEL,
  DEFAULT_AUTO_MODEL,
  type AutoModelPrefs,
  type ResumeAtLimit,
  type AutoPick,
  type CatchUp,
  type QueuedMessage,
  type StreamDelta,
  type PermissionRequest,
  type PromptScope,
  accountKey,
  accountTag,
  type ClaudeWorktreeRequest,
  focusSessions,
  projectOf,
  type LaterItem,
  type LaterDraft,
  type QueueSession,
  type SessionHostInfo as HostInfo,
  clockTime,
  limitAhead,
  Schedule,
  runsBetween,
  triggerProblem,
  Trigger,
  TriggerEvent,
  TriggerSession,
  isBuiltInPipeline,
  parseRunBriefs,
  writeRunBrief,
  writeRunStub,
  PipelineRunState,
} from '@switchboard/protocol';
import { LiveRegistry } from './claude/liveRegistry.ts';
import { createProjectResolver } from './claude/projectResolver.ts';
import { sdkSessionSource, type SessionSource } from './claude/sessionSource.ts';
import { findCheckout, githubPage } from './git/remotes.ts';
import { ChecksWatcher, readCheckLogs, readChecks } from './git/prChecks.ts';
import { createPullRequest, defaultGh, draftRefusal, firstUsefulLine, ghStatus, parseRemoteUrl, PrFailure, prOf, readPrDraft, runGh } from './git/pullRequest.ts';
import { githubStarStatus, StarFailure, starSwitchboard } from './git/githubStar.ts';
import { baseBranch, checkoutRoot, commitAll, DivergedError, fileDiff, git, listBranches, listChanges, listRemoteBranches, removeWorktree, revert, stage, stageForCommit, switchBranch, syncCommand, topLevel, updateCheckout, worktreeStatus } from './git/gitChanges.ts';
import { deleteBranches, fetchAllRemotes, listBranchOverview } from './git/branches.ts';
import { fetchPullRequests, ignoredFiles, listWorktrees, measureSize, removeWorktrees, type SessionActivity, type SessionPlace } from './git/worktrees.ts';
import { SearchIndex } from './sessions/searchIndex.ts';
import { installedPlugins } from './host/capabilities.ts';
import { hookedCacheKey, listMods } from './host/modsCatalog.ts';
import { ActionStore, expandCommand, suggestActions } from './actions/actionStore.ts';
import { SharedFileWatcher } from './actions/sharedFileWatcher.ts';
import { SavedPromptStore } from './prompts/savedPromptStore.ts';
import { GithubService } from './git/github.ts';
import { FORK_READ_ONLY, GithubOriginStore } from './git/githubOrigins.ts';
import { checkoutPullRequest as checkoutPullRequest_, PrCheckoutError } from './git/prCheckout.ts';
import { makeWorktreeFrom, WorktreeFromError } from './git/worktreeFrom.ts';
import { LaterStore } from './later/laterStore.ts';
import { QueueAutoStarter } from './later/autoStart.ts';
import { ScheduleStore } from './schedules/scheduleStore.ts';
import { Scheduler, type RunHold } from './schedules/scheduler.ts';
import { readWorkflows } from './triggers/sources/ci.ts';
import { readLogin, readRepo } from './triggers/sources/gh.ts';
import { readCollaborators } from './triggers/sources/issues.ts';
import { TriggerStore } from './triggers/triggerStore.ts';
import { TriggerWatcher } from './triggers/watcher.ts';
import { summarise, UpNextStore } from './host/upNextStore.ts';
import { Asker, AskStore } from './host/sideQuestions.ts';
import { MemoryService, type MemoryTrashScope } from './memory/memoryService.ts';
import { MemoryWatcher } from './memory/watcher.ts';
import { MemorySearch, type IndexedFolder } from './memory/memorySearch.ts';
import { candidatesFromPaste, candidatesOf } from './memory/claudeExport.ts';
import { readExport } from './memory/memoryImport.ts';
import { findSecrets } from './memory/secrets.ts';
import { PERSONAL_DIR_KEY } from './settings/settingsTransfer.ts';
import { DEFAULT_RETENTION, DRAFTS_KEY, megabytes, retentionCandidates, sessionsWithDrafts, sessionsWithQueuedPrompts, type RetentionPolicy } from './sessions/retention.ts';
import { readProfileCleanup, settingsPathOf, writeProfileCleanup } from './profiles/cleanupPeriod.ts';
import { HostManager, type SdkRuntime } from './host/hostManager.ts';
import { LinkService } from './links/linkService.ts';
import { expandMessage, GithubExpander } from './links/githubExpand.ts';
import { LinkStore } from './links/linkStore.ts';
import { lastTurn } from './catchUp/turn.ts';
import { createSessionSettingsStore } from './host/sessionSettings.ts';
import { UsageMonitor } from './host/usageMonitor.ts';
import { commandRunMessage, shellName } from './terminals/outputMessage.ts';
import { readTaskOutput } from './host/taskOutput.ts';
import { agentUsage } from './usage/agentUsage.ts';
import { UsageInsights } from './usage/usageInsights.ts';
import { scopeOf } from './usage/usageScanner.ts';
import { ModelRouter, RoutingStore, stubRoute } from './autoModel/router.ts';
import { CatchUpService } from './catchUp/catchUpService.ts';
import { CatchUpStore, CatchUpUsageStore } from './catchUp/catchUpStore.ts';
import { stubAnswer, Summarizer } from './catchUp/summary.ts';
import { COMMIT_SYSTEM_PROMPT, commitContext, commitMessageInput, parseCommitMessage, stubCommitMessage } from './git/commitMessage.ts';
import { ProjectRegistry, type FolderActivity } from './projects/projectRegistry.ts';
import { QuestionsFolder } from './questions/questionsFolder.ts';
import { createAppStateStore, type JsonValue } from './db/appState.ts';
import { ConfigDirLane } from './profiles/configDirLane.ts';
import { AccountWatcher } from './profiles/accountWatcher.ts';
import { ProfileStore, type ProfileRuntime } from './profiles/profileStore.ts';
import { MultiProfileSource } from './profiles/profileSources.ts';
import { openCacheDatabase } from './db/database.ts';
import { findClaude } from './system/claudeBinary.ts';
import { ClaudeUpdater, type ClaudeUpdaterOptions } from './system/claudeUpdater.ts';
import { normaliseMessage } from './claude/transcript.ts';
import { SessionIndex } from './sessions/sessionIndex.ts';
import { exportSettings, planImport, readSettingsFile, writeBackup, writeSettingsFile, type SettingsStores } from './settings/settingsTransfer.ts';
import { TerminalManager, type SpawnPty } from './terminals/terminalManager.ts';
import { TranscriptHub } from './sessions/transcriptHub.ts';
import { diagnoseTranscript } from './sessions/transcriptDiagnosis.ts';
import { continueInEditor, detectEditors, openInEditor } from './system/editors.ts';
import { CompanionHub } from './companion/companionHub.ts';
import { RemoteHub } from './remote/remoteHub.ts';
import { CloneService } from './projects/cloneService.ts';
import { ComputerHub } from './remote/computerHub.ts';
import { FileIndex } from './system/files.ts';
import { readPreview, readPreviewImage } from './system/filePreview.ts';
import { listFolders } from './system/folders.ts';
import { ShellEnvironment } from './system/shellEnvironment.ts';
import { detectTerminalFont } from './system/terminalFont.ts';
import type { ShellEnv } from './system/shellEnv.ts';
import { LimitStore } from './usageLimit/limitStore.ts';
import { remoteLimit, RESUME_PROMPT, snapshotReset } from './usageLimit/usageLimit.ts';
import { UsageLimits } from './usageLimit/usageLimits.ts';
import { PipelineStore } from './pipelines/pipelineStore.ts';
import { isRunId, RunStore } from './pipelines/runStore.ts';
import { PipelineRunner, type StepHold } from './pipelines/runner.ts';
import { findNamed, runActionsFirst, runCommand } from './pipelines/actionsFirst.ts';
import { commitAndOpen, previewPush } from './pipelines/push.ts';
import pkg from '../package.json' with { type: 'json' };

export interface EngineOptions {
  /** Where the app keeps its own data (the cache database lives here). */
  dataDir: string;
  /** The built-in profile's config folder. Defaults to $CLAUDE_CONFIG_DIR or ~/.claude. */
  claudeConfigDir?: string;
  /** Use this `claude` binary instead of searching PATH. */
  claudeBinary?: string;
  /** Skip reading the login shell (tests). Defaults to resolving it. */
  shellEnv?: Promise<ShellEnv>;
  /** Mirror of every log entry, e.g. to write it to stderr. */
  onLog?: (entry: LogEntry) => void;
  /** Where the built-in profile's sessions are read from. Defaults to the Claude Agent SDK (tests pass a fake). */
  sessionSource?: SessionSource;
  /** Start watching ~/.claude immediately. Defaults to true. */
  watchSessions?: boolean;
  /** Claude Code itself. Defaults to the Agent SDK (tests pass a fake). */
  sdk?: () => Promise<SdkRuntime>;
  /**
   * Moves files to the Trash. The desktop app routes this to Electron's
   * shell.trashItem; without it, deleted sessions are removed permanently. Session files are
   * scoped to the config folder they live in, files of a revert to their repository.
   */
  trash?: (paths: string[], scope: TrashScope) => Promise<void>;
  /** Pseudo-terminal factory. Defaults to node-pty. */
  spawnPty?: () => Promise<SpawnPty>;
  /**
   * The Claude Code update check. `automatic: false` skips the checks after launch (tests);
   * `allowUpdate: false` refuses to run an update command (the smoke test).
   */
  claudeUpdates?: Pick<ClaudeUpdaterOptions, 'registryUrl' | 'allowUpdate' | 'run'> & { automatic?: boolean };
  /**
   * Listens for the VS Code companion on a Unix socket and writes where to `<dataDir>/companion/engine.json`. Off
   * when left out (tests). `appVersion` is the app's, for the extension; `socketParent` is where the socket's folder
   * is made (the temporary folder by default).
   */
  companion?: { appVersion: string; socketParent?: string };
  /**
   * Remote, a paired phone following and steering sessions (docs/remote-access.md). `appUrl` is the remote app's
   * address (the website's by default); `previewApp` also lets in the preview's (development and beta builds). `identity` asks main for Remote's key, which it keeps in the system's
   * keychain; only called once Remote is on. Off when left out (tests); nothing listens until Settings › Remote
   * turns it on. `deviceKey` asks main for this app's own key for other computers (Other computers), kept the same
   * way; only called once one is paired. Without it, this app can't pair with another computer.
   */
  remote?: { appVersion: string; appUrl?: string; previewApp?: boolean; identity(): Promise<Uint8Array | null>; deviceKey?(): Promise<Uint8Array | null> };
  /**
   * Plan usage to report per config folder instead of asking Claude Code, with its % history: the website's
   * screenshots, whose made-up logins have no plan. Never set in normal use.
   */
  demoUsage?: DemoUsage;
  /**
   * Auto model's routing without a model call: the smoke test and the screenshots, which must never call a real
   * model. Never set in normal use.
   */
  stubRouter?: boolean;
  /**
   * Questions about a session (Ask about this session, `/btw`) answered with a made-up answer instead of asking
   * Claude Code: the smoke test and the screenshots, which must never call a model. Never set in normal use.
   */
  stubSideQuestions?: boolean;
  /**
   * Catch-up summaries made up from the tool calls instead of asking Haiku: the smoke test and the screenshots, which
   * must never call a model. Never set in normal use.
   */
  stubCatchUp?: boolean;
  /**
   * Clone from GitHub clones from this folder (`<folder>/<owner>/<name>.git`) instead of GitHub, never with gh: the
   * smoke test and the screenshots, which must never clone from the network. Never set in normal use.
   */
  cloneSource?: string;
  /**
   * The smoke test and the screenshots: queued items that start by themselves leave the queue as if started, without
   * a session (which would send the prompt to Claude), and `smokeQueueHost` drives a stand-in session for them to
   * wait on. Never set in normal use.
   */
  stubQueueStarts?: boolean;
  /** Run scheduled sessions (#173). Off in tests that don't look at them, so no timer outlives them. */
  schedules?: boolean;
}

/** See `EngineOptions.demoUsage`. */
export interface DemoUsage {
  profiles: Array<{
    configDir: string;
    snapshot: UsageSnapshot;
    history?: Array<{ at: number; kind: string; scope?: string | null; percent: number; resetsAt: number | null }>;
  }>;
  /** Auto model's picks and routing calls for the demo sessions (`sessionId` null: a call whose session isn't in the demo). */
  autoPicks?: Array<{ configDir: string; sessionId: string | null; pick: AutoPick; routingModel: string; tokens: TokenCounts }>;
  /** Catch-up cards for the demo sessions, as if their turns had just finished. */
  catchUps?: CatchUp[];
  /**
   * A file the screenshot tour writes to show a usage limit on one session, only for its picture: `{ sessionId, kind,
   * resetsAt, held }` sets it (with `held` messages in its Up next), anything else (or no file) clears it.
   */
  limitFile?: string;
  /**
   * A file the screenshot tour writes to show a demo session as working in Switchboard rather than in the terminal,
   * so a queued item can start after it, only for the queue's picture: `{ sessionId, cwd }` sets it, anything else (or
   * no file) clears it. With `stubQueueStarts` only, which keeps the item from starting Claude Code.
   */
  queueHostFile?: string;
  /**
   * A file the screenshot tour writes to show schedules with past runs (skipped, missed, paused), only for their
   * pictures: a list of schedules puts them in as they are, anything else (or no file) takes them out again. With
   * `stubQueueStarts` only, which keeps a run from starting Claude Code.
   */
  schedulesFile?: string;
  /**
   * A file the screenshot tour writes to show triggers with their events, only for their pictures:
   * `{ triggers, events, sessions }` puts them in as they are (checked at their `lastCheckedAt`), anything else (or no
   * file) takes them out again. With `stubQueueStarts` only, which keeps a start from reaching Claude Code.
   */
  triggersFile?: string;
  /**
   * A file the screenshot tour writes to show pipeline runs (#179), only for their pictures: a list of runs with their
   * steps (`PipelineRunState`) puts them in as they are, with each step's session under its parent; anything else (or
   * no file) takes them out again. With `stubQueueStarts` only, which keeps a run from starting Claude Code.
   */
  pipelinesFile?: string;
}

/** What one run of the clean-up of archived sessions did. */
export interface ArchivedCleanup {
  deleted: number;
  bytes: number;
  kept: number;
  failed: number;
}

/** Session files go by their config folder, a revert's files by their repository, memory files by their folder. */
export type TrashScope = { configDir: string } | { repoRoot: string } | MemoryTrashScope;

export interface Engine {
  /** Serves the contract over a transport (one per window). Returns a detach function. */
  attach(transport: Transport): () => void;
  log(level: LogLevel, message: string): void;
  /** Settings › Sessions, from main: the archive days and deleting archived sessions. */
  setRetention(policy: RetentionPolicy): void;
  /** Settings › Conversation › Auto model, from main. */
  setAutoModel(prefs: AutoModelPrefs): void;
  /** Settings › Conversation › Catch-up: write the summaries with Haiku (else from the tool calls), from main. */
  setCatchUpSummaries(enabled: boolean): void;
  /** Settings › Conversation › Resume after a usage limit resets, from main. */
  setResumeAtLimit(mode: ResumeAtLimit): void;
  /**
   * Settings › Focus, from main: the focus limit (null when off) and whether terminal and IDE sessions count. A
   * queued item that starts by itself never asks at the limit; it waits for a free slot.
   */
  setQueueFocus(focus: { limit: number | null; countExternal: boolean }): void;
  /**
   * With `stubQueueStarts` only: a stand-in session this app "runs", for the smoke test's queue step. `running` starts
   * a turn, `idle` ends it with `outcome`, `closed` takes it away.
   */
  smokeQueueHost(host: { sessionId: string; cwd: string; state: 'running' | 'idle' | 'closed'; outcome?: 'clean' | 'error' | 'stopped' }): void;
  /**
   * With `stubQueueStarts` only: ends a pipeline step's turn (#179) for the smoke test, with the reply its verdict is
   * read from. The steps are stand-in sessions there, and what each got is in `smoke-pipeline-starts.jsonl`.
   */
  smokePipelineTurn(turn: { sessionId: string; outcome: 'clean' | 'error' | 'stopped'; reply: string }): Promise<void>;
  /** The computer woke (`powerMonitor` `resume`, from main): scheduled runs due while it slept are dealt with now. */
  wake(): void;
  /**
   * With `stubQueueStarts` only: moves the schedules' clock on by `ms`, for the smoke test, and looks for runs that are
   * due now.
   */
  advanceScheduleClock(ms: number): void;
  /** Settings › Mods › Show mods, from main: sessions attach or detach their mods at once. */
  setShowMods(enabled: boolean): void;
  /** Settings › General › Use Claude in Chrome, from main: sessions started or resumed after it changes get `--chrome`. */
  setChrome(enabled: boolean): void;
  /** Settings › Theme › App icon, from main: the colourway paired phones show (an `AppIconKey`, Graphite with the phone's switch off). */
  setAppIcon(key: string): void;
  /** Whether a window has focus, from main: running pull request checks are read every 30 seconds then, else every 5 minutes. */
  setForeground(foreground: boolean): void;
  /**
   * The smoke run's mods step (`SWITCHBOARD_SMOKE_MODS`): adds a throwaway profile whose sessions load the test mod,
   * starts a session there with the mod's own `/smoke-ping` (answered without the model), and writes its id and
   * whether its Claude Code draws mods to the file the step reads.
   */
  startModsSmoke(): Promise<void>;
  /** Runs the clean-up of archived sessions now (it also runs on launch and daily). Null when deleting is off. */
  deleteArchivedNow(): Promise<ArchivedCleanup | null>;
  close(): void;
}

/** The built-in profile keeps the key used before profiles existed. */
const commandCacheKey = ({ profileId, cwd }: { profileId: string; cwd: string }) =>
  profileId === BUILTIN_PROFILE_ID ? `commands:${cwd}` : `commands:${profileId}:${cwd}`;

/** The path's stat, or undefined when it is missing, also when a folder on the way became a file (ENOTDIR). */
const statSafe = (path: string) => {
  try {
    return statSync(path, { throwIfNoEntry: false });
  } catch {
    return undefined;
  }
};

export function createEngine(options: EngineOptions): Engine {
  const startedAt = Date.now();
  const claudeConfigDir = options.claudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  const configDirFromEnv = Boolean(options.claudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR);
  const cache = openCacheDatabase(join(options.dataDir, 'cache.sqlite'));
  const appState = createAppStateStore(cache.db);
  const servers = new Set<RpcServer<Contract>>();

  const log = (level: LogLevel, message: string) => {
    const entry: LogEntry = { level, message, at: Date.now() };
    options.onLog?.(entry);
    for (const server of servers) server.emit('engine.log', entry);
  };

  /** The VS Code companion's socket, when this engine listens for it. */
  let companion: CompanionHub | null = null;
  /** Remote, when this engine offers it. */
  let remote: RemoteHub | null = null;
  /** Other computers this app paired with, when this engine can keep a key for them. */
  let computers: ComputerHub | null = null;
  /** The sidebar's scope in the window that reported focus last, so a phone lists what the sidebar lists. */
  let sidebarScope: 'switchboard' | 'all' = 'switchboard';
  /** Set once the clean-up of archived sessions exists: it first runs after the first full scan. */
  let scanCompleteHook: () => void = () => {};
  /** Set once memory search exists: every memory change (Switchboard's or a watcher's) re-indexes the files that changed. */
  let memoryChangedHook: () => void = () => {};
  let memorySyncTimer: ReturnType<typeof setTimeout> | undefined;
  const broadcast: RpcServer<Contract>['emit'] = (name, payload) => {
    for (const server of servers) server.emit(name, payload);
    if (name === 'sessions.changed' || name === 'sessions.live' || name === 'session.host' || name === 'session.permission' || name === 'session.permissionResolved') {
      companion?.sessionsChanged();
      remote?.sessionsChanged();
    }
    // Pushes to paired phones: a prompt opened, a turn ended.
    if (name === 'session.permission') remote?.permissionAsked(payload as PermissionRequest);
    if (name === 'session.host') remote?.hostChanged(payload as SessionHostInfo);
    // Phones only hear these for the session they watch.
    if (name === 'session.stream') remote?.stream(payload as StreamDelta);
    if (name === 'limits.changed') remote?.limitsChanged();
    if (name === 'upNext.changed') {
      const { sessionId, queue } = payload as { sessionId: string; queue: QueuedMessage[] };
      remote?.upNextChanged(sessionId, queue);
    }
    if (name === 'catchup.changed') {
      const { sessionId, catchUp: card } = payload as { sessionId: string; catchUp: CatchUp | null };
      remote?.catchUpChanged(sessionId, card);
    }
    if (name === 'session.ask') remote?.askEvent(payload as AskEvent);
    if (name === 'usage.changed') {
      const { profileId, usage } = payload as { profileId: string; usage: UsageSnapshot | null };
      remote?.usageChanged(profileId, usage);
    }
    if (name === 'memory.changed') memoryChangedHook();
  };

  // Slow-ish (login shell), so start it now and await on demand. Before any transcript is read: the
  // shell must inherit the engine's own environment, not a profile's folder (see ConfigDirLane).
  const shell = new ShellEnvironment(appState, options.shellEnv ? () => options.shellEnv! : undefined);
  // One Claude Code login per config folder. Profiles can be added and removed at runtime, so
  // everything per profile (sources, live registries, usage) is looked up through `profiles`.
  const profiles = new ProfileStore(cache.db, appState, { configDir: claudeConfigDir, fromEnv: configDirFromEnv }, (snapshot) => {
    broadcast('profiles.changed', snapshot);
    profilesChanged();
  });
  // The SDK's transcript readers take the folder from process.env.CLAUDE_CONFIG_DIR: one folder at a time.
  const lane = new ConfigDirLane();
  const sdkSources = new Map<string, SessionSource>();
  const sourceFor = (profile: ProfileRuntime): SessionSource => {
    if (options.sessionSource && profile.id === BUILTIN_PROFILE_ID) return options.sessionSource;
    const key = `${profile.id}\0${profile.configDir}`;
    let found = sdkSources.get(key);
    if (!found) sdkSources.set(key, (found = sdkSessionSource((fn) => lane.run(profile.envDir, fn))));
    return found;
  };
  const source = new MultiProfileSource(() => profiles.runtimes().map((profile) => ({ profileId: profile.id, source: sourceFor(profile) })));
  const resolver = createProjectResolver();
  const transcripts = new TranscriptHub(source, log);
  const owned = new Set(
    (cache.db.prepare('SELECT id FROM owned_sessions').all() as Array<{ id: string }>).map((r) => r.id),
  );
  const markOwned = cache.db.prepare('INSERT OR IGNORE INTO owned_sessions (id, created_at) VALUES (?, ?)');
  const unmarkOwned = cache.db.prepare('DELETE FROM owned_sessions WHERE id = ?');
  const continued = new Set(
    (cache.db.prepare('SELECT id FROM continued_sessions').all() as Array<{ id: string }>).map((r) => r.id),
  );
  const markContinued = cache.db.prepare('INSERT OR IGNORE INTO continued_sessions (id, created_at) VALUES (?, ?)');
  const unmarkContinued = cache.db.prepare('DELETE FROM continued_sessions WHERE id = ?');
  // Sessions never use this fallback (see sessionTrash): they are only ever moved to the Trash.
  const trash = options.trash ?? (async (paths: string[], _scope: TrashScope) => paths.forEach((p) => rmSync(p, { recursive: true, force: true })));
  const storedBaseline = appState.get('sessions.baseline');
  const baseline = typeof storedBaseline === 'number' ? storedBaseline : Date.now();
  if (typeof storedBaseline !== 'number') appState.set('sessions.baseline', baseline);
  const projects = new ProjectRegistry(cache.db, join(options.dataDir, 'project-icons'));
  /** Where quick questions run: never one of the projects, so it is left out of every project list. */
  const questions = new QuestionsFolder(join(options.dataDir, 'questions'));
  const listProjects = () => projects.list(folderActivity()).filter((p) => !questions.contains(p.root));
  // --- Clone from GitHub: Settings › Projects ----------------------------------------------------------------------
  /** Clones started from a phone or another computer, by job id: their progress goes back to that connection too. */
  const cloneListeners = new Map<string, (progress: CloneProgress) => void>();
  const clones = new CloneService({
    appState,
    home: homedir(),
    env: async () => (await shell.ready).env,
    gh: defaultGh(),
    ...(options.cloneSource ? { source: options.cloneSource } : {}),
    addProject: (root) => projects.add(root),
    isProject: (root) => listProjects().some((p) => p.added && isSameOrInside(p.root, root) && isSameOrInside(root, p.root)),
    progress: (progress) => {
      broadcast('projects.cloneProgress', progress);
      cloneListeners.get(progress.jobId)?.(progress);
      if (progress.state !== 'running') cloneListeners.delete(progress.jobId);
    },
    settingsChanged: (settings) => broadcast('projects.cloneSettings', settings),
    log,
  });
  /** Starts queued items by themselves (set up with the queue, below); sessions and the registry poke it from here on. */
  let autoStarter: QueueAutoStarter | undefined;
  // --- Pipelines (#179): the stores are here, since the session index reads each sub-session's parent ----------------
  const pipelineStore = new PipelineStore(cache.db);
  const runStore = new RunStore(cache.db);
  /** Runs pipelines (set up with the schedules, below); sessions, limits and the registry poke it like the queue. */
  let runner: PipelineRunner | undefined;
  /** Event triggers (#180), set up with the schedules, below. */
  let triggerWatcher: TriggerWatcher | undefined;
  /** Titles scheduled runs once their transcript is there (set up with the schedules, below). */
  let titleRuns: ((ids: readonly string[]) => void) | undefined;
  const sessions = new SessionIndex({
    baseline,
    isOwned: (id) => owned.has(id),
    isContinued: (id) => continued.has(id),
    parentOf: (id) => runStore.parentOf(id),
    db: cache.db,
    source,
    projectsDirs: () => profiles.runtimes().map((profile) => ({ profileId: profile.id, dir: join(profile.configDir, 'projects') })),
    resolver,
    log,
    onChange: (change) => {
      broadcast('sessions.changed', change);
      if (change.upserted.length) titleRuns?.(change.upserted.map((s) => s.id));
      // Reading a session frees a slot under the focus limit.
      void autoStarter?.check();
      runner?.check();
      scheduleSearchSync();
      if (change.complete) scanCompleteHook();
    },
    onTranscriptChanged: (id) => transcripts.changed(id),
  });
  // Full-text search: indexed in the background, a little after anything changes.
  const search = new SearchIndex(
    cache.db,
    source,
    () => sessions.snapshot().sessions.map((s) => ({ id: s.id, version: `${s.updatedAt}:${s.fileSize ?? ''}` })),
    log,
    (id, messages) => links.transcriptRead(id, messages),
  );
  // --- Session linking (docs/session-linking.md) ---------------------------------------------------------------------
  const linkStore = new LinkStore(cache.db);
  const links = new LinkService({
    store: linkStore,
    session: (id) => sessions.get(id),
    status: (id) => {
      const state = hosts.list().hosts.find((h) => h.sessionId === id)?.state ?? liveList().find((l) => l.sessionId === id)?.status;
      return state === 'running' ? 'working' : state === 'needs-you' ? 'waiting' : null;
    },
    catchUp: (id) => catchUpStore.get(id),
    projectName: (root) => listProjects().find((p) => p.root === root)?.name ?? null,
    inRepo: (folder) => !!resolver.resolve(folder).gitDir,
    pullRequests: (root) => pullRequestsFor(root, false),
    commits: async (folder, branch, base) => {
      const from = base ?? (await baseBranch(folder));
      const range = from ? [`${from}..${branch}`] : [branch];
      const out = await git(folder, ['log', '--oneline', '--no-decorate', '--max-count=10', ...range], { timeout: 5_000 });
      return out.split('\n').map((line) => line.trim()).filter(Boolean);
    },
    lastReply: async (id) => lastTurn(await source.messages(id))?.finalText ?? null,
    plan: (id) => runStore.planOf(id),
    log,
  });
  /** Issues and pull requests through gh: the `#` list, blanks, New session and what Claude gets share its cache. */
  const github = new GithubService({ gh: defaultGh, env: () => shell.ready.then(({ env }) => env) });
  /** Attached issues and pull requests, written out for Claude right before it reads the message. */
  const githubContext = new GithubExpander(github);
  /** The issue or pull request each session started from, and the forks' pull requests Switchboard can't push to. */
  const githubOrigins = new GithubOriginStore(cache.db);
  // A fixed delay, not a debounce: busy sessions change every second and must not keep pushing it back.
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleSearchSync(delayMs = 3_000) {
    if (searchTimer) return;
    searchTimer = setTimeout(() => {
      searchTimer = undefined;
      void search.sync();
    }, delayMs);
    searchTimer.unref?.();
  }
  /** The engine's own short-lived helper processes (usage, command lists): never shown as live sessions. */
  const ephemeral = new Set<string>();
  /** Running Claude Code processes, from each profile's `sessions` folder. */
  const registries = new Map<string, LiveRegistry>();
  const liveList = (): LiveSession[] => [...registries.values()].flatMap((r) => r.list());
  const scanLive = () => registries.forEach((r) => r.scan());
  /** One registry per profile folder; started ones follow profiles being added and removed. */
  const syncRegistries = (start: boolean) => {
    const wanted = new Map(profiles.runtimes().map((p) => [`${p.id}\0${p.configDir}`, p]));
    for (const [key, registry] of registries) {
      if (!wanted.has(key)) {
        registry.stop();
        registries.delete(key);
      }
    }
    for (const [key, profile] of wanted) {
      if (registries.has(key)) continue;
      const registry = new LiveRegistry({
        ignore: (id) => ephemeral.has(id),
        dir: join(profile.configDir, 'sessions'),
        profileId: profile.id,
        resolveRoot: (cwd) => resolver.resolve(cwd).root,
        onChange: () => {
          broadcast('sessions.live', { live: liveList() });
          void autoStarter?.check();
          runner?.check();
        },
      });
      registries.set(key, registry);
      if (start) registry.start();
    }
  };
  const watching = options.watchSessions !== false;
  syncRegistries(watching);
  if (watching) sessions.start();
  // Signing in happens in a terminal (`/login`), outside Switchboard: follow each profile's login file.
  const accounts = new AccountWatcher(
    () => profiles.accountFiles(),
    () => {
      const snapshot = profiles.refreshAccounts();
      if (snapshot) broadcast('profiles.changed', snapshot);
    },
  );
  if (watching) accounts.start();

  /** Profiles were added or removed: read their folders (or stop reading them). */
  function profilesChanged() {
    syncRegistries(watching);
    if (watching) accounts.sync();
    broadcast('sessions.live', { live: liveList() });
    void sessions.rootsChanged();
    const ids = new Set(profiles.runtimes().map((p) => p.id));
    for (const [id, monitor] of usageMonitors) {
      if (!ids.has(id)) {
        monitor.stop();
        usageMonitors.delete(id);
      }
    }
  }

  /** The profile a session belongs to: where its transcript is, or the process that runs it. */
  const sessionProfile = (sessionId: string): string =>
    sessions.get(sessionId)?.profileId ??
    liveList().find((l) => l.sessionId === sessionId)?.profileId ??
    source.ownerOf(sessionId) ??
    profiles.defaultId();
  /** The profile new sessions in a folder's project use. */
  const folderProfile = (cwd: string) => profiles.forProject(resolver.resolve(cwd).root);
  const requireProfile = (id: string) => {
    if (!profiles.has(id)) throw new RpcError('NOT_FOUND', 'That Claude profile no longer exists');
    return id;
  };

  /** Transcript subscriptions per connection, so `transcript.unwatch` and disconnects can clean up. */
  const subscriptions = new WeakMap<HandlerContext<Contract>, Map<string, () => void>>();
  const subscriptionsFor = (context: HandlerContext<Contract>) => {
    let map = subscriptions.get(context);
    if (!map) {
      const created = new Map<string, () => void>();
      subscriptions.set(context, created);
      context.onDispose(() => {
        for (const stop of created.values()) stop();
        created.clear();
      });
      map = created;
    }
    return map;
  };

  if (cache.recovered) log('warn', 'Cache database was corrupt; it was moved aside and rebuilt');
  if (cache.fallback) log('warn', `Cache database left untouched (${cache.fallback.reason}); this run uses ${cache.path}`);

  // Found again by the Claude Code updater (after an update, and on each check), so new sessions use the version installed now.
  let claude = shell.forLookup().then((env) => findClaude(env, options.claudeBinary));
  const findClaudeAgain = () => (claude = shell.forLookup().then((env) => findClaude(env, options.claudeBinary)));
  const claudeUpdater = new ClaudeUpdater({
    store: appState,
    findClaude: findClaudeAgain,
    override: options.claudeBinary !== undefined,
    claudeConfigDir,
    env: () => shell.forLookup(),
    ready: Promise.all([shell.ready, claude]),
    onChange: (state) => broadcast('claudeUpdate.changed', state),
    log,
    ...options.claudeUpdates,
  });
  if (options.claudeUpdates?.automatic !== false) claudeUpdater.start();
  const files = new FileIndex();

  const sdk = options.sdk ?? (() => import('@anthropic-ai/claude-agent-sdk'));
  /** The login shell's environment, pointed at a profile's config folder. */
  /** Plugin folders the smoke run's throwaway profile loads (`startModsSmoke`). */
  const smokePluginDirs = new Map<string, string>();
  const envFor = async (profileId: string): Promise<Record<string, string>> => {
    const env = { ...(await shell.ready).env };
    const { envDir } = profiles.runtime(profileId);
    if (envDir) env.CLAUDE_CONFIG_DIR = envDir;
    const pluginDirs = smokePluginDirs.get(profileId);
    if (pluginDirs) env.CLAUDE_CODE_PLUGIN_DIRS = pluginDirs;
    return env;
  };
  /** Keeps what mods replace in a profile's sessions, under the key of its plugin settings (`mods.hooked`). */
  const rememberHooked = async (sessionId: string, hooked: HookableComponent[]) => {
    try {
      const profileId = sessionProfile(sessionId);
      const key = hookedCacheKey({ profileId, configDir: profiles.runtime(profileId).configDir, env: await envFor(profileId) });
      const stored = appState.get(`mods-hooked:${profileId}`) as { key: string; hooked: HookableComponent[] } | null;
      if (stored?.key !== key || stored.hooked.join() !== hooked.join()) appState.set(`mods-hooked:${profileId}`, { key, hooked });
    } catch (error) {
      log('debug', `Mods: keeping the hooked list failed: ${(error as Error).message}`);
    }
  };
  /** Plan usage per profile (each login has its own limits), started when first asked for. */
  const usageMonitors = new Map<string, UsageMonitor>();
  const usageFor = (profileId: string) => {
    let monitor = usageMonitors.get(profileId);
    if (!monitor) {
      monitor = new UsageMonitor({
        sdk,
        env: () => envFor(profileId),
        claudePath: async () => (await claude)?.path,
        onChange: (snapshot) => broadcast('usage.changed', { profileId, usage: snapshot }),
        onFetched: (snapshot) => insights.recordSnapshot(profileId, snapshot),
        log,
        ephemeral,
        ...(demoFor(profileId) ? { fixed: demoFor(profileId)!.snapshot } : {}),
      });
      usageMonitors.set(profileId, monitor);
    }
    return monitor;
  };
  /** Where each profile's tokens went (from its transcripts) and its plan % over time, for the Usage view. */
  const insights = new UsageInsights({
    db: cache.db,
    profiles: () => profiles.runtimes().map((p) => ({ id: p.id, configDir: p.configDir })),
    lookup: {
      session: (id) => {
        const summary = sessions.get(id);
        return summary ? { title: summary.title, projectRoot: summary.projectRoot } : null;
      },
      projectOf: (cwd) => resolver.resolve(cwd).root,
      projectName: (root) => projects.addedEntries().find((p) => p.root === root)?.name ?? basename(root),
    },
    snapshot: (profileId) => usageMonitors.get(profileId)?.current() ?? null,
    onTokens: (profileIds, scan) => broadcast('usage.tokens', { profileIds, scan }),
    log,
  });
  /** The made-up plan numbers for a profile's folder, when the engine runs for the website's screenshots. */
  const demoFor = (profileId: string) => {
    const dir = profiles.runtimes().find((p) => p.id === profileId)?.configDir;
    return dir ? options.demoUsage?.profiles.find((p) => p.configDir === dir) : undefined;
  };
  for (const demo of options.demoUsage?.profiles ?? []) if (demo.history) insights.seedHistory(demo.configDir, demo.history);
  // --- Auto model -------------------------------------------------------------------------------------------------
  /** Main sends Settings › Conversation › Auto model when the engine starts and after each change. */
  let autoModel: AutoModelPrefs = DEFAULT_AUTO_MODEL;
  const routing = new RoutingStore(cache.db);
  const router = new ModelRouter({
    sdk,
    env: envFor,
    claudePath: async () => (await claude)?.path,
    ephemeral,
    prefs: () => autoModel,
    // The call ran on the session's profile, so its tokens count on that login's usage.
    record: (profileId, entry) => {
      routing.record({ ...entry, scope: scopeOf(profiles.runtime(profileId).configDir) });
      broadcast('usage.tokens', { profileIds: [profileId], scan: null });
    },
    log,
    ...(options.stubRouter ? { stub: stubRoute } : {}),
  });
  if (options.demoUsage?.autoPicks?.length) {
    const settings = createSessionSettingsStore(cache.db);
    for (const demo of options.demoUsage.autoPicks) {
      const id = randomUUID();
      routing.record({ id, scope: scopeOf(demo.configDir), at: demo.pick.at, model: demo.routingModel, picked: demo.pick.model, tokens: demo.tokens });
      if (!demo.sessionId) continue;
      routing.attach(id, demo.sessionId);
      settings.set(demo.sessionId, { autoPick: demo.pick });
    }
  }
  /** A pick as kept with the session. */
  const autoPickOf = (pick: { model: AutoPick['model']; reason: string; tokens: number; allowed: AutoPick['allowed'] }): AutoPick => ({
    model: pick.model,
    reason: pick.reason,
    tokens: pick.tokens,
    allowed: pick.allowed,
    at: Date.now(),
  });

  // Up next is kept per session, so it outlives the process (Stop, the idle timeout) and the app.
  const upNext = new UpNextStore(cache.db);
  // --- Usage limits -------------------------------------------------------------------------------------------------
  /** Main sends Settings › Conversation › "Resume after a usage limit resets" when the engine starts and after each change. */
  let resumeAtLimit: ResumeAtLimit = 'ask';
  const limits = new UsageLimits({
    store: new LimitStore(cache.db),
    // A session that is already working again (you sent something yourself) needs no nudge.
    resume: async (sessionId) => {
      if (hosts.list().hosts.some((h) => h.sessionId === sessionId && (h.state === 'running' || h.state === 'needs-you'))) return;
      await hosts.send({ sessionId, text: RESUME_PROMPT, attachments: [], fork: false });
      sessions.wake(sessionId);
    },
    profileOf: (sessionId) => sessionProfile(sessionId),
    fallbackReset: (profileId, kind) => snapshotReset(usageMonitors.get(profileId)?.current()?.limits ?? [], kind),
    mode: () => resumeAtLimit,
    onChange: (state) => {
      broadcast('limits.changed', state);
      void autoStarter?.check();
      runner?.check();
    },
    onLimitChanged: (profileId) => hosts.limitChanged(profileId),
    onResumed: (sessionId) => broadcast('limits.resumed', { sessionId }),
    log,
  });
  const hosts = new HostManager({
    limits,
    sdk,
    ephemeral,
    onUsageHint: (profileId) => usageMonitors.get(profileId)?.nudge(),
    onRateLimit: (profileId, sessionId, info) => insights.recordRateLimit(profileId, sessionId, info),
    env: envFor,
    claudePath: async () => (await claude)?.path,
    isOpenElsewhere: (id) => !hosts.has(id) && liveList().some((l) => l.sessionId === id),
    refreshLive: scanLive,
    sessionCwd: (id) => sessions.get(id)?.cwd ?? liveList().find((l) => l.sessionId === id)?.cwd ?? null,
    sessionProfile,
    onInfo: (info) => {
      if (info.state === 'idle') transcripts.settled(info.sessionId);
      broadcast('session.host', info);
      catchUpOnInfo(info);
      // After the broadcast, so main's "Claude finished" still sees the item it says starts next.
      autoStarter?.onHost(info);
      // A session that broke (its process ended, it couldn't start) has no turn end: its issue goes to failed all the same.
      if (info.state === 'error') triggerWatcher?.turnEnded(info.sessionId, { ok: false });
      triggerWatcher?.nudge();
      runner?.onHost(info);
      runner?.check();
    },
    onStream: (delta) => broadcast('session.stream', delta),
    onMessages: (id, messages, held) => {
      transcripts.pushLive(id, messages, held);
      catchUp.messages(id, messages);
    },
    onClosed: (id) => transcripts.dropHeld(id),
    onPermission: (request) => {
      broadcast('session.permission', request);
      quietly(catchUp.permission(request));
      runner?.needsYou(request.sessionId, request.toolName);
    },
    onPermissionResolved: (requestId, sessionId) => {
      broadcast('session.permissionResolved', { requestId, sessionId });
      quietly(catchUp.permissionResolved(requestId, sessionId));
      runner?.answered(sessionId);
    },
    onTurnEnd: (sessionId, outcome) => {
      autoStarter?.turnEnded(sessionId, outcome);
      triggerWatcher?.turnEnded(sessionId, outcome);
      const card = catchUp.turnEnded(sessionId, outcome);
      quietly(card);
      // A pipeline's step reads the catch-up (does Claude wait for you?) before the run goes on. Send now's turn has none.
      if (!outcome.superseded) {
        const ended = outcome.stopped ? 'stopped' : outcome.ok ? 'clean' : 'error';
        void card.catch(() => null).then((made) => runner?.turnEnded(sessionId, ended, made)).catch((error: Error) => log('warn', `Pipelines: ${error.message}`));
      }
    },
    onCreated: (id) => {
      owned.add(id);
      markOwned.run(id, Date.now());
    },
    onContinued: (id) => {
      if (owned.has(id) || continued.has(id)) return;
      continued.add(id);
      markContinued.run(id, Date.now());
      sessions.republish(id);
    },
    installedPlugins: (profileId) => installedPlugins(profiles.runtime(profileId).configDir),
    // Mods draw only in this app's windows: none of these reach paired phones or the companion.
    mods: {
      state: (state) => {
        broadcast('mods.state', state);
        if (state.supported) void rememberHooked(state.sessionId, state.hooked);
      },
      toast: (toast) => broadcast('mods.toast', toast),
      statuses: (sessionId, statuses) => broadcast('mods.statuses', { sessionId, statuses }),
      log: (entry) => {
        log('debug', `[mod ${entry.plugin}] ${entry.text}`);
        broadcast('mods.log', entry);
      },
      invalidate: (sessionId, instances) => broadcast('mods.invalidate', { sessionId, instances }),
      panes: (sessionId, roster) => broadcast('mods.panes', { sessionId, roster }),
      scroll: (event) => broadcast('mods.scroll', event),
      focus: (event) => broadcast('mods.focus', event),
      ask: (ask) => broadcast('mods.promptAsk', ask),
    },
    sessionSettings: createSessionSettingsStore(cache.db),
    upNext,
    onUpNext: (sessionId, queue) => broadcast('upNext.changed', { sessionId, queue }),
    links: {
      expand: (id, text) => expandMessage(expandRunBriefs(text), (message, others) => links.expand(id, message, others), githubContext),
      warm: async (text) => {
        await Promise.all([links.warmText(text), githubContext.warm(text)]);
      },
    },
    readOnly: (id) => runner?.isReadOnly(id) ?? false,
    planApproved: (id, plan) => runner?.planApproved(id, plan) ?? null,
    models: appState.get('models') as ModelOption[] | null,
    onModels: (models) => {
      appState.set('models', models);
      broadcast('models.changed', { models });
    },
    commandCache: {
      // Persisted for an hour; Claude Code reports fresh lists from every running session anyway.
      // A list saved before the profile's skills last changed is stale too.
      get: (key) => {
        const stored = appState.get(commandCacheKey(key)) as { at: number; commands: SlashCommand[] } | null;
        const changed = (appState.get(`commands-changed:${key.profileId}`) as number | null) ?? 0;
        return stored && Date.now() - stored.at < 3_600_000 && stored.at >= changed ? stored.commands : null;
      },
      set: (key, commands) => appState.set(commandCacheKey(key), { at: Date.now(), commands }),
      forget: (profileId) => appState.set(`commands-changed:${profileId}`, Date.now()),
    },
    log,
  });

  // Armed resumes kept from before start their timers (one due while the app was closed goes shortly).
  limits.start();
  const demoLimitFile = options.demoUsage?.limitFile;
  /** The session the screenshot tour stopped on a made-up limit, to clear it again. */
  let demoLimited: string | null = null;
  const readDemoLimit = (): { sessionId?: string; kind: string; resetsAt: number; held?: string[] } | null => {
    try {
      return JSON.parse(readFileSync(demoLimitFile!, 'utf8')) as { sessionId?: string; kind: string; resetsAt: number; held?: string[] } | null;
    } catch {
      return null;
    }
  };
  const demoLimit = () => {
    const wanted = readDemoLimit();
    if (demoLimited) {
      limits.ok(sessionProfile(demoLimited), demoLimited);
      upNext.save(demoLimited, []);
      broadcast('upNext.changed', { sessionId: demoLimited, queue: [] });
      demoLimited = null;
    }
    if (!wanted?.sessionId) return;
    demoLimited = wanted.sessionId;
    const held = (wanted.held ?? []).map((text, i) => ({ id: `demo-held-${i}`, text, attachments: [], createdAt: Date.now() }));
    upNext.save(wanted.sessionId, held);
    broadcast('upNext.changed', { sessionId: wanted.sessionId, queue: held.map(summarise) });
    limits.hit(sessionProfile(wanted.sessionId), wanted.sessionId, { kind: wanted.kind, resetsAt: wanted.resetsAt, message: null });
  };
  if (demoLimitFile) watchFile(demoLimitFile, { interval: 200 }, demoLimit);

  // --- Catch-up -----------------------------------------------------------------------------------------------------
  /** Main sends Settings › Conversation › Catch-up's "Write catch-up summaries with Haiku" at start and after each change. */
  let catchUpSummaries = true;
  const catchUpUsage = new CatchUpUsageStore(cache.db);
  const summarizer = new Summarizer({
    sdk,
    env: envFor,
    claudePath: async () => (await claude)?.path,
    ephemeral,
    // The call ran on the session's profile, so its tokens count on that login's usage.
    record: (profileId, entry) => {
      catchUpUsage.record({ ...entry, scope: scopeOf(profiles.runtime(profileId).configDir) });
      broadcast('usage.tokens', { profileIds: [profileId], scan: null });
    },
    log,
    ...(options.stubCatchUp ? { stub: stubAnswer } : {}),
  });
  /** Ask Claude to commit: Haiku reads the change (up to about 10,000 tokens), so it has longer than a summary. */
  const commitWriter = new Summarizer({
    sdk,
    env: envFor,
    claudePath: async () => (await claude)?.path,
    ephemeral,
    record: (profileId, entry) => {
      catchUpUsage.record({ ...entry, scope: scopeOf(profiles.runtime(profileId).configDir) });
      broadcast('usage.tokens', { profileIds: [profileId], scan: null });
    },
    log,
    what: 'Commit message',
    startMs: 15_000,
    answerMs: 30_000,
    ...(options.stubCatchUp ? { stub: stubCommitMessage } : {}),
  });
  /** Where a session works now: its process's folder (a worktree once it has one), else what its transcript says. */
  const sessionCwd = (id: string) => hosts.list().hosts.find((h) => h.sessionId === id)?.cwd ?? sessions.get(id)?.cwd ?? liveList().find((l) => l.sessionId === id)?.cwd ?? null;
  const catchUpStore = new CatchUpStore(cache.db);
  for (const card of options.demoUsage?.catchUps ?? []) catchUpStore.save(card);
  const catchUp = new CatchUpService({
    store: catchUpStore,
    transcript: (id) => source.messages(id),
    cwd: (id) => sessionCwd(id),
    profileOf: sessionProfile,
    changes: (cwd) => listChanges(cwd, 'uncommitted').catch(() => null),
    summarize: (profileId, sessionId, input, system) => summarizer.ask(profileId, sessionId, input, system),
    useModel: () => catchUpSummaries,
    emit: (sessionId, card) => broadcast('catchup.changed', { sessionId, catchUp: card }),
    log,
  });
  /** A failed card is only a missing briefing: never let it reach the session. */
  const quietly = (work: Promise<unknown>) => void work.catch((error: unknown) => log('warn', `Catch-up failed: ${error instanceof Error ? error.message : String(error)}`));
  /** The state each session this app runs was last in, to see a turn end in a crash (no `result` comes then). */
  const hostStates = new Map<string, SessionHostInfo['state']>();
  const catchUpOnInfo = (info: SessionHostInfo) => {
    const before = hostStates.get(info.sessionId);
    hostStates.set(info.sessionId, info.state);
    if (info.state === 'error' && (before === 'running' || before === 'needs-you')) {
      quietly(catchUp.turnEnded(info.sessionId, { ok: false, error: info.error }));
      // A crash ends the turn without a `result`: a pipeline's step stops on it.
      void runner?.turnEnded(info.sessionId, 'error', null);
    }
    if (info.state === 'closed' || info.state === 'error') catchUp.closed(info.sessionId);
  };

  /** Windows attached to each terminal's output. */
  const terminalViewers = new Map<string, Set<HandlerContext<Contract>>>();
  const terminals = new TerminalManager({
    ...(options.spawnPty ? { spawn: options.spawnPty } : {}),
    env: async () => (await shell.ready).env,
    claudePath: async () => (await claude)?.path,
    onData: (id, data) => {
      for (const viewer of terminalViewers.get(id) ?? []) viewer.emit('terminal.data', { id, data });
    },
    onChange: (list) => broadcast('terminals.changed', { terminals: list }),
    onExit: (info, run) => reportRun(info, run),
    log,
  });
  /** The terminals each connection is attached to, so one dispose hook per connection detaches it from all of them. */
  const viewedBy = new WeakMap<HandlerContext<Contract>, Set<string>>();
  const detachTerminal = (id: string, context: HandlerContext<Contract>) => {
    const viewers = terminalViewers.get(id);
    viewers?.delete(context);
    if (viewers?.size === 0) terminalViewers.delete(id);
  };
  const viewTerminal = (id: string, context: HandlerContext<Contract>, attach: boolean) => {
    let viewed = viewedBy.get(context);
    if (attach) {
      if (!viewed) {
        const created = new Set<string>();
        viewedBy.set(context, created);
        context.onDispose(() => {
          for (const viewedId of created) detachTerminal(viewedId, context);
          created.clear();
        });
        viewed = created;
      }
      viewed.add(id);
      let viewers = terminalViewers.get(id);
      if (!viewers) terminalViewers.set(id, (viewers = new Set()));
      viewers.add(context);
    } else {
      viewed?.delete(id);
      detachTerminal(id, context);
    }
  };

  const actions = new ActionStore(cache.db);
  const savedPrompts = new SavedPromptStore(cache.db);
  /** A pull (or anyone) changing a project's .switchboard.json updates its shared actions and prompts in every window. */
  const sharedFileWatcher = new SharedFileWatcher((root) => {
    broadcast('actions.changed', { root });
    broadcast('savedPrompts.changed', { root });
  });
  const promptsChanged = (...scopes: PromptScope[]) => {
    for (const root of new Set(scopes.map((scope) => (scope.kind === 'global' ? null : scope.root)))) broadcast('savedPrompts.changed', { root });
  };
  /** The queue (first called the Later list). */
  const later = new LaterStore(cache.db);
  /** Every window keeps the whole queue: tell them all after a change. */
  const laterBroadcast = () => broadcast('later.changed', { items: later.list(), started: later.startedLinks(), auto: autoStarter?.auto() ?? { outcomes: [], focusHeld: [] } });
  const laterChanged = () => {
    laterBroadcast();
    void autoStarter?.check();
  };
  /** The smoke test's stand-in sessions (`stubQueueStarts`), by id. */
  const smokeHosts = new Map<string, HostInfo>();
  /** Main sends the focus limit (`setQueueFocus`): an item that starts by itself waits for a free slot instead of asking. */
  let queueFocus: { limit: number | null; countExternal: boolean } = { limit: null, countExternal: false };
  /**
   * The sessions the queue looks at: those this app runs, those Claude Code runs elsewhere, and those queued items
   * wait on. From the hosts and the registry, not the whole index, since this runs on every change.
   */
  const queueSessions = (): QueueSession[] => {
    const out = new Map<string, QueueSession>();
    const title = (id: string, fallback: string | null) => sessions.get(id)?.title || fallback || 'Untitled session';
    for (const host of [...hosts.list().hosts, ...smokeHosts.values()]) {
      if (host.state === 'closed' || host.state === 'error') continue;
      const busy = host.state === 'starting' || host.state === 'running' || host.state === 'needs-you';
      out.set(host.sessionId, { id: host.sessionId, title: title(host.sessionId, null), projectRoot: sessions.get(host.sessionId)?.projectRoot ?? projectOf(host.cwd), busy, elsewhere: null });
    }
    for (const entry of liveList()) {
      if (out.has(entry.sessionId) || ephemeral.has(entry.sessionId)) continue;
      const busy = entry.status === 'running' || entry.status === 'needs-you';
      // Switchboard's own processes register as SDK ones; without a host here, one is another app's.
      const elsewhere = entry.origin === 'cli' ? 'terminal' : 'app';
      out.set(entry.sessionId, { id: entry.sessionId, title: title(entry.sessionId, entry.name), projectRoot: sessions.get(entry.sessionId)?.projectRoot ?? entry.projectRoot ?? entry.cwd ?? '', busy, elsewhere });
    }
    const started = new Map(later.startedLinks().map((s) => [s.itemId, s.sessionId]));
    for (const item of later.list()) {
      const id = item.waitFor.kind === 'session' ? item.waitFor.sessionId : item.waitFor.kind === 'item' ? started.get(item.waitFor.itemId) : undefined;
      const summary = id && !out.has(id) ? sessions.get(id) : null;
      if (summary) out.set(summary.id, { id: summary.id, title: summary.title || 'Untitled session', projectRoot: summary.projectRoot, busy: false, elsewhere: null });
    }
    return [...out.values()];
  };
  /** How many sessions count toward the focus limit now: the same count as the window's (without other computers'). */
  const focusCount = () => {
    const hostMap = new Map<string, HostInfo>([...hosts.list().hosts, ...smokeHosts.values()].map((h) => [h.sessionId, h]));
    const live = new Map(liveList().map((l) => [l.sessionId, l]));
    const summaries = new Map([...hostMap.keys(), ...live.keys()].flatMap((id) => {
      const summary = sessions.get(id);
      return summary ? [[id, summary] as const] : [];
    }));
    return focusSessions({ hosts: hostMap, live, sessions: summaries, permissions: hosts.list().permissions, countExternal: queueFocus.countExternal }).length;
  };
  /** The usage limit a queued item's profile is at: its own profile, else its project's. */
  const queueLimit = (item: LaterItem) => limits.of(item.profileId && profiles.has(item.profileId) ? item.profileId : folderProfile(item.cwd));
  /** Starts a queued item, as Start does and as an item that starts by itself does. */
  const startQueued = async (item: LaterItem) => {
    // The same path as New session: its folder, choices and route, and a worktree with a made-up name.
    const { sessionId } = await createSession({
      cwd: item.cwd,
      prompt: item.prompt,
      attachments: item.attachments,
      model: item.model,
      permissionMode: item.permissionMode,
      effort: item.effort,
      worktree: item.workspace === 'worktree' ? { name: randomWorktreeName(), baseRef: worktreeRequestBase(item.baseRef) } : null,
      profileId: item.profileId,
      // A queued prompt on Auto is routed now, when it starts, not when it was added.
      checkoutBranch: item.workspace === 'worktree' ? null : item.branch,
    });
    later.started(item.id, sessionId);
    laterChanged();
    // A trigger's event that waited in the queue gets its title now, as one that started at once does.
    const title = triggerWatcher?.queuedStarted(item.id, sessionId);
    if (title) {
      pendingTitles.set(sessionId, title);
      applyTitles([sessionId]);
    }
    return sessionId;
  };
  /** Queued items that start by themselves (#172): the engine decides, so they start once, with or without a window. */
  /** The smoke test must never send a prompt to Claude: there an item leaves the queue as if it had started. */
  const startQueuedOrStub = options.stubQueueStarts
    ? async (item: LaterItem) => {
        const sessionId = `smoke-started-${randomUUID()}`;
        later.started(item.id, sessionId);
        laterChanged();
        triggerWatcher?.queuedStarted(item.id, sessionId);
        return sessionId;
      }
    : startQueued;
  autoStarter = new QueueAutoStarter({
    store: later,
    sessions: queueSessions,
    projectName: (root) => listProjects().find((p) => p.root === root)?.name ?? basename(root),
    limitOf: queueLimit,
    focus: () => ({ limit: queueFocus.limit, count: queueFocus.limit === null ? 0 : focusCount() }),
    start: startQueuedOrStub,
    changed: laterBroadcast,
    started: (event) => broadcast('later.autoStarted', event),
    skipped: (event) => broadcast('later.autoSkipped', event),
    log,
  });
  /**
   * A stand-in session this app "runs" (`stubQueueStarts` only): the smoke test drives one through a turn, and the
   * screenshots' demo shows a session queued items start after (`DemoUsage.queueHosts`).
   */
  const standInHost: Engine['smokeQueueHost'] = ({ sessionId, cwd, state, outcome }) => {
    if (!options.stubQueueStarts) return;
    const before = smokeHosts.get(sessionId);
    const info: HostInfo = {
      ...(before ?? {
        sessionId,
        cwd,
        model: null,
        permissionMode: 'default',
        effort: null,
        costUsd: 0,
        contextPercent: null,
        contextTokens: null,
        contextMax: null,
        error: null,
        startedAt: Date.now(),
        queue: [],
        queueHold: null,
        profileId: profiles.defaultId(),
        backgroundTasks: [],
      }),
      state,
      promptedAt: state === 'running' ? Date.now() : (before?.promptedAt ?? null),
    };
    if (state === 'idle' && outcome) autoStarter?.turnEnded(sessionId, { ok: outcome === 'clean', stopped: outcome === 'stopped' });
    if (state === 'closed') smokeHosts.delete(sessionId);
    else smokeHosts.set(sessionId, info);
    broadcast('session.host', info);
    autoStarter?.onHost(info);
  };
  const demoQueueFile = options.stubQueueStarts ? options.demoUsage?.queueHostFile : undefined;
  /** The demo session the screenshot tour shows as working here, to take away again. */
  let demoQueueHost: { sessionId: string; cwd: string } | null = null;
  const demoQueue = () => {
    const wanted = ((): { sessionId?: unknown; cwd?: unknown } | null => {
      try {
        return JSON.parse(readFileSync(demoQueueFile!, 'utf8')) as { sessionId?: unknown; cwd?: unknown } | null;
      } catch {
        // No file: nothing shows.
        return null;
      }
    })();
    const next = typeof wanted?.sessionId === 'string' && typeof wanted.cwd === 'string' ? { sessionId: wanted.sessionId, cwd: wanted.cwd } : null;
    // Reading the file can fire the watcher again: only a different session changes anything.
    if (next?.sessionId === demoQueueHost?.sessionId && next?.cwd === demoQueueHost?.cwd) return;
    if (demoQueueHost) standInHost({ ...demoQueueHost, state: 'closed' });
    demoQueueHost = next;
    if (demoQueueHost) standInHost({ ...demoQueueHost, state: 'running' });
  };
  if (demoQueueFile) watchFile(demoQueueFile, { interval: 200 }, demoQueue);

  // --- Scheduled sessions (#173) -------------------------------------------------------------------------------------
  /** The smoke test's clock (`advanceScheduleClock`, with `stubQueueStarts` only): runs come due without waiting. */
  let scheduleClockOffset = 0;
  const scheduleNow = () => Date.now() + scheduleClockOffset;
  const schedules = new ScheduleStore(cache.db, scheduleNow);
  const schedulesBroadcast = () => broadcast('schedules.changed', { schedules: schedules.list(), sessions: schedules.sessions() });
  /**
   * Runs' titles ("Review open pull requests · Mon 19 Oct"), set the way Rename does once the session has a transcript to
   * write it to: a new session has none until Claude Code writes its first message.
   */
  const pendingTitles = new Map<string, string>();
  const applyTitles = (ids: readonly string[]) => {
    for (const id of ids) {
      const title = pendingTitles.get(id);
      if (!title || !sessions.pathFor(id) || !source.rename) continue;
      pendingTitles.delete(id);
      void source
        .rename(id, title)
        .then(() => sessions.reread(id))
        .catch((error: Error) => log('warn', `Schedules: could not title ${id}: ${error.message}`));
    }
  };
  titleRuns = (ids) => {
    if (pendingTitles.size) applyTitles(ids);
  };
  /** Whether the session a run started is still busy: working, or waiting for you. */
  const scheduledState = (sessionId: string): 'working' | 'waiting' | null => {
    const host = [...hosts.list().hosts, ...smokeHosts.values()].find((h) => h.sessionId === sessionId);
    if (host) return host.state === 'needs-you' ? 'waiting' : host.state === 'starting' || host.state === 'running' ? 'working' : null;
    const live = liveList().find((l) => l.sessionId === sessionId);
    return live?.status === 'needs-you' ? 'waiting' : live?.status === 'running' ? 'working' : null;
  };
  /** Why a run can't start now: the focus limit (it never asks), or its profile's usage limit. */
  const scheduleHold = (draft: LaterDraft): RunHold | null => {
    if (queueFocus.limit !== null) {
      const count = focusCount();
      if (count >= queueFocus.limit) return { reason: 'at the focus limit', detail: `You're at your focus limit (${count} of ${queueFocus.limit}). It starts when a slot frees.` };
    }
    const hit = limits.of(draft.profileId && profiles.has(draft.profileId) ? draft.profileId : folderProfile(draft.cwd));
    if (hit && limitAhead(hit)) {
      const at = hit.resetsAt === null ? null : clockTime(hit.resetsAt);
      return at
        ? { reason: `at the usage limit until ${at}`, detail: `The usage limit resets at ${at}. It starts then.` }
        : { reason: 'at the usage limit', detail: 'It starts when the usage limit resets.' };
    }
    return null;
  };
  /** Starts a run as `later.start` starts a queued item, as a new session titled for its day. */
  const startScheduled = async (draft: LaterDraft, title: string): Promise<string> => {
    // The smoke test never sends a prompt to Claude: the run is recorded with a session that doesn't exist.
    if (options.stubQueueStarts) return `smoke-scheduled-${randomUUID()}`;
    const { sessionId } = await createSession({
      cwd: draft.cwd,
      prompt: draft.prompt,
      attachments: draft.attachments ?? [],
      model: draft.model ?? null,
      permissionMode: draft.permissionMode ?? 'default',
      effort: draft.effort ?? null,
      worktree: draft.workspace === 'worktree' ? { name: randomWorktreeName(), baseRef: worktreeRequestBase(draft.baseRef ?? 'fresh') } : null,
      profileId: draft.profileId && profiles.has(draft.profileId) ? draft.profileId : null,
      checkoutBranch: draft.workspace === 'worktree' ? null : (draft.branch ?? null),
    });
    pendingTitles.set(sessionId, title);
    applyTitles([sessionId]);
    return sessionId;
  };
  /** At a limit, a run or a triggered session goes to the queue as an item that starts by itself (#172). */
  const queueHeld = (draft: LaterDraft) => {
    const item = later.add({ ...draft, autoStart: true }, { waitFor: { kind: 'project' } });
    laterBroadcast();
    autoStarter?.armForLimit(item.id);
    return item.id;
  };

  // --- Event triggers (#180) -----------------------------------------------------------------------------------------
  const triggers = new TriggerStore(cache.db, scheduleNow);
  const triggersState = () => ({ triggers: triggers.list(), events: triggers.events(), sessions: triggers.sessions() });
  const triggersBroadcast = () => broadcast('triggers.changed', triggersState());
  /**
   * What the smoke test's stand-in starts got (`stubQueueStarts` only), a JSON line each in the data folder, since it
   * never sends a prompt to Claude: the step reads the filled prompt there.
   */
  const smokeTriggerStarts = join(options.dataDir, 'smoke-trigger-starts.jsonl');
  const ghIn = async (args: string[], cwd: string, timeout?: number) => runGh(defaultGh(), args, { cwd, env: (await shell.ready).env, ...(timeout ? { timeout } : {}) });
  triggerWatcher = new TriggerWatcher({
    store: triggers,
    gh: ghIn,
    folderExists: (cwd) => !!statSafe(cwd)?.isDirectory(),
    sessionState: scheduledState,
    // A pull request the session opened, or one on its branch that is still open or merged.
    sessionPr: (id) => linkStore.prsOf(id).find((pr) => pr.state !== 'closed') ?? null,
    queued: (itemId) => !!later.get(itemId),
    hold: scheduleHold,
    start: async (draft, title) => {
      if (!options.stubQueueStarts) return startScheduled(draft, title);
      const sessionId = `smoke-triggered-${randomUUID()}`;
      appendFileSync(smokeTriggerStarts, `${JSON.stringify({ sessionId, title, prompt: draft.prompt })}\n`);
      return sessionId;
    },
    queue: queueHeld,
    projectName: (root) => listProjects().find((p) => p.root === root)?.name ?? basename(root),
    changed: triggersBroadcast,
    notify: (notices) => broadcast('triggers.notice', { notices }),
    log,
    now: scheduleNow,
  });
  const demoTriggersFile = options.stubQueueStarts ? options.demoUsage?.triggersFile : undefined;
  /** The demo triggers the screenshot tour put in, to take out again. */
  let demoTriggerIds: string[] = [];
  if (demoTriggersFile) {
    watchFile(demoTriggersFile, { interval: 200 }, () => {
      const wanted = ((): { triggers?: unknown; events?: unknown; sessions?: unknown } | null => {
        try {
          return JSON.parse(readFileSync(demoTriggersFile, 'utf8')) as { triggers?: unknown };
        } catch {
          return null;
        }
      })();
      for (const id of demoTriggerIds) {
        triggers.remove(id);
        triggers.forgetSessions(id);
      }
      demoTriggerIds = [];
      const events = (Array.isArray(wanted?.events) ? wanted.events : []).flatMap((raw) => {
        const parsed = TriggerEvent.safeParse(raw);
        return parsed.success ? [{ event: parsed.data, context: null }] : [];
      });
      for (const raw of Array.isArray(wanted?.triggers) ? wanted.triggers : []) {
        const parsed = Trigger.safeParse(raw);
        if (!parsed.success) continue;
        triggers.restore(parsed.data, events);
        // As the tour wrote it: already looked, at its last check, so nothing starts or is marked as seen meanwhile.
        if (parsed.data.lastCheckedAt !== null) triggers.checked(parsed.data.id, { at: parsed.data.lastCheckedAt, seen: {}, seeded: true });
        demoTriggerIds.push(parsed.data.id);
      }
      for (const raw of Array.isArray(wanted?.sessions) ? wanted.sessions : []) {
        const parsed = TriggerSession.safeParse(raw);
        if (parsed.success) triggers.addSession(parsed.data);
      }
      triggersBroadcast();
    });
  }
  /** Pauses the triggers of a project removed from Switchboard, with the reason the card shows. */
  const pauseTriggersIn = (root: string, reason: string) => {
    let changed = false;
    for (const trigger of triggers.inProject(root)) {
      if (trigger.paused) continue;
      triggers.setPaused(trigger.id, true, reason);
      changed = true;
    }
    if (changed) triggersBroadcast();
  };
  /** What the trigger editor shows about a project's repository; each part that gh can't answer is left empty. */
  const triggerRepoInfo = async (root: string) => {
    const repo = await readRepo(ghIn, root);
    if (!repo.ok) return { repo: null, login: null, defaultBranch: null, workflows: [], collaborators: null, problem: repo.message };
    const [login, workflows, collaborators] = await Promise.all([readLogin(ghIn, root), readWorkflows(ghIn, root), readCollaborators(ghIn, root)]);
    return {
      repo: repo.value.repo,
      login: login.ok ? login.value : null,
      defaultBranch: repo.value.defaultBranch,
      workflows: workflows.ok ? workflows.value : [],
      collaborators,
      problem: login.ok ? null : login.message,
    };
  };

  const scheduler = new Scheduler({
    store: schedules,
    folderExists: (cwd) => !!statSafe(cwd)?.isDirectory(),
    sessionState: scheduledState,
    queued: (itemId) => !!later.get(itemId),
    hold: scheduleHold,
    start: startScheduled,
    // At a limit it goes to the queue as an item that starts by itself (#172), once the slot frees or the limit resets.
    queue: queueHeld,
    projectName: (root) => listProjects().find((p) => p.root === root)?.name ?? basename(root),
    changed: schedulesBroadcast,
    ran: (runs) => broadcast('schedules.ran', { runs }),
    // Triggers share the schedules' timer: every tick (at least once a minute, on wake, after a clock jump) checks
    // the triggers that are due.
    tick: () => void triggerWatcher?.check(),
    log,
    now: scheduleNow,
    // Node keeps the time zone it started with: writing TZ makes it look again, so a change is seen within a tick.
    refreshZone: () => {
      if (process.env.TZ === undefined) delete process.env.TZ;
    },
  });
  /** Skip this run, or take it back. Only a run still to come that the schedule's rule has can be skipped. */
  const skipRun = (id: string, iso: string, skip: boolean) => {
    const stored = schedules.getStored(id);
    if (!stored) throw new RpcError('NOT_FOUND', 'That schedule was deleted');
    const at = Date.parse(iso);
    if (skip && (at <= stored.checkedAt || runsBetween(stored.schedule.rule, at - 1, at, 1).length === 0)) throw new RpcError('INVALID', 'That run is not still to come');
    const schedule = schedules.setSkipped(id, at, skip)!;
    schedulesBroadcast();
    scheduler.rearm();
    return { schedule };
  };
  /** Pauses the schedules of a folder (a project removed from Switchboard), with the reason the row shows. */
  const pauseSchedulesIn = (root: string, reason: string) => {
    let changed = false;
    for (const schedule of schedules.list()) {
      if (schedule.paused || !isSameOrInside(root, schedule.draft.cwd)) continue;
      schedules.setPaused(schedule.id, true, reason);
      changed = true;
    }
    if (changed) {
      schedulesBroadcast();
      scheduler.rearm();
    }
  };
  const demoSchedulesFile = options.stubQueueStarts ? options.demoUsage?.schedulesFile : undefined;
  /** The demo schedules the screenshot tour put in, to take out again. */
  let demoScheduleIds: string[] = [];
  if (demoSchedulesFile) {
    watchFile(demoSchedulesFile, { interval: 200 }, () => {
      const wanted = ((): unknown => {
        try {
          return JSON.parse(readFileSync(demoSchedulesFile, 'utf8')) as unknown;
        } catch {
          return null;
        }
      })();
      for (const id of demoScheduleIds) schedules.remove(id);
      demoScheduleIds = [];
      for (const raw of Array.isArray(wanted) ? wanted : []) {
        const parsed = Schedule.safeParse(raw);
        if (!parsed.success) continue;
        schedules.restore(parsed.data);
        demoScheduleIds.push(parsed.data.id);
      }
      schedulesBroadcast();
      scheduler.rearm();
    });
  }
  // Runs due while Switchboard was closed are dealt with once it has settled (profiles, the shell, main's notifier).
  if (options.schedules !== false) scheduler.start(options.stubQueueStarts ? 0 : 5_000);

  // --- Pipelines (#179) ---------------------------------------------------------------------------------------------
  const pipelinesBroadcast = () => broadcast('pipelines.changed', { pipelines: pipelineStore.list() });
  /** A run's button: what goes wrong comes back as a sentence the window can show. */
  const runAction = async <T,>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      throw error instanceof RpcError ? error : new RpcError('PIPELINE_FAILED', (error as Error).message);
    }
  };
  /** What holds a run's next step: the focus limit (it never asks), or its profile's usage limit. */
  const runHold = (run: { cwd: string; profileId: string | null }): StepHold | null => {
    if (queueFocus.limit !== null && focusCount() >= queueFocus.limit) return { kind: 'focus' };
    const hit = limits.of(run.profileId && profiles.has(run.profileId) ? run.profileId : folderProfile(run.cwd));
    return hit && limitAhead(hit) ? { kind: 'limit', resetsAt: hit.resetsAt } : null;
  };
  /** The project's own setup actions (npm install and the like), in a run's new worktree, before its first step. */
  const runSetup = async (root: string, path: string, branch: string) => {
    const setup = actions.list(root).actions.filter((a) => a.runOnWorktreeCreate && a.type === 'shell' && a.trusted);
    if (!setup.length) return;
    const userShell = await terminals.shell();
    const { env } = await shell.ready;
    const worktreeName = basename(path);
    for (const action of setup) {
      const command = expandCommand(action.command, { cwd: path, projectRoot: root, branch, worktreeName, sessionId: '', sessionTitle: '' }, userShell);
      const result = await runCommand(userShell, command, action.cwd === 'project-root' ? root : path, env, 15 * 60_000);
      if (result.code !== 0) log('warn', `Pipelines: setup action "${action.name}" exited with ${result.code}`);
    }
  };
  /**
   * The smoke test's pipeline steps (`stubQueueStarts` only): stand-in sessions, never Claude Code, with what each got
   * written to a JSON line in the data folder, and the replies the step's turn "ended" with.
   */
  const smokePipelineStarts = join(options.dataDir, 'smoke-pipeline-starts.jsonl');
  const smokeReplies = new Map<string, string>();
  const smokeStep = (entry: { kind: 'fresh' | 'fork' | 'send'; sessionId?: string; from?: string; cwd: string; text: string }) => {
    const sessionId = entry.sessionId ?? `smoke-step-${randomUUID()}`;
    appendFileSync(smokePipelineStarts, `${JSON.stringify({ ...entry, sessionId })}\n`);
    standInHost({ sessionId, cwd: entry.cwd, state: 'running' });
    return sessionId;
  };
  runner = new PipelineRunner({
    runs: runStore,
    pipeline: (id) => pipelineStore.get(id),
    session: (id) => sessions.get(id),
    workspace: async ({ from, projectRoot }) => {
      // The smoke test never touches a real repository.
      if (options.stubQueueStarts) return from;
      const location = resolver.resolve(from);
      if (!location.gitDir) return from;
      // The parent's worktree when it has one: the steps carry on its work there.
      if (location.worktree) return from;
      const { current } = await listBranches(from).catch(() => ({ current: null }));
      if (!current) throw new Error('Check out a branch first: the run’s worktree starts from it.');
      try {
        const made = await makeWorktreeFrom(location.root ?? projectRoot, randomWorktreeName(), { branch: current }, { env: (await shell.ready).env });
        await runSetup(location.root ?? projectRoot, made.path, made.branch);
        return made.path;
      } catch (error) {
        throw new Error(error instanceof WorktreeFromError ? error.message : (error as Error).message);
      }
    },
    create: async ({ cwd, prompt, attachments, profileId, model, effort, permissionMode, readOnly }) =>
      options.stubQueueStarts
        ? smokeStep({ kind: 'fresh', cwd, text: prompt })
        : hosts.create({ cwd, prompt, attachments, model, effort, permissionMode, readOnly, worktree: null, profileId: requireProfile(profileId && profiles.has(profileId) ? profileId : folderProfile(cwd)) }),
    fork: async ({ from, prompt, model, effort, permissionMode, readOnly }) =>
      options.stubQueueStarts ? smokeStep({ kind: 'fork', from, cwd: smokeHosts.get(from)?.cwd ?? options.dataDir, text: prompt }) : hosts.fork({ from, text: prompt, model, effort, permissionMode, readOnly }),
    send: async (sessionId, text) => {
      if (options.stubQueueStarts) {
        smokeStep({ kind: 'send', sessionId, cwd: smokeHosts.get(sessionId)?.cwd ?? options.dataDir, text });
        return;
      }
      await hosts.send({ sessionId, text, attachments: [], fork: false, mode: 'queue' });
      sessions.wake(sessionId);
    },
    interrupt: async (sessionId) => {
      catchUp.interrupt(sessionId);
      await hosts.interrupt(sessionId);
    },
    title: (sessionId, title) => {
      pendingTitles.set(sessionId, title);
      applyTitles([sessionId]);
    },
    reparented: (sessionId) => sessions.republish(sessionId),
    republishSessions: (sessionIds) => sessions.republishMany(sessionIds),
    archiveSessions: (sessionIds, archived) => sessions.setArchivedMany(sessionIds, archived),
    hideSessions: (sessionIds) => sessions.hide(sessionIds),
    removed: (runId) => broadcast('runs.removed', { runId }),
    runActions: async (run, names) => {
      if (options.stubQueueStarts) return names.map((name) => ({ name, exitCode: 0, tail: 'Not run in the smoke test.', ms: 0 }));
      const listed = actions.list(run.projectRoot).actions;
      const userShell = await terminals.shell();
      const { env } = await shell.ready;
      const sessionId = run.parentSessionId ?? '';
      return runActionsFirst(names, {
        actions: listed,
        expand: (action) => expandCommand(action.command, actionVars(sessionId, run.projectRoot, run.cwd), userShell),
        cwd: (action) => (action.cwd === 'project-root' ? run.projectRoot : run.cwd),
        shell: userShell,
        env: { ...env, ...profileEnv(run.profileId && profiles.has(run.profileId) ? run.profileId : folderProfile(run.cwd)) },
      });
    },
    lastReply: async (id) => smokeReplies.get(id) ?? lastTurn(await source.messages(id))?.finalText ?? null,
    hold: runHold,
    busy: (id) => {
      const state = [...hosts.list().hosts, ...smokeHosts.values()].find((h) => h.sessionId === id)?.state;
      return state === 'starting' || state === 'running' ? 'working' : state === 'needs-you' ? 'waiting' : null;
    },
    asks: (id) => hosts.list().permissions.some((p) => p.sessionId === id),
    pushPreview: async (run) => {
      if (options.stubQueueStarts) return { message: stubCommitMessage(''), files: 0, branch: null, base: null, problem: null };
      const profileId = run.profileId && profiles.has(run.profileId) ? run.profileId : folderProfile(run.cwd);
      const about = run.parentSessionId ?? runStore.steps(run.id).findLast((s) => s.sessionId)?.sessionId ?? run.id;
      return previewPush(run.cwd, async (context) => parseCommitMessage(await commitWriter.ask(profileId, about, commitMessageInput(context), COMMIT_SYSTEM_PROMPT)), {
        env: (await shell.ready).env,
        gh: defaultGh(),
        projectBase: listProjects().find((p) => p.root === run.projectRoot)?.defaults.branch ?? null,
      });
    },
    push: async (run, request) => {
      // The smoke test never commits or pushes.
      if (options.stubQueueStarts) return null;
      await assertCheckoutIdle(run.cwd);
      const pr = await commitAndOpen(run.cwd, request, { env: (await shell.ready).env, gh: defaultGh(), projectBase: listProjects().find((p) => p.root === run.projectRoot)?.defaults.branch ?? null });
      void pullRequestsFor(run.projectRoot, true);
      return pr;
    },
    changed: (state) => broadcast('runs.changed', { state }),
    notify: (notice) => broadcast('runs.notice', { notice }),
    log,
  });
  /** Turns a run's stub in a message to its parent into the run's brief, right before Claude reads it. */
  const expandRunBriefs = (text: string) => {
    const { runs } = parseRunBriefs(text);
    if (!runs.some((r) => r.stub)) return text;
    let out = text;
    for (const block of runs.filter((r) => r.stub)) {
      const state = runner?.state(block.runId);
      const stub = writeRunStub(block.label, block.runId);
      out = out.replace(stub, state ? writeRunBrief(state) : '');
    }
    return out.replace(/\n{3,}/g, '\n\n').trim();
  };
  const demoPipelinesFile = options.stubQueueStarts ? options.demoUsage?.pipelinesFile : undefined;
  /** The demo runs the screenshot tour put in, to take out again. */
  let demoRunIds: string[] = [];
  if (demoPipelinesFile) {
    watchFile(demoPipelinesFile, { interval: 200 }, () => {
      const wanted = ((): unknown => {
        try {
          return JSON.parse(readFileSync(demoPipelinesFile, 'utf8'));
        } catch {
          return null;
        }
      })();
      // Taking a run out puts its sub-sessions back on their own (`remove` republishes them). Windows keep the runs
      // they were sent, and no event takes one away: they get it once more as stopped, so nothing counts it as running.
      for (const id of demoRunIds) {
        const state = runner?.state(id);
        if (state) broadcast('runs.changed', { state: { ...state, run: { ...state.run, status: 'stopped' } } });
        runner?.remove(id);
      }
      demoRunIds = [];
      for (const raw of Array.isArray(wanted) ? wanted : []) {
        const parsed = PipelineRunState.safeParse(raw);
        if (!parsed.success) continue;
        // As the tour wrote it: the runner never picks it up (it only resumes runs at start), so nothing starts.
        const state = runStore.restore(parsed.data);
        if (!state) continue;
        demoRunIds.push(state.run.id);
        for (const step of state.steps) if (step.sessionId) sessions.republish(step.sessionId);
        broadcast('runs.changed', { state });
      }
    });
  }
  // Runs that were going when Switchboard quit go on once it has settled.
  const resumeRuns = options.schedules !== false ? setTimeout(() => void runner?.resumeAll(), options.stubQueueStarts ? 0 : 5_000) : undefined;
  resumeRuns?.unref?.();
  /** Projects' memory and instructions: every profile's memory folder, the project's own profile first. */
  const memory = new MemoryService({
    profiles: (root) => {
      const own = profiles.runtime(profiles.forProject(root));
      return [own, ...profiles.runtimes().filter((p) => p.id !== own.id)].map((p) => ({ id: p.id, configDir: p.configDir }));
    },
    repoRoot: (root) => resolver.resolve(root).root,
    trash: (paths, scope) => trash(paths, scope),
    // One personal folder for every profile: it is about you, not the account. In the app's data until you choose one.
    personalDir: () => {
      const chosen = appState.get(PERSONAL_DIR_KEY);
      return typeof chosen === 'string' && isLocalAbsolutePath(chosen, process.platform) ? chosen : join(options.dataDir, 'memory');
    },
    personalDefault: join(options.dataDir, 'memory'),
    savePersonalDir: (dir) => appState.set(PERSONAL_DIR_KEY, dir),
    allProfiles: () => profiles.runtimes().map((p) => ({ id: p.id, configDir: p.configDir })),
  });
  /** Your projects that are on disk, with their names: where memory can be imported to or copied from. */
  const memoryProjects = () => listProjects().filter((p) => p.added && p.exists).map((p) => ({ root: p.root, name: p.name }));
  /** Memory in search: every project's folders (each profile) and the personal one, indexed from the files. */
  const memorySearch = new MemorySearch(cache.db);
  const memoryFoldersToIndex = (): IndexedFolder[] => [
    ...memoryProjects().flatMap((p) => memory.folders(p.root).map((f) => ({ dir: f.dir, root: p.root, profileId: f.profileId }))),
    { dir: memory.personal().dir, root: null, profileId: null },
  ];
  let memorySyncedAt = 0;
  /** Reads changed memory files into the index, unless that was done less than `maxAgeMs` ago. Never throws. */
  function syncMemorySearch(maxAgeMs = 0): void {
    if (Date.now() - memorySyncedAt < maxAgeMs) return;
    memorySyncedAt = Date.now();
    try {
      memorySearch.sync(memoryFoldersToIndex());
    } catch (error) {
      log('warn', `Memory search indexing failed: ${(error as Error).message}`);
    }
  }
  memoryChangedHook = () => {
    // A burst of changes (Claude writing a memory and its index line) is indexed once.
    clearTimeout(memorySyncTimer);
    memorySyncTimer = setTimeout(() => syncMemorySearch(), 500);
    memorySyncTimer.unref?.();
  };
  const startupMemorySync = setTimeout(() => syncMemorySearch(), 2_000);
  startupMemorySync.unref?.();
  /** Claude writes memory during sessions, and sync tools bring in other Macs': follow the folders that are on screen. */
  const memoryWatcher = new MemoryWatcher((root) => broadcast('memory.changed', { root }));
  memoryWatcher.watch(null, [memory.personal().dir]);

  /** Runs an action's command in a terminal tab of the session and returns the terminal id. */
  const runShellAction = async (sessionId: string, cwd: string, name: string, command: string) =>
    (await terminals.open({ sessionId, cwd, kind: 'action', command, title: name, cols: 100, rows: 20, fork: false, env: profileEnv(sessionProfile(sessionId)) })).id;
  /** Terminals started by `actions.run`, so Restart can look the action up again. */
  const actionRuns = new Map<string, { sessionId: string; projectRoot: string; cwd: string; id: string }>();
  /** Terminals whose runs report back to their session when they end: a code block run with its output, or an action set to. */
  const runReports = new Map<string, { sessionId: string; command: string; action?: string }>();
  /**
   * A run that reports back has ended: its exit code and the end of its output go to the session as your message, held
   * in Up next while Claude works. A line under the output says where it went, or why it couldn't go.
   */
  const reportRun = (info: TerminalInfo, run: { output: string; stopped: boolean }) => {
    const report = runReports.get(info.id);
    if (!report) return;
    void terminals
      .shell()
      .then((shell) => {
        const text = commandRunMessage({ command: report.command, ...(report.action ? { action: report.action } : {}), shell: shellName(shell), exitCode: info.exitCode ?? -1, stopped: run.stopped, output: run.output });
        return hosts.send({ sessionId: report.sessionId, text, attachments: [], fork: false, mode: 'queue' });
      })
      .then((sent) => {
        if (sent.sessionId === report.sessionId) sessions.wake(report.sessionId);
        terminals.note(info.id, sent.queued ? '↳ Output added to Up next: Claude reads it when it finishes its turn' : '↳ Output sent to Claude');
      })
      .catch((error: Error) => {
        log('warn', `Could not send a command's output to ${report.sessionId}: ${error.message}`);
        terminals.note(info.id, `↳ Could not send the output to Claude: ${error.message}`);
      });
  };

  /**
   * Refuses (SESSION_BUSY) while Claude works in the checkout at `cwd`, wherever that session runs: changing the files under a
   * running turn would confuse it. `except` leaves out the session asking, when what it asks for stops it anyway.
   */
  const assertCheckoutIdle = async (cwd: string, except?: string) => {
    const root = await checkoutRoot(cwd);
    scanLive();
    const busy = [
      ...hosts.list().hosts.filter((h) => h.sessionId !== except && (h.state === 'starting' || h.state === 'running' || h.state === 'needs-you')).map((h) => h.cwd),
      ...liveList().filter((l) => l.sessionId !== except && l.status !== 'idle').flatMap((l) => (l.cwd ? [l.cwd] : [])),
    ];
    for (const other of new Set(busy)) {
      if (existsSync(other) && (await checkoutRoot(other)) === root) {
        throw new RpcError('SESSION_BUSY', 'Claude is working in this folder. Wait for it to finish, or stop it first.');
      }
    }
  };

  /** Where every known session is (transcripts, Switchboard's processes and the live registry), for the worktree overview. */
  const sessionPlaces = (): SessionPlace[] => {
    const places = new Map<string, SessionPlace>(sessions.snapshot().sessions.map((s) => [s.id, { id: s.id, cwd: s.cwd, updatedAt: s.updatedAt }]));
    for (const l of liveList()) if (!places.has(l.sessionId) && l.origin !== 'sdk') places.set(l.sessionId, { id: l.sessionId, cwd: l.cwd, updatedAt: l.updatedAt ?? l.startedAt ?? 0 });
    for (const h of hosts.list().hosts) if (!places.has(h.sessionId)) places.set(h.sessionId, { id: h.sessionId, cwd: h.cwd, updatedAt: h.promptedAt ?? h.startedAt });
    return [...places.values()];
  };
  /** What could be working in a worktree: Switchboard's sessions, and every process in the live registry. */
  const sessionActivity = (): SessionActivity[] => {
    scanLive();
    const here = hosts.list().hosts.filter((h) => h.state !== 'closed' && h.state !== 'error');
    const hosted = new Set(here.map((h) => h.sessionId));
    return [
      ...here.map((h) => ({ sessionId: h.sessionId, cwd: h.cwd, busy: h.state === 'starting' || h.state === 'running' || h.state === 'needs-you', hosted: true })),
      ...liveList()
        .filter((l) => !hosted.has(l.sessionId) && !ephemeral.has(l.sessionId))
        .map((l) => ({ sessionId: l.sessionId, cwd: l.cwd, busy: l.status !== 'idle', hosted: false })),
    ];
  };
  /** Checkouts a pull request is being created for, so a second click can't push and create twice. */
  const prJobs = new Set<string>();
  /** Pull requests by branch from `gh`, per repository, kept for a few minutes (it's a network call). */
  const pullRequestCache = new Map<string, { at: number; prs: Promise<Map<string, WorktreePullRequest> | null> }>();
  const pullRequestsFor = (root: string, fresh: boolean) => {
    const cached = pullRequestCache.get(root);
    if (cached && !fresh && Date.now() - cached.at < 5 * 60_000) return cached.prs;
    const prs = shell.ready.then(({ env }) => fetchPullRequests(root, env)).catch(() => null);
    pullRequestCache.set(root, { at: Date.now(), prs });
    return prs;
  };
  /** The checks of each checkout's open pull request, read again by themselves while some run. Keyed by the checkout's folder. */
  const checksWatcher = new ChecksWatcher({
    read: async (path) => {
      const status = await worktreeStatus(path).catch(() => null);
      if (!status?.branch) return null;
      const pr = prOf(await pullRequestsFor(status.root, false), status.branch);
      if (pr?.state !== 'open') return null;
      return readChecks(defaultGh(), { path: status.path, branch: status.branch, pr: { number: pr.number, url: pr.url } }, (await shell.ready).env);
    },
    emit: (checks) => broadcast('git.checks', checks),
    finished: (event) => {
      log('info', `git: checks ${event.outcome === 'pass' ? 'passed' : 'failed'} on pull request #${event.pr.number} (${event.branch})`);
      broadcast('git.checksFinished', event);
    },
  });
  /** Worktree sizes measured so far; `du` runs in the background, two at a time, and results go out with `worktrees.sizes`. */
  const worktreeSizes = new Map<string, WorktreeSize>();
  const sizeQueue: string[] = [];
  let measuring = 0;
  const measureNext = () => {
    while (measuring < 2 && sizeQueue.length) {
      const path = sizeQueue.shift()!;
      measuring++;
      void measureSize(path)
        .then((bytes) => {
          const size = { path, bytes: bytes ?? 0, at: Date.now() };
          worktreeSizes.set(path, size);
          broadcast('worktrees.sizes', { sizes: [size] });
        })
        .finally(() => {
          measuring--;
          measureNext();
        });
    }
  };

  /** Finds a project action and refuses an unapproved one. */
  const findAction = (projectRoot: string, id: string) => {
    const action = actions.list(projectRoot).actions.find((a) => a.id === id);
    if (!action) throw new RpcError('NOT_FOUND', 'No such action');
    if (!action.trusted) {
      const from = action.scope === 'shared' ? `${projectRoot}/.switchboard.json` : 'a settings file';
      throw new RpcError('UNTRUSTED', `"${action.name}" comes from ${from} and has not been approved yet`);
    }
    return action;
  };

  /** The values `${…}` placeholders in an action's command expand to. */
  const actionVars = (sessionId: string, projectRoot: string, cwd: string) => {
    const location = resolver.resolve(cwd);
    return {
      cwd,
      projectRoot,
      branch: resolver.branch(location) ?? '',
      worktreeName: location.worktree?.name ?? '',
      sessionId,
      sessionTitle: sessions.get(sessionId)?.title ?? '',
    };
  };

  /** A terminal for a session gets its profile's config folder, so `claude` in it uses the same login. */
  const profileEnv = (profileId: string): Record<string, string> => {
    const { envDir } = profiles.runtime(profileId);
    return envDir ? { CLAUDE_CONFIG_DIR: envDir } : {};
  };

  /**
   * For a new worktree: wait until Claude Code has created it, then run the
   * project's setup actions there one by one (untrusted shared ones are skipped).
   */
  const worktreeSetup = (sessionId: string, repoCwd: string, worktreeName: string, branch = `worktree-${worktreeName}`) => {
    const root = resolver.resolve(repoCwd).root;
    const setup = actions.list(root).actions.filter((a) => a.runOnWorktreeCreate && a.type === 'shell');
    if (setup.length === 0) return undefined;
    return async () => {
      const path = join(root, '.claude', 'worktrees', worktreeName);
      const deadline = Date.now() + 30_000;
      while (!existsSync(path)) {
        if (Date.now() > deadline) throw new Error(`Worktree ${path} did not appear`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      for (const action of setup) {
        if (!action.trusted) {
          log('warn', `Skipped setup action "${action.name}": approve it once by running it from the actions menu`);
          continue;
        }
        const vars = { cwd: path, projectRoot: root, branch, worktreeName, sessionId, sessionTitle: '' };
        let command: string;
        try {
          command = expandCommand(action.command, vars, await terminals.shell());
        } catch (error) {
          log('warn', `Skipped setup action "${action.name}": ${(error as Error).message}`);
          continue;
        }
        const id = await runShellAction(sessionId, action.cwd === 'project-root' ? root : path, `Setup: ${action.name}`, command);
        const code = await terminals.waitForExit(id);
        if (code !== 0) log('warn', `Setup action "${action.name}" exited with ${code}`);
      }
    };
  };

  const defaultEditorKey = 'editor.default';
  const settingsStores: SettingsStores = { db: cache.db, appState, projects, profiles, actions, schedules, triggers, pipelines: pipelineStore };
  const editorEnv = () => shell.forLookup();

  /** Session count and latest activity per project folder, for the project list. */
  const folderActivity = () => {
    const activity = new Map<string, FolderActivity>();
    for (const s of sessions.snapshot().sessions) {
      const entry = activity.get(s.projectRoot);
      if (entry) {
        entry.count++;
        entry.lastActivity = Math.max(entry.lastActivity, s.updatedAt);
      } else activity.set(s.projectRoot, { count: 1, lastActivity: s.updatedAt });
    }
    return activity;
  };

  /** Starts a new session: New session's `session.create`, and a queued item starting (`later.start`). */
  const createSession = async (params: Parameters<Handlers<Contract>['session.create']>[0]) => {
    if (questions.contains(params.cwd)) {
      // A quick question has no checkout to branch from or switch.
      if (params.worktree || params.checkoutBranch || params.checkoutPullRequest) throw new RpcError('INVALID', 'Quick questions have no git options');
      questions.ensure();
    }
    const folder = statSafe(params.cwd);
    if (!folder) throw new RpcError('NOT_FOUND', `Folder not found: ${params.cwd}`);
    // Claude Code can't start in a file (spawn ENOTDIR), and the session would only say it isn't running.
    if (!folder.isDirectory()) throw new RpcError('NOT_A_FOLDER', `That is a file, not a folder: ${params.cwd}`);
    if (params.worktree && !resolver.resolve(params.cwd).gitDir) {
      throw new RpcError('NOT_A_REPO', 'Worktrees need a git repository');
    }
    const { checkoutBranch, checkoutPullRequest, github: origin, profileId: chosenProfile, worktree: asked, ...create } = params;
    const profileId = requireProfile(chosenProfile ?? folderProfile(params.cwd));
    // Auto routes once the session is open, so starting doesn't wait for it; the session says Auto is choosing until
    // it has picked. With Auto off it starts on the default model.
    const routes = create.model === AUTO_MODEL && autoModel.enabled;
    if (create.model === AUTO_MODEL) create.model = null;
    const pickModel = async (sessionId: string) => {
      const route = await router.route({ profileId, prompt: params.prompt, imageCount: params.attachments.length });
      if (route.routeId) routing.attach(route.routeId, sessionId);
      return { model: route.ok ? route.model : null, autoPick: autoPickOf(route.ok ? route : { ...route, model: null }) };
    };
    if (checkoutBranch) {
      if (params.worktree) throw new RpcError('INVALID', 'A new worktree gets its own branch; choose the current folder to check out a branch');
      // Only a real switch changes files under another session; starting on the branch already checked out is fine.
      const { current } = await listBranches(params.cwd).catch(() => ({ current: null }));
      if (current !== checkoutBranch) await assertCheckoutIdle(params.cwd);
      try {
        await switchBranch(params.cwd, checkoutBranch);
      } catch (error) {
        throw new RpcError('GIT_FAILED', `Could not check out ${checkoutBranch}: ${(error as Error).message}`);
      }
    }
    if (checkoutPullRequest) {
      if (asked || checkoutBranch) throw new RpcError('INVALID', 'A pull request is checked out in the current folder; not with a worktree or another branch');
      await assertCheckoutIdle(params.cwd);
      try {
        await checkoutPullRequest_(params.cwd, checkoutPullRequest, { gh: defaultGh(), env: (await shell.ready).env });
      } catch (error) {
        if (error instanceof PrCheckoutError) throw new RpcError(error.code, error.message);
        throw error;
      }
    }
    // A worktree from a branch (a pull request's) is made here; Claude Code makes the others itself (`--worktree`).
    let cwd = params.cwd;
    let worktree: ClaudeWorktreeRequest | null = null;
    let setupBranch: string | undefined;
    if (asked && typeof asked.baseRef === 'object') {
      try {
        const made = await makeWorktreeFrom(resolver.resolve(params.cwd).root, asked.name, asked.baseRef, { env: (await shell.ready).env });
        cwd = made.path;
        setupBranch = made.branch;
      } catch (error) {
        if (error instanceof WorktreeFromError) throw new RpcError('GIT_FAILED', error.message);
        throw error;
      }
    } else if (asked) worktree = { name: asked.name, baseRef: asked.baseRef as ClaudeWorktreeRequest['baseRef'] };
    const setup = asked ? (id: string) => worktreeSetup(id, params.cwd, asked.name, setupBranch)?.() ?? Promise.resolve() : undefined;
    const sessionId = await hosts.create({ ...create, cwd, worktree, profileId, ...(routes ? { pickModel } : {}), ...(setup ? { beforeFirstMessage: setup } : {}) });
    if (origin) {
      // Where it works on the pull request (the checkout's top folder, as git status reports it), and on which branch.
      const top = await topLevel(cwd).catch(() => cwd);
      const branch = setupBranch ?? (checkoutPullRequest ? (await listBranches(cwd).catch(() => ({ current: null }))).current : null);
      githubOrigins.save(sessionId, origin, { cwd: top, branch });
    }
    return { sessionId };
  };

  if (options.companion) {
    companion = new CompanionHub({
      infoDir: join(options.dataDir, COMPANION_DIR),
      appVersion: options.companion.appVersion,
      ...(options.companion.socketParent ? { socketParent: options.companion.socketParent } : {}),
      sources: () => ({ summaries: sessions.snapshot().sessions, live: liveList(), ...hosts.list() }),
      archiveAfterDays: () => retention.archiveAfterDays,
      windows: () => servers.size,
      respond: async (requestId, decision, acceptEdits) => {
        const sessionId = hosts.list().permissions.find((p) => p.requestId === requestId)?.sessionId;
        hosts.respond(requestId, decision);
        // Only once the plan is really approved, as its card in Switchboard does.
        if (acceptEdits && sessionId && decision.behavior === 'allow') await hosts.setPermissionMode(sessionId, 'acceptEdits').catch(() => {});
      },
      log,
    });
    void companion.start();
  }

  if (options.remote) {
    /** The profile here signed in to an account (its `accountKey`), the default one first when more than one is. */
    const profileOfAccount = (account: string): string | null => {
      const defaultId = profiles.defaultId();
      return (
        profiles
          .accounts()
          .filter((p) => accountKey(p.account) === account)
          .sort((a, b) => Number(b.id === defaultId) - Number(a.id === defaultId))[0]?.id ?? null
      );
    };
    remote = new RemoteHub({
      db: cache.db,
      appState,
      appVersion: options.remote.appVersion,
      ...(options.remote.appUrl ? { appUrl: options.remote.appUrl } : {}),
      previewApp: options.remote.previewApp ?? false,
      filesDir: join(options.dataDir, 'remote-files'),
      identity: options.remote.identity,
      sources: () => ({ summaries: sessions.snapshot().sessions, live: liveList(), ...hosts.list() }),
      archiveAfterDays: () => retention.archiveAfterDays,
      scope: () => sidebarScope,
      projects: () => listProjects().map((p) => ({ root: p.root, name: p.name, exists: p.exists, added: p.added, order: p.order, defaults: p.defaults, profileId: p.profileId })),
      profiles: () => {
        const tags = new Map(profiles.accounts().map((p) => [p.id, accountTag(p.account)]));
        return { profiles: profiles.exportEntries().map((p) => ({ ...p, account: tags.get(p.id) ?? null })), defaultId: profiles.defaultId() };
      },
      readTranscript: (sessionId) => transcripts.readWithHeld(sessionId),
      watchTranscript: (sessionId, listener) => transcripts.watch(sessionId, listener),
      send: async (sessionId, text, mode, images) => {
        // Send now stops the turn first: its end is yours, not news (as on this computer).
        if (mode === 'now') catchUp.interrupt(sessionId);
        const sent = await hosts.send({ sessionId, text, attachments: images, fork: false, mode });
        if (sent.sessionId === sessionId) sessions.wake(sessionId);
        return { messageUuid: sent.messageUuid, queued: sent.queued };
      },
      dequeue: (sessionId, id) => void hosts.dequeue(sessionId, id),
      upNext: (sessionId) => upNext.list(sessionId).map(summarise),
      limit: (sessionId) => remoteLimit(limits.state(), sessionId, sessionProfile(sessionId)),
      resumeLimit: (sessionId) => limits.resumeNow(sessionId),
      armLimit: (sessionId, armed) => limits.arm(sessionId, armed),
      interrupt: (sessionId) => {
        catchUp.interrupt(sessionId);
        return hosts.interrupt(sessionId, 'continue');
      },
      stopTask: (sessionId, taskId) => hosts.stopTask(sessionId, taskId),
      respond: (requestId, decision) => hosts.respond(requestId, decision),
      create: (root, prompt, choice, images) =>
        createSession({
          cwd: root,
          prompt,
          attachments: images,
          model: choice.model,
          permissionMode: choice.permissionMode,
          effort: choice.effort,
          worktree: choice.worktree ? { name: randomWorktreeName(), baseRef: worktreeRequestBase(choice.baseRef) } : null,
          profileId: choice.profileId,
          checkoutBranch: choice.checkoutBranch,
        }),
      branches: async (root) => (resolver.resolve(root).gitDir ? listBranches(root) : { current: null, branches: [], checkedOutElsewhere: [] }),
      queue: (root, prompt, choice) => {
        const item = later.add({ cwd: root, prompt, model: choice.model, effort: choice.effort, permissionMode: choice.permissionMode, workspace: choice.worktree ? 'worktree' : 'current', baseRef: choice.baseRef, branch: choice.checkoutBranch, profileId: choice.profileId }, {});
        laterChanged();
        return { id: item.id };
      },
      markRead: (sessionId) => sessions.markViewed(sessionId),
      markUnread: (sessionId) => sessions.markUnviewed(sessionId),
      setFlags: (sessionId, flags) => {
        sessions.setFlags(sessionId, flags);
        // Archived: a trigger's issue loses its working or needs input label.
        if (flags.archived === true) triggerWatcher?.released(sessionId);
      },
      setModel: (sessionId, model) => hosts.setModel(sessionId, model),
      setEffort: (sessionId, effort) => hosts.setEffort(sessionId, effort),
      setPermissionMode: (sessionId, mode) => hosts.setPermissionMode(sessionId, mode),
      models: () => hosts.listModels(),
      autoModel: () => ({ enabled: autoModel.enabled, allowed: [...autoModel.allowed] }),
      usage: (profileId, refresh) => usageFor(profileId).get(refresh),
      tokens: (account, params) => {
        const match = profileOfAccount(account);
        return match ? insights.breakdown(match, params) : null;
      },
      sessionCost: (sessionId) => insights.sessionCost(sessions.get(sessionId)?.profileId ?? profiles.defaultId(), sessionId),
      windowCosts: (account, windows) => {
        const match = profileOfAccount(account);
        return match ? insights.windowCostsFrom(match, windows) : null;
      },
      // `asker` is made further down; a phone can only ask once the engine is running.
      ask: (sessionId, question, threadId, replaces) => asker.ask(sessionId, question, threadId, replaces),
      askThreads: (sessionId) => asker.list(sessionId),
      catchUp: (sessionId) => catchUp.get(sessionId),
      changes: async (sessionId) => {
        const cwd = sessionCwd(sessionId);
        if (!cwd) return null;
        try {
          return await listChanges(cwd, 'uncommitted');
        } catch (error) {
          throw new RpcError('GIT_FAILED', (error as Error).message);
        }
      },
      diff: async (sessionId, path) => {
        const cwd = sessionCwd(sessionId);
        if (!cwd) throw new RpcError('NOT_FOUND', 'This session has no folder');
        try {
          return await fileDiff(cwd, 'uncommitted', path);
        } catch (error) {
          throw new RpcError('GIT_FAILED', (error as Error).message);
        }
      },
      commit: async (sessionId, message) => {
        const cwd = sessionCwd(sessionId);
        if (!cwd || !resolver.resolve(cwd).gitDir) throw new RpcError('NOT_A_REPO', 'Not a git repository');
        await assertCheckoutIdle(cwd);
        try {
          return await commitAll(cwd, message, (await shell.ready).env);
        } catch (error) {
          throw new RpcError('GIT_FAILED', (error as Error).message);
        }
      },
      clonePlan: (url, name) => clones.plan(url, name),
      clone: async (jobId, url, name, onProgress) => {
        cloneListeners.set(jobId, onProgress);
        try {
          await clones.start(jobId, url, name);
        } catch (error) {
          cloneListeners.delete(jobId);
          throw error;
        }
      },
      cancelClone: (jobId) => clones.cancel(jobId),
      onStatus: (status) => broadcast('remote.changed', status),
      onFromDevice: (event) => broadcast('remote.fromDevice', event),
      log,
    });
    void remote.start();
  }

  if (options.remote?.deviceKey) {
    computers = new ComputerHub({
      db: cache.db,
      deviceKey: options.remote.deviceKey,
      onStatus: (status) => broadcast('computers.changed', status),
      onEvent: (event) => broadcast('computers.event', event),
      log,
    });
    void computers.start().catch((error: Error) => log('warn', `Other computers: ${error.message}`));
  }

  // --- Archived sessions: Settings › Sessions -------------------------------------------------------------------
  /** Main sends the settings when the engine starts and after each change; until then, the defaults (deleting off). */
  let retention: RetentionPolicy = DEFAULT_RETENTION;
  /** Session files only ever go to the Trash: without a way to put them there, nothing is deleted. */
  const sessionTrash = () => {
    if (!options.trash) throw new RpcError('NO_TRASH', "Switchboard can't move sessions to the Trash here, so it won't delete them.");
    return options.trash;
  };
  /** Every indexed session with what the archive and keep rules need, now. */
  const retentionCandidatesNow = () =>
    retentionCandidates({
      summaries: sessions.snapshot().sessions,
      live: liveList(),
      ...hosts.list(),
      drafts: sessionsWithDrafts(appState.get(DRAFTS_KEY)),
      // Messages waiting in Up next keep their session, like a queued prompt does.
      queued: new Set([...sessionsWithQueuedPrompts(later.list()), ...upNext.all().map((q) => q.sessionId)]),
    });
  // Questions about a session (Ask about this session, /btw) are kept per session, apart from the transcript;
  // answers go to every window, and their tokens count on the session's profile.
  const askStore = new AskStore(cache.db);
  const asker = new Asker({
    store: askStore,
    ask: (sessionId, prompt, onText) => hosts.askAbout(sessionId, prompt, onText),
    emit: (event) => broadcast('session.ask', event),
    recordUsage: (sessionId, id, usage) => {
      const profileId = sessionProfile(sessionId);
      askStore.recordUsage(scopeOf(profiles.runtime(profileId).configDir), sessionId, id, Date.now(), usage);
      broadcast('usage.tokens', { profileIds: [profileId], scan: null });
    },
    stub: options.stubSideQuestions,
    log,
  });
  /** Moves one session's transcript and subagent transcripts to the Trash and forgets it. */
  const deleteSession = async (sessionId: string) => {
    const toTrash = sessionTrash();
    if (!hosts.has(sessionId) && liveList().some((l) => l.sessionId === sessionId)) {
      throw new RpcError('SESSION_BUSY_ELSEWHERE', 'This session is open in another Claude Code window. Close it there first.');
    }
    await hosts.release(sessionId);
    const transcript = sessions.pathFor(sessionId);
    if (!transcript) throw new RpcError('NOT_FOUND', 'No transcript found for this session');
    // The same files Claude Code's own deleteSession removes: the transcript and its subagent folder.
    const paths = [transcript, transcript.replace(/\.jsonl$/, '')].filter((p) => existsSync(p));
    await toTrash(paths, { configDir: profiles.runtime(sessionProfile(sessionId)).configDir });
    sessions.forget(sessionId);
    hosts.forget(sessionId);
    limits.forget(sessionId);
    triggerWatcher?.released(sessionId);
    catchUp.forget(sessionId);
    upNext.save(sessionId, []);
    askStore.forget(sessionId);
    owned.delete(sessionId);
    unmarkOwned.run(sessionId);
    continued.delete(sessionId);
    unmarkContinued.run(sessionId);
  };
  /**
   * The daily clean-up: archived sessions that have been in Archived for longer than the days set go to the Trash, with
   * the same sessions kept as when you delete by hand. Logged to Diagnostics. Null when deleting is off.
   */
  const deleteArchived = async (): Promise<ArchivedCleanup | null> => {
    const { deleteArchived: setting, archiveAfterDays } = retention;
    if (!setting.enabled) return null;
    if (!options.trash) {
      log('warn', 'Not deleting archived sessions: nothing here can move them to the Trash');
      return null;
    }
    const { due, kept } = dueForDeletion(retentionCandidatesNow(), { now: Date.now(), archiveAfterDays, afterDays: setting.afterDays });
    const report: ArchivedCleanup = { deleted: 0, bytes: 0, kept: kept.length, failed: 0 };
    for (const session of due) {
      try {
        await deleteSession(session.id);
        report.deleted++;
        report.bytes += session.summary.fileSize ?? 0;
      } catch (error) {
        report.failed++;
        log('warn', `Couldn't move archived session ${session.id} to the Trash: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const reasons = [...new Set(kept.map((k) => KEEP_REASON_TEXT[k.reason]))];
    log(
      'info',
      `Deleting archived sessions (in Archived for over ${setting.afterDays} days): moved ${report.deleted} to the Trash (${megabytes(report.bytes)}); kept ${report.kept}${reasons.length ? ` (${reasons.join(', ')})` : ''}${report.failed ? `; ${report.failed} failed` : ''}`,
    );
    return report;
  };
  let cleanupRunning: Promise<unknown> = Promise.resolve();
  /** One clean-up at a time: a second request waits for the first. */
  const runCleanup = (): Promise<ArchivedCleanup | null> => {
    const run = cleanupRunning.then(deleteArchived);
    cleanupRunning = run.catch(() => {});
    return run;
  };
  /** A run nobody waits for (launch, daily, a changed setting): a failure goes to the log. */
  const cleanupInBackground = () =>
    void runCleanup().catch((error: unknown) => log('error', `Deleting archived sessions failed: ${error instanceof Error ? error.message : String(error)}`));
  let scanned = false;
  let policyReceived = false;
  let launchRun = false;
  /** On launch, once the settings arrived and the first scan is done; then once a day while the app is open. */
  const maybeRunOnLaunch = () => {
    if (launchRun || !scanned || !policyReceived) return;
    launchRun = true;
    cleanupInBackground();
  };
  scanCompleteHook = () => {
    scanned = true;
    maybeRunOnLaunch();
  };
  const dailyCleanup = setInterval(cleanupInBackground, DAY_MS);
  dailyCleanup.unref?.();
  /** A change to the settings runs the clean-up shortly after (the dialog said they go today), once the stepper settles. */
  let settingTimer: ReturnType<typeof setTimeout> | undefined;
  const setRetention = (policy: RetentionPolicy) => {
    const before = retention;
    retention = policy;
    if (before.archiveAfterDays !== policy.archiveAfterDays) companion?.sessionsChanged();
    if (!policyReceived) {
      policyReceived = true;
      return maybeRunOnLaunch();
    }
    if (!launchRun || !policy.deleteArchived.enabled || JSON.stringify(before) === JSON.stringify(policy)) return;
    clearTimeout(settingTimer);
    settingTimer = setTimeout(cleanupInBackground, 5_000);
    settingTimer.unref?.();
  };

  const requireComputers = () => {
    if (!computers) throw new RpcError('UNAVAILABLE', 'Other computers are not available in this build');
    return computers;
  };
  const requireRemote = () => {
    if (!remote) throw new RpcError('UNAVAILABLE', 'Remote is not available in this build');
    return remote;
  };

  const handlers: Handlers<Contract> = {
    'system.info': async (): Promise<SystemInfo> => {
      const described = await shell.describe();
      return {
        engineVersion: pkg.version,
        startedAt,
        versions: {
          node: process.versions.node,
          electron: process.versions.electron ?? null,
          sqlite: cache.sqliteVersion,
        },
        paths: { dataDir: options.dataDir, database: cache.path, claudeConfigDir, home: homedir() },
        shell: { path: described.shell, resolved: described.resolved, cached: described.cached, durationMs: described.durationMs },
        claude: await claude,
      };
    },
    'system.ping': ({ sentAt }) => ({ sentAt, engineTime: Date.now() }),
    'appState.get': ({ key }) => ({ value: appState.get(key) }),
    'appState.set': ({ key, value }) => {
      appState.set(key, value);
      return {};
    },
    'sessions.list': () => ({ ...sessions.snapshot(), live: liveList() }),
    'sessions.linkInfo': ({ sessionId }) => links.info(sessionId),
    'sessions.setFlags': ({ sessionId, pinned, archived }) => {
      sessions.setFlags(sessionId, {
        ...(pinned !== undefined ? { pinned } : {}),
        ...(archived !== undefined ? { archived } : {}),
      });
      // Archived: a trigger's issue loses its working or needs input label.
      if (archived === true) triggerWatcher?.released(sessionId);
      return {};
    },
    'session.delete': async ({ sessionId }) => {
      await deleteSession(sessionId);
      log('info', `Moved session ${sessionId} to the Trash`);
      return {};
    },
    'sessions.deleteMany': async ({ sessionIds }) => {
      sessionTrash();
      const candidates = new Map(retentionCandidatesNow().map((c) => [c.id, c]));
      const deleted: Array<{ id: string; fileSize: number | null }> = [];
      const skipped: Array<{ id: string; reason: KeepReason | 'not-found' | 'failed'; error: string | null }> = [];
      for (const id of new Set(sessionIds)) {
        const candidate = candidates.get(id);
        if (!candidate || !sessions.pathFor(id)) {
          skipped.push({ id, reason: 'not-found', error: null });
          continue;
        }
        const reason = keepReason(candidate.deletion);
        if (reason) {
          skipped.push({ id, reason, error: null });
          continue;
        }
        try {
          await deleteSession(id);
          deleted.push({ id, fileSize: candidate.summary.fileSize });
        } catch (error) {
          skipped.push({ id, reason: 'failed', error: error instanceof Error ? error.message : String(error) });
        }
      }
      const size = deleted.reduce((sum, d) => sum + (d.fileSize ?? 0), 0);
      log('info', `Moved ${deleted.length} ${deleted.length === 1 ? 'session' : 'sessions'} (${megabytes(size)}) to the Trash${skipped.length ? `; kept ${skipped.length}` : ''}`);
      return { deleted, skipped };
    },
    'session.reveal': async ({ sessionId }) => {
      const transcript = sessions.pathFor(sessionId);
      if (!transcript || !existsSync(transcript)) throw new RpcError('NOT_FOUND', 'No transcript found for this session');
      openInEditor('finder', transcript, undefined, await editorEnv());
      return {};
    },
    'profiles.revealProjects': async ({ profileId }) => {
      if (!profiles.has(profileId)) throw new RpcError('NOT_FOUND', 'No such profile');
      const folder = join(profiles.runtime(profileId).configDir, 'projects');
      if (!existsSync(folder)) throw new RpcError('NOT_FOUND', `Not found: ${folder}`);
      openInEditor('finder', folder, undefined, await editorEnv());
      return {};
    },
    'profiles.cleanupPeriods': () => ({
      profiles: profiles.runtimes().map((profile) => ({ profileId: profile.id, ...readProfileCleanup(profile.configDir) })),
    }),
    'profiles.setCleanupPeriod': ({ profileId, days }) => {
      if (!profiles.has(profileId)) throw new RpcError('NOT_FOUND', 'No such profile');
      const { configDir } = profiles.runtime(profileId);
      try {
        writeProfileCleanup(configDir, days);
      } catch (error) {
        throw new RpcError('WRITE_FAILED', `Couldn't change ${settingsPathOf(configDir)}: ${error instanceof Error ? error.message : String(error)}`);
      }
      log('info', `Set cleanupPeriodDays in ${settingsPathOf(configDir)} to ${days ?? 'the default'}`);
      return {};
    },
    'session.rename': async ({ sessionId, title }) => {
      if (!source.rename) throw new RpcError('UNSUPPORTED', 'Renaming is not available');
      if (!sessions.pathFor(sessionId)) throw new RpcError('NOT_FOUND', 'No transcript found for this session');
      // One line, like the titles Claude Code makes itself.
      await source.rename(sessionId, title.replace(/\s+/g, ' ').trim());
      await sessions.reread(sessionId);
      return {};
    },
    'sessions.markViewed': ({ sessionId }) => {
      sessions.markViewed(sessionId);
      return {};
    },
    'sessions.markUnviewed': ({ sessionId }) => {
      sessions.markUnviewed(sessionId);
      return {};
    },
    'projects.list': () => ({ projects: listProjects() }),
    'projects.findByRepo': async ({ repo }) => {
      const folders = listProjects().filter((p) => p.exists).map((p) => p.root);
      return { root: await findCheckout(folders, repo) };
    },
    'projects.cloneSettings': () => clones.settings(),
    'projects.setCloneSettings': (change) => clones.setSettings(change),
    'projects.clonePlan': ({ url, name }) => clones.plan(url, name),
    'projects.clone': async ({ jobId, url, name }) => {
      await clones.start(jobId, url, name);
      return {};
    },
    'projects.cancelClone': ({ jobId }) => {
      clones.cancel(jobId);
      return {};
    },
    'projects.add': ({ path }) => {
      questions.assertNotProject(path);
      projects.add(path);
      return {};
    },
    'projects.remove': ({ root }) => {
      projects.remove(root);
      pauseSchedulesIn(root, 'Project removed');
      pauseTriggersIn(root, 'Project removed');
      return {};
    },
    'projects.setIcon': ({ root, icon }) => {
      questions.assertNotProject(root);
      projects.setIcon(root, icon);
      return {};
    },
    'projects.rename': ({ root, name }) => {
      questions.assertNotProject(root);
      projects.rename(root, name);
      return {};
    },
    'projects.setProfile': ({ root, profileId }) => {
      questions.assertNotProject(root);
      profiles.linkProject(root, profileId);
      return {};
    },
    'profiles.list': () => profiles.snapshot(),
    'profiles.add': ({ name, color, configDir }) => {
      const id = profiles.add(name, color, configDir);
      log('info', `Added Claude profile "${name}" (${configDir})`);
      return { id };
    },
    'profiles.update': ({ id, name, color }) => {
      profiles.update(id, { ...(name !== undefined ? { name } : {}), ...(color !== undefined ? { color } : {}) });
      return {};
    },
    'profiles.remove': ({ id }) => {
      profiles.remove(id);
      return {};
    },
    'profiles.setDefault': ({ id }) => {
      profiles.setDefault(id);
      return {};
    },
    'profiles.setDefaults': ({ id, defaults }) => {
      profiles.setDefaults(id, defaults);
      return {};
    },
    'projects.setDefaults': ({ root, defaults }) => {
      questions.assertNotProject(root);
      projects.setDefaults(root, defaults);
      return {};
    },
    'projects.reorder': ({ roots }) => {
      projects.reorder(roots);
      return {};
    },
    'sessions.refresh': async () => {
      await sessions.refresh();
      scanLive();
      return {};
    },
    'transcript.get': async ({ sessionId }) => ({ sessionId, messages: await transcripts.read(sessionId) }),
    'transcript.subagent': async ({ sessionId, toolUseId }) => {
      // Each subagent leaves agent-<id>.meta.json next to its transcript, naming the tool call that started it.
      const transcript = sessions.pathFor(sessionId);
      const dir = transcript ? join(transcript.replace(/\.jsonl$/, ''), 'subagents') : null;
      let agentId: string | null = null;
      let agentType: string | null = null;
      for (const file of dir && existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.meta.json')) : []) {
        try {
          const meta = JSON.parse(readFileSync(join(dir!, file), 'utf8')) as { toolUseId?: unknown; agentType?: unknown };
          if (meta.toolUseId === toolUseId) {
            agentId = file.replace(/^agent-/, '').replace(/\.meta\.json$/, '');
            agentType = typeof meta.agentType === 'string' ? meta.agentType : null;
            break;
          }
        } catch {
          // A half-written meta file: the next poll will see it.
        }
      }
      if (!agentId || !source.subagentMessages) return { agentId, agentType, messages: [] };
      const sink = transcripts.images.sink(sessionId);
      return { agentId, agentType, messages: (await source.subagentMessages(sessionId, agentId)).map((m) => normaliseMessage(m, sink)) };
    },
    'transcript.agentUsage': async ({ sessionId }) => ({ agents: await agentUsage(sessions.pathFor(sessionId)) }),
    'transcript.diagnose': async ({ sessionId }) =>
      diagnoseTranscript(
        sessionId,
        sessions.pathFor(sessionId),
        profiles.runtimes().map((profile) => ({ profileId: profile.id, configDir: profile.configDir, source: sourceFor(profile) })),
      ),
    'transcript.image': async ({ sessionId, imageId }) => {
      const image = await transcripts.image(sessionId, imageId);
      if (!image) throw new RpcError('NOT_FOUND', 'Image not found in this transcript');
      return image;
    },
    'transcript.watch': ({ sessionId }, context) => {
      const map = subscriptionsFor(context);
      if (!map.has(sessionId)) {
        map.set(sessionId, transcripts.watch(sessionId, (update) => context.emit('transcript.updated', update)));
      }
      return {};
    },
    'transcript.unwatch': ({ sessionId }, context) => {
      const map = subscriptionsFor(context);
      map.get(sessionId)?.();
      map.delete(sessionId);
      return {};
    },

    'hosts.list': () => {
      const list = hosts.list();
      return smokeHosts.size ? { ...list, hosts: [...list.hosts, ...smokeHosts.values()] } : list;
    },
    'session.create': createSession,
    'session.send': async (params) => {
      // Send now stops the turn first: its end is yours, not news.
      if (params.mode === 'now') catchUp.interrupt(params.sessionId);
      const sent = await hosts.send(params);
      if (sent.sessionId === params.sessionId) sessions.wake(params.sessionId);
      return sent;
    },
    'session.queue.remove': ({ sessionId, id }) => ({ message: hosts.dequeue(sessionId, id) }),
    'session.queue.move': ({ sessionId, id, toIndex }) => {
      hosts.moveQueued(sessionId, id, toIndex);
      return {};
    },
    'session.queue.sendNow': async ({ sessionId, id }) => {
      catchUp.interrupt(sessionId);
      await hosts.sendQueuedNow(sessionId, id);
      sessions.wake(sessionId);
      return {};
    },
    'session.queue.resume': async ({ sessionId }) => {
      await hosts.resumeQueue(sessionId);
      sessions.wake(sessionId);
      return {};
    },
    'upNext.list': () => ({ queues: hosts.upNextLists() }),
    'limits.state': () => limits.state(),
    'limits.resume': async ({ sessionId }) => {
      await limits.resumeNow(sessionId);
      return {};
    },
    'limits.arm': ({ sessionId, armed }) => {
      limits.arm(sessionId, armed);
      return {};
    },
    'session.forkAt': async ({ sessionId, messageUuid }) => {
      if (!source.fork) throw new RpcError('UNSUPPORTED', 'Forking is not available');
      let forked: string;
      try {
        forked = await source.fork(sessionId, messageUuid);
      } catch (error) {
        throw new RpcError('FORK_FAILED', (error as Error).message);
      }
      owned.add(forked);
      markOwned.run(forked, Date.now());
      await sessions.refresh();
      return { sessionId: forked };
    },
    'session.rewind': ({ sessionId, messageUuid, dryRun }) => hosts.rewind(sessionId, messageUuid, dryRun),
    'session.interrupt': async ({ sessionId }) => {
      catchUp.interrupt(sessionId);
      await hosts.interrupt(sessionId);
      return {};
    },
    'session.stopTask': async ({ sessionId, taskId }) => {
      await hosts.stopTask(sessionId, taskId);
      return {};
    },
    'session.taskOutput': async ({ outputFile }) => readTaskOutput(outputFile),
    'session.savedSettings': ({ sessionId }) => hosts.savedSettings(sessionId),
    'session.setPermissionMode': async ({ sessionId, mode }) => {
      await hosts.setPermissionMode(sessionId, mode);
      return {};
    },
    'session.autoPick': ({ sessionId }) => ({ autoPick: hosts.autoPick(sessionId) }),
    'session.setEffort': async ({ sessionId, effort }) => {
      await hosts.setEffort(sessionId, effort);
      return {};
    },
    'session.context': ({ sessionId }) => hosts.context(sessionId),
    // Answered beside whatever the session does: never through session.send, so never in its turn or Up next.
    'session.ask': ({ sessionId, threadId, question, replaces }) => asker.ask(sessionId, question, threadId, replaces),
    'session.askThreads': ({ sessionId }) => asker.list(sessionId),
    'session.setModel': async ({ sessionId, model }) => {
      await hosts.setModel(sessionId, model);
      return {};
    },
    'session.close': ({ sessionId }) => {
      hosts.close(sessionId);
      return {};
    },
    'session.continueInEditor': async ({ sessionId, editorId }) => {
      if (!hosts.has(sessionId) && liveList().some((l) => l.sessionId === sessionId)) {
        throw new RpcError('SESSION_BUSY_ELSEWHERE', 'This session is open in another Claude Code window. Close it there first.');
      }
      const cwd = sessions.get(sessionId)?.cwd ?? hosts.list().hosts.find((h) => h.sessionId === sessionId)?.cwd ?? null;
      if (!cwd || !existsSync(cwd)) throw new RpcError('NOT_FOUND', 'The folder of this session is gone');
      // The editor's extension won't open a session another process still has: stop it here first.
      await hosts.release(sessionId);
      await continueInEditor(editorId, cwd, sessionId, await editorEnv());
      return {};
    },
    'mods.snapshot': () => ({ sessions: hosts.modsSnapshots() }),
    'mods.render': ({ sessionId, ...params }) => hosts.mods(sessionId).render({ sessionId, ...params }),
    'mods.press': (params) => hosts.mods(params.sessionId).press(params),
    'mods.input': (params) => hosts.mods(params.sessionId).input(params),
    'mods.select': (params) => hosts.mods(params.sessionId).select(params),
    'mods.scroll': (params) => hosts.mods(params.sessionId).scroll(params),
    'mods.focus': (params) => hosts.mods(params.sessionId).focus(params),
    'mods.panes': ({ sessionId }) => hosts.mods(sessionId).panes(),
    'mods.pane': async ({ sessionId, action, id }) => {
      await hosts.mods(sessionId).pane(action, id);
      return {};
    },
    'mods.promptAnswer': (answer) => {
      hosts.answerModPrompt(answer);
      return {};
    },
    'mods.hooked': async ({ profileId }) => {
      const stored = appState.get(`mods-hooked:${profileId}`) as { key: string; hooked: HookableComponent[] } | null;
      if (!stored) return { hooked: [] };
      const key = hookedCacheKey({ profileId, configDir: profiles.runtime(profileId).configDir, env: await envFor(profileId) });
      return { hooked: stored.key === key ? stored.hooked : [] };
    },
    'mods.logs': ({ sessionId }) => ({ logs: hosts.modLogs(sessionId) }),
    'mods.list': async () => {
      const runtimes = profiles.runtimes();
      const envs = await Promise.all(runtimes.map((p) => envFor(p.id)));
      return { mods: listMods(runtimes.map((p, i) => ({ profileId: p.id, configDir: p.configDir, env: envs[i]! }))) };
    },
    'session.respond': ({ requestId, decision }) => {
      hosts.respond(requestId, decision);
      return {};
    },
    'session.commands': async ({ sessionId, cwd, profileId }) => ({
      commands: await hosts.commands(sessionId, cwd, profileId ?? (sessionId ? sessionProfile(sessionId) : cwd ? folderProfile(cwd) : profiles.defaultId())),
    }),
    'session.capabilities': ({ sessionId, cwd, refresh, profileId }) =>
      hosts.capabilities(sessionId, cwd, refresh, profileId ?? (sessionId ? sessionProfile(sessionId) : folderProfile(cwd))),
    'skills.reload': () => {
      hosts.reloadSkills(profiles.runtimes().map((p) => p.id));
      broadcast('commands.changed', {});
      return {};
    },
    'session.mcp': async ({ sessionId, server, action }) => {
      await hosts.mcp(sessionId, server, action);
      return {};
    },
    'session.prewarm': ({ cwd, profileId }) => {
      if (questions.contains(cwd)) questions.ensure();
      const profile = profileId && profiles.has(profileId) ? profileId : folderProfile(cwd);
      if (statSafe(cwd)?.isDirectory()) void hosts.prewarm(cwd, profile).catch((error: Error) => log('debug', `Pre-warm failed: ${error.message}`));
      return {};
    },
    'models.list': () => ({ models: hosts.listModels() }),
    'usage.get': ({ refresh, profileId }) => usageFor(profileId && profiles.has(profileId) ? profileId : profiles.defaultId()).get(refresh),
    'usage.breakdown': ({ profileId, ...params }) => insights.breakdown(profileId && profiles.has(profileId) ? profileId : profiles.defaultId(), params),
    'usage.history': ({ profileId, ...params }) => insights.planHistory(profileId && profiles.has(profileId) ? profileId : profiles.defaultId(), params),
    'usage.cost': ({ profileId }) => ({ windows: insights.windowCosts(profileId && profiles.has(profileId) ? profileId : profiles.defaultId()) }),
    'usage.sessionCost': ({ sessionId, profileId }) => ({ cost: insights.sessionCost(profileId && profiles.has(profileId) ? profileId : profiles.defaultId(), sessionId) }),

    'questions.folder': () => ({ path: questions.ensure() }),
    'projects.inspect': ({ path }) => {
      // A file is not a folder to work in: it reports as missing, with `isFile` so the message can say why.
      const stat = statSafe(path);
      const exists = stat?.isDirectory() ?? false;
      const location = resolver.resolve(path);
      return { path, exists, ...(stat && !exists ? { isFile: true } : {}), isGitRepo: exists && location.gitDir !== null, root: location.root, branch: resolver.branch(location) };
    },
    'fs.folders': ({ path, prefix }) => listFolders(path, prefix),
    'files.search': async ({ cwd, query, limit }) => ({ files: await files.search(cwd, query, limit) }),
    'files.resolve': async ({ cwd, paths }) => ({ paths: await files.resolve(cwd, paths) }),
    'files.read': ({ path }) => readPreview(path),
    'files.image': ({ path }) => readPreviewImage(path),
    'editors.list': async () => {
      const editors = detectEditors(await editorEnv());
      const stored = appState.get(defaultEditorKey);
      const defaultId = typeof stored === 'string' && editors.some((e) => e.id === stored) ? stored : (editors.find((e) => e.kind === 'editor')?.id ?? null);
      return { editors, defaultId };
    },
    'editors.open': async ({ path, line, editorId }) => {
      const env = await editorEnv();
      const stored = appState.get(defaultEditorKey);
      const id = editorId ?? (typeof stored === 'string' ? stored : detectEditors(env).find((e) => e.kind === 'editor')?.id);
      if (!id) throw new RpcError('NO_EDITOR', 'No editor found. Install one or pick one in the Open in menu.');
      if (!existsSync(path)) throw new RpcError('NOT_FOUND', `Not found: ${path}`);
      // A file opens in the window of its checkout (the worktree, or the repository), not whichever window was used last.
      const location = resolver.resolve(dirname(path));
      const folder = location.gitDir ? (location.worktree?.path ?? location.root) : undefined;
      openInEditor(id, path, line, env, folder);
      if (editorId && (detectEditors(env).find((e) => e.id === editorId)?.kind === 'editor')) appState.set(defaultEditorKey, editorId);
      return {};
    },
    'editors.setDefault': ({ editorId }) => {
      appState.set(defaultEditorKey, editorId);
      return {};
    },

    'savedPrompts.list': ({ root }) => {
      if (root) sharedFileWatcher.watch(root);
      return savedPrompts.list(root);
    },
    'savedPrompts.save': ({ prompt }) => {
      const saved = savedPrompts.save(prompt);
      promptsChanged(prompt.scope);
      return { prompt: saved };
    },
    'savedPrompts.delete': ({ id, scope }) => {
      savedPrompts.remove(id, scope);
      promptsChanged(scope);
      return {};
    },
    'savedPrompts.move': ({ id, from, to }) => {
      const prompt = savedPrompts.move(id, from, to);
      promptsChanged(from, to);
      return { prompt };
    },
    'savedPrompts.used': ({ id, scope }) => {
      savedPrompts.used(id, scope);
      promptsChanged(scope);
      return {};
    },
    'github.status': ({ root }) => github.status(root),
    'github.search': ({ root, query, refresh }) => github.search(root, query, { refresh }),
    'github.issue': ({ root, ref }) => github.issue(root, ref),
    'github.pr': ({ root, ref }) => github.pr(root, ref),
    'github.origin': ({ sessionId }) => ({ origin: githubOrigins.get(sessionId) }),

    'actions.list': ({ projectRoot }) => {
      sharedFileWatcher.watch(projectRoot);
      return actions.list(projectRoot);
    },
    'actions.save': ({ projectRoot, action, previousId, shared }) => {
      if (shared) {
        if (!projectRoot) throw new RpcError('INVALID_PARAMS', 'A shared action needs its project');
        actions.saveShared(projectRoot, action, previousId);
      } else actions.save(projectRoot, action, previousId);
      broadcast('actions.changed', { root: projectRoot });
      return {};
    },
    'actions.delete': ({ projectRoot, id, shared }) => {
      if (shared) {
        if (!projectRoot) throw new RpcError('INVALID_PARAMS', 'A shared action needs its project');
        actions.removeShared(projectRoot, id);
      } else actions.remove(projectRoot, id);
      broadcast('actions.changed', { root: projectRoot });
      return {};
    },
    'actions.trust': ({ projectRoot, id }) => {
      const action = actions.list(projectRoot).actions.find((a) => a.id === id);
      if (!action) throw new RpcError('NOT_FOUND', 'No such action');
      if (action.scope === 'shared') actions.trust(projectRoot, action.command);
      else actions.approve(action.scope === 'global' ? null : projectRoot, action.id);
      return {};
    },
    'actions.suggest': ({ projectRoot }) => ({ suggestions: suggestActions(projectRoot) }),
    'actions.run': async ({ sessionId, projectRoot, cwd, id }) => {
      const action = findAction(projectRoot, id);
      const vars = actionVars(sessionId, projectRoot, cwd);
      if (action.type === 'prompt') {
        const sent = await hosts.send({ sessionId, text: expandCommand(action.command, vars, null), attachments: [], fork: false });
        sessions.wake(sessionId);
        return { kind: 'prompt' as const, sessionId: sent.sessionId, messageUuid: sent.messageUuid };
      }
      const runIn = action.cwd === 'project-root' ? projectRoot : cwd;
      const command = expandCommand(action.command, vars, await terminals.shell());
      const terminalId = await runShellAction(sessionId, runIn, action.name, command);
      actionRuns.set(terminalId, { sessionId, projectRoot, cwd, id });
      if (action.sendOutput) runReports.set(terminalId, { sessionId, command, action: action.name });
      return { kind: 'terminal' as const, terminalId };
    },
    'later.list': ({ cwd }) => ({ items: later.list(cwd), started: later.startedLinks(), auto: autoStarter!.auto() }),
    'later.add': ({ draft, id, createdAt, index, waitFor }) => {
      const item = later.add(draft, { id, createdAt, index, waitFor });
      laterChanged();
      return { item };
    },
    'later.remove': ({ id, startedAs }) => {
      if (startedAs) {
        later.started(id, startedAs);
        // Started from New session: a trigger's event follows the session, as when the queue starts it.
        const title = triggerWatcher?.queuedStarted(id, startedAs);
        if (title) {
          pendingTitles.set(startedAs, title);
          applyTitles([startedAs]);
        }
      } else {
        later.remove(id);
        triggerWatcher?.queueRemoved(id);
      }
      laterChanged();
      return {};
    },
    'later.reorder': ({ id, toIndex }) => {
      if (!later.reorder(id, toIndex)) throw new RpcError('NOT_FOUND', 'That item is no longer in the queue');
      laterChanged();
      return {};
    },
    'later.update': ({ id, waitFor, autoStart, draft }) => {
      const item = later.update(id, { waitFor, autoStart, draft });
      if (!item) throw new RpcError('NOT_FOUND', 'That item is no longer in the queue');
      laterChanged();
      return { item };
    },
    'later.start': async ({ id }) => {
      const item = later.get(id);
      if (!item) throw new RpcError('NOT_FOUND', 'That item is no longer in the queue');
      return { sessionId: await startQueuedOrStub(item) };
    },
    'schedules.list': () => ({ schedules: schedules.list(), sessions: schedules.sessions() }),
    'schedules.save': ({ schedule: input }) => {
      if (input.id && !schedules.get(input.id)) throw new RpcError('NOT_FOUND', 'That schedule was deleted');
      const schedule = schedules.save(input);
      schedulesBroadcast();
      scheduler.rearm();
      return { schedule };
    },
    'schedules.delete': ({ id }) => {
      schedules.remove(id);
      schedulesBroadcast();
      scheduler.rearm();
      return {};
    },
    'schedules.restore': ({ schedule: input }) => {
      const schedule = schedules.restore(input);
      schedulesBroadcast();
      scheduler.rearm();
      return { schedule };
    },
    'schedules.setPaused': ({ id, paused }) => {
      const schedule = schedules.setPaused(id, paused);
      if (!schedule) throw new RpcError('NOT_FOUND', 'That schedule was deleted');
      schedulesBroadcast();
      scheduler.rearm();
      return { schedule };
    },
    'schedules.skipRun': ({ id, at }) => skipRun(id, at, true),
    'schedules.unskipRun': ({ id, at }) => skipRun(id, at, false),
    'schedules.runNow': async ({ id }) => {
      const run = await scheduler.runNow(id);
      if (!run) throw new RpcError('NOT_FOUND', 'That schedule was deleted');
      return { run };
    },
    'triggers.list': () => triggersState(),
    'triggers.save': ({ trigger: input }) => {
      if (input.id && !triggers.get(input.id)) throw new RpcError('NOT_FOUND', 'That trigger was deleted');
      const problem = triggerProblem({ ...input, draft: input.draft ?? {} });
      if (problem) throw new RpcError('INVALID', problem);
      // A trigger belongs to a project, and lives on its Triggers tab: a folder that isn't one yet (Start when… in
      // New session on any folder) becomes one.
      if (!input.id && !projects.addedRoots().includes(input.projectRoot) && !questions.contains(input.projectRoot)) projects.add(input.projectRoot);
      const trigger = triggers.save(input);
      triggersBroadcast();
      // Its first look marks what is there as seen: at once, so new events count from now.
      if (!trigger.paused) void triggerWatcher?.checkNow(trigger.id);
      return { trigger };
    },
    'triggers.delete': ({ id }) => {
      const trigger = triggers.get(id);
      const events = triggers.eventsOf(id).map((s) => s.event);
      triggers.remove(id);
      triggersBroadcast();
      return { trigger, events };
    },
    'triggers.restore': ({ trigger: input, events }) => {
      const trigger = triggers.restore(input, events.map((event) => ({ event, context: null })));
      triggersBroadcast();
      if (!trigger.paused) void triggerWatcher?.checkNow(trigger.id);
      return { trigger };
    },
    'triggers.setPaused': ({ id, paused }) => {
      const trigger = triggers.setPaused(id, paused);
      if (!trigger) throw new RpcError('NOT_FOUND', 'That trigger was deleted');
      triggersBroadcast();
      if (!paused) void triggerWatcher?.checkNow(id);
      return { trigger };
    },
    'triggers.checkNow': async ({ id }) => {
      const before = triggers.get(id);
      if (!before) throw new RpcError('NOT_FOUND', 'That trigger was deleted');
      if (before.paused) throw new RpcError('INVALID', 'Resume the trigger first');
      const known = new Set(triggers.eventsOf(id).map((e) => e.event.id));
      await triggerWatcher?.checkNow(id);
      const found = triggers.eventsOf(id).filter((e) => !known.has(e.event.id)).length;
      return { trigger: triggers.get(id) ?? before, found };
    },
    'triggers.startEvent': async ({ eventId }) => {
      if (!triggers.event(eventId)) throw new RpcError('NOT_FOUND', 'That event is gone');
      return { event: (await triggerWatcher?.startEvent(eventId)) ?? null };
    },
    'triggers.repoInfo': ({ root }) => triggerRepoInfo(root),
    // --- Pipelines (#179) -------------------------------------------------------------------------------------------
    'pipelines.list': ({ root }) => ({ pipelines: root ? pipelineStore.forProject(root) : pipelineStore.list() }),
    'pipelines.save': ({ pipeline }) => {
      if (pipeline.id && isBuiltInPipeline(pipeline.id)) throw new RpcError('READ_ONLY', 'Built-in pipelines can’t be changed. Duplicate one to start.');
      if (pipeline.id && !pipelineStore.get(pipeline.id)) throw new RpcError('NOT_FOUND', 'That pipeline was deleted');
      const saved = pipelineStore.save(pipeline);
      pipelinesBroadcast();
      return { pipeline: saved };
    },
    'pipelines.delete': ({ id }) => {
      if (isBuiltInPipeline(id)) throw new RpcError('READ_ONLY', 'Built-in pipelines can’t be deleted.');
      const pipeline = pipelineStore.remove(id);
      pipelinesBroadcast();
      return { pipeline };
    },
    'pipelines.restore': ({ pipeline }) => {
      pipelineStore.restore(pipeline);
      pipelinesBroadcast();
      return { pipeline: pipelineStore.get(pipeline.id) ?? pipeline };
    },
    'pipelines.run': async ({ pipelineId, parentSessionId, task, attachments, project, profileId, choices }) => {
      if (parentSessionId && isRunId(parentSessionId)) throw new RpcError('INVALID', 'Run a pipeline from a session.');
      if (!parentSessionId && project && !statSafe(project)?.isDirectory()) throw new RpcError('NOT_FOUND', `Folder not found: ${project}`);
      try {
        const state = await runner!.start({ pipelineId, parentSessionId, task, attachments, ...(project ? { projectRoot: resolver.resolve(project).root ?? project } : {}), profileId, choices });
        return { state };
      } catch (error) {
        throw new RpcError('PIPELINE_FAILED', (error as Error).message);
      }
    },
    'runs.list': () => ({ runs: runner!.list() }),
    'runs.get': ({ runId }) => ({ state: runner!.state(runId) }),
    'runs.continue': async ({ runId, message }) => ({ state: await runAction(() => runner!.continue(runId, message ?? undefined)) }),
    'runs.retryStep': async ({ runId }) => ({ state: await runAction(() => runner!.retryStep(runId)) }),
    'runs.skipStep': async ({ runId }) => ({ state: await runAction(() => runner!.skipStep(runId)) }),
    'runs.stop': async ({ runId }) => ({ state: await runAction(() => runner!.stop(runId)) }),
    'runs.archive': async ({ runId, archived }) => ({ runs: await runAction(async () => runner!.archive(runId, archived)) }),
    'runs.delete': async ({ runId, keepSubSessions }) => {
      await runAction(() => runner!.delete(runId, keepSubSessions));
      return {};
    },
    'runs.pushPreview': async ({ runId, fresh }) => ({ preview: await runAction(() => runner!.pushPreview(runId, fresh)) }),
    'runs.write': async ({ runId, text }) => {
      const state = runner!.state(runId);
      if (!state) throw new RpcError('NOT_FOUND', 'That run is gone');
      if (state.run.parentSessionId) throw new RpcError('INVALID', 'This run has a session already');
      const { run } = state;
      // The brief of the run first, so Claude knows what the steps did.
      const prompt = `${text.trim()}\n\n${writeRunStub(run.pipeline.name, run.id)}`;
      const profileId = requireProfile(run.profileId && profiles.has(run.profileId) ? run.profileId : folderProfile(run.cwd));
      const sessionId = await hosts.create({ cwd: run.cwd, prompt, attachments: [], model: null, effort: null, permissionMode: 'default', worktree: null, profileId });
      runner!.adopt(runId, sessionId);
      pendingTitles.set(sessionId, run.title);
      applyTitles([sessionId]);
      return { sessionId };
    },
    'search.query': async ({ query, limit, scope, only, memoryTypes, memoryScope }) => {
      if (only !== 'conversations') syncMemorySearch(1_000);
      return {
        hits: only === 'memory' ? [] : search.search(query, limit, scope === 'switchboard' ? sessions.snapshot().sessions.filter((s) => s.inApp).map((s) => s.id) : undefined),
        memories: only === 'conversations' ? [] : memorySearch.search(query, { types: memoryTypes, scope: memoryScope }),
        indexing: { ...search.progress },
      };
    },
    'memory.bySession': ({ sessionId }) => {
      syncMemorySearch(10_000);
      return { memories: memorySearch.bySession(sessionId) };
    },
    'git.changes': async ({ cwd, base }) => {
      try {
        return await listChanges(cwd, base);
      } catch (error) {
        throw new RpcError('GIT_FAILED', (error as Error).message);
      }
    },
    'git.diff': async ({ cwd, base, path }) => {
      try {
        return await fileDiff(cwd, base, path);
      } catch (error) {
        throw new RpcError('GIT_FAILED', (error as Error).message);
      }
    },
    'git.branches': async ({ cwd }) => {
      if (!resolver.resolve(cwd).gitDir) return { current: null, branches: [], remoteBranches: [] };
      try {
        const [local, remoteBranches] = await Promise.all([listBranches(cwd), listRemoteBranches(cwd)]);
        return { ...local, remoteBranches };
      } catch (error) {
        throw new RpcError('GIT_FAILED', (error as Error).message);
      }
    },
    'git.switch': async ({ cwd, branch }) => {
      if (!resolver.resolve(cwd).gitDir) throw new RpcError('NOT_A_REPO', 'Not a git repository');
      await assertCheckoutIdle(cwd);
      try {
        await switchBranch(cwd, branch);
        return { current: (await listBranches(cwd)).current };
      } catch (error) {
        throw new RpcError('GIT_FAILED', (error as Error).message);
      }
    },
    'git.github': async ({ cwd }) => (resolver.resolve(cwd).gitDir ? githubPage(cwd) : null),
    'git.stage': async ({ cwd, paths, staged }) => {
      try {
        await stage(cwd, paths, staged);
      } catch (error) {
        throw new RpcError('GIT_FAILED', (error as Error).message);
      }
      return {};
    },
    'git.revert': async ({ cwd, paths }) => {
      try {
        const { root, untracked } = await revert(cwd, paths);
        if (untracked.length) await trash(untracked, { repoRoot: root });
      } catch (error) {
        throw new RpcError('GIT_FAILED', (error as Error).message);
      }
      return {};
    },
    'git.sync': async ({ sessionId, cwd, action }) => {
      if (!resolver.resolve(cwd).gitDir) throw new RpcError('NOT_A_REPO', 'Not a git repository');
      const status = await worktreeStatus(cwd).catch((error: Error) => {
        throw new RpcError('GIT_FAILED', error.message);
      });
      // A fork's pull request Switchboard can't push to: nothing goes back from here (the header has push off too).
      if (action === 'push' && (githubOrigins.get(sessionId)?.readOnly || githubOrigins.readOnlyAt(status.path, status.branch))) throw new RpcError('READ_ONLY', FORK_READ_ONLY);
      const sync = syncCommand(status, action, (await terminals.shell()).quote);
      if ('code' in sync) throw new RpcError(sync.code, sync.message);
      if (action === 'pull') await assertCheckoutIdle(cwd);
      const title = action === 'fetch' ? 'Fetch' : action === 'pull' ? 'Pull' : 'Push';
      return { terminalId: await runShellAction(sessionId, status.path, title, sync.command) };
    },
    'git.update': async ({ cwd, action }) => {
      if (!resolver.resolve(cwd).gitDir) throw new RpcError('NOT_A_REPO', 'Not a git repository');
      const status = await worktreeStatus(cwd).catch((error: Error) => {
        throw new RpcError('GIT_FAILED', error.message);
      });
      const sync = syncCommand(status, action, (await terminals.shell()).quote);
      if ('code' in sync) throw new RpcError(sync.code, sync.message);
      if (action === 'pull') await assertCheckoutIdle(cwd);
      try {
        await updateCheckout(status.path, action, (await shell.ready).env);
        return await worktreeStatus(cwd);
      } catch (error) {
        throw new RpcError(error instanceof DivergedError ? 'DIVERGED' : 'GIT_FAILED', (error as Error).message);
      }
    },
    'git.commit': async ({ sessionId, cwd, message }) => {
      if (!resolver.resolve(cwd).gitDir) throw new RpcError('NOT_A_REPO', 'Not a git repository');
      await assertCheckoutIdle(cwd);
      const files = await stageForCommit(cwd).catch((error: Error) => {
        throw new RpcError('GIT_FAILED', error.message);
      });
      if (files === 0) throw new RpcError('NOTHING_TO_COMMIT', 'There is nothing to commit.');
      // In a terminal tab: commit hooks can take a while, and their output is worth seeing.
      return { terminalId: await runShellAction(sessionId, cwd, 'Commit', `git commit -m ${(await terminals.shell()).quote(message)}`) };
    },
    'git.commitMessage': async ({ sessionId, cwd }) => {
      if (!resolver.resolve(cwd).gitDir) throw new RpcError('NOT_A_REPO', 'Not a git repository');
      const context = await commitContext(cwd).catch((error: Error) => {
        throw new RpcError('GIT_FAILED', error.message);
      });
      if (!context) throw new RpcError('NOTHING_TO_COMMIT', 'There is nothing to commit.');
      const message = parseCommitMessage(await commitWriter.ask(sessionProfile(sessionId), sessionId, commitMessageInput(context), COMMIT_SYSTEM_PROMPT));
      if (!message) throw new RpcError('NO_MESSAGE', "Claude didn't write a commit message in time. Try again, or use Commit… to write one.");
      return { message };
    },
    'git.prDraft': async ({ cwd, base, projectBase }) => {
      if (!resolver.resolve(cwd).gitDir) throw new RpcError('NOT_A_REPO', 'Not a git repository');
      const status = await worktreeStatus(cwd).catch((error: Error) => {
        throw new RpcError('GIT_FAILED', error.message);
      });
      const refused = draftRefusal(status);
      if (refused) throw new RpcError(refused.code, refused.message);
      const { env } = await shell.ready;
      // gh (the pull request list and the sign-in check) at the same time as git.
      const prs = pullRequestsFor(status.root, false);
      const draft = await readPrDraft(status, { base, projectBase }).catch((error: Error) => {
        throw new RpcError('GIT_FAILED', error.message);
      });
      const host = parseRemoteUrl((await git(status.path, ['remote', 'get-url', draft.remote]).catch(() => '')).trim())?.host ?? 'github.com';
      const [gh, existing] = await Promise.all([ghStatus(defaultGh(), status.path, env, host), prs]);
      return { ...draft, existingPr: prOf(existing, status.branch), gh };
    },
    'git.prCreate': async ({ jobId, cwd, title, body, base, draft, web }) => {
      if (!resolver.resolve(cwd).gitDir) throw new RpcError('NOT_A_REPO', 'Not a git repository');
      const status = await worktreeStatus(cwd).catch((error: Error) => {
        throw new RpcError('GIT_FAILED', error.message);
      });
      if (githubOrigins.readOnlyAt(status.path, status.branch)) throw new RpcError('READ_ONLY', FORK_READ_ONLY);
      if (prJobs.has(status.path)) throw new RpcError('BUSY', 'A pull request is being created here already.');
      prJobs.add(status.path);
      const progress = (step: PrProgress['step'], rest: Partial<Pick<PrProgress, 'pr' | 'compareUrl' | 'error'>> = {}) =>
        broadcast('git.pr', { jobId, cwd, step, pr: null, compareUrl: null, error: null, ...rest });
      // Pushing can take minutes (pre-push hooks): the call returns now, and the job reports through `git.pr`.
      void (async () => {
        try {
          const result = await createPullRequest(status, { title, body, base, draft, web }, { env: (await shell.ready).env, gh: defaultGh(), onStep: (step) => progress(step) });
          if ('pr' in result) {
            log('info', `git: created pull request #${result.pr.number} for ${status.branch}`);
            progress('done', { pr: result.pr });
            // The button and the overviews show it from now on.
            void pullRequestsFor(status.root, true);
          } else progress('done', { compareUrl: result.compareUrl });
        } catch (error) {
          const prError: PrError = error instanceof PrFailure ? error.error : { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error), output: null, pr: null };
          progress('failed', { error: prError });
        } finally {
          prJobs.delete(status.path);
        }
      })();
      return {};
    },
    'git.prFor': async ({ cwd, fresh }) => {
      if (!resolver.resolve(cwd).gitDir) return { pr: null };
      const status = await worktreeStatus(cwd).catch(() => null);
      if (!status?.branch) return { pr: null };
      return { pr: prOf(await pullRequestsFor(status.root, fresh), status.branch) };
    },
    'git.prChecks': async ({ cwd, sessionId, fresh, afterPush }) => {
      if (!resolver.resolve(cwd).gitDir) return { checks: null };
      const status = await worktreeStatus(cwd).catch(() => null);
      if (!status?.branch) return { checks: null };
      return { checks: await checksWatcher.get(status.path, { sessionId, fresh, afterPush }) };
    },
    'git.prCheckLogs': async ({ cwd, checks }) => {
      if (!resolver.resolve(cwd).gitDir) throw new RpcError('NOT_A_REPO', 'Not a git repository');
      return { logs: await readCheckLogs(defaultGh(), cwd, (await shell.ready).env, checks) };
    },
    'git.prReady': async ({ cwd, number }) => {
      const result = await runGh(defaultGh(), ['pr', 'ready', String(number)], { cwd, env: (await shell.ready).env, timeout: 60_000 });
      if (result.missing) throw new RpcError('GH_MISSING', "GitHub CLI isn't installed.");
      if (result.code !== 0) throw new RpcError('GH_FAILED', firstUsefulLine(`${result.stderr}\n${result.stdout}`) || 'gh could not mark it ready.');
      const status = await worktreeStatus(cwd).catch(() => null);
      if (status) void pullRequestsFor(status.root, true);
      return {};
    },
    // Not about any checkout: gh runs in the home folder.
    'github.starStatus': async () => ({ status: await githubStarStatus(defaultGh(), homedir(), (await shell.ready).env) }),
    'github.star': async () => {
      try {
        await starSwitchboard(defaultGh(), homedir(), (await shell.ready).env);
      } catch (error) {
        if (error instanceof StarFailure) throw new RpcError(error.code, error.message);
        throw error;
      }
      log('info', 'github: starred Switchboard');
      return {};
    },
    'worktree.status': async ({ cwd }) => {
      try {
        return await worktreeStatus(cwd);
      } catch (error) {
        throw new RpcError('GIT_FAILED', (error as Error).message);
      }
    },
    'worktree.finish': async ({ sessionId, cwd, action, deleteBranch }) => {
      const status = await worktreeStatus(cwd).catch((error: Error) => {
        throw new RpcError('GIT_FAILED', error.message);
      });
      if (!status.isWorktree || !status.branch) throw new RpcError('NOT_A_WORKTREE', 'This session is not in a worktree');
      const branch = (await terminals.shell()).quote(status.branch);
      if (action === 'merge') {
        if (status.uncommitted > 0) throw new RpcError('UNCOMMITTED', 'Commit or revert the uncommitted changes first; a merge only takes commits.');
        if (!status.baseBranch || status.mainCheckout.branch !== status.baseBranch) {
          throw new RpcError('WRONG_BRANCH', `The main checkout is on ${status.mainCheckout.branch ?? 'a detached HEAD'}, not ${status.baseBranch ?? 'the base branch'}.`);
        }
        if (status.mainCheckout.dirty) throw new RpcError('MAIN_DIRTY', 'The main checkout has uncommitted changes. Commit or stash them there first.');
        // The merge changes the main checkout's files, under any session working there.
        await assertCheckoutIdle(status.root);
        return { terminalId: await runShellAction(sessionId, status.root, `Merge ${status.branch}`, `git merge --no-edit ${branch}`) };
      }
      if (status.uncommitted > 0) throw new RpcError('UNCOMMITTED', 'The worktree has uncommitted changes. Commit or revert them first.');
      // Removing the folder pulls it from under every session in it; this session is stopped first, any other has to be idle.
      await assertCheckoutIdle(status.path, sessionId);
      await hosts.release(sessionId);
      try {
        await removeWorktree(status, deleteBranch);
      } catch (error) {
        throw new RpcError('GIT_FAILED', (error as Error).message);
      }
      return { terminalId: null };
    },
    'worktrees.list': async ({ root, fetch }) => {
      if (!resolver.resolve(root).gitDir) throw new RpcError('NOT_A_REPO', 'Not a git repository');
      if (fetch) {
        // Merged and pushed are only as current as the last fetch. Offline or signed out, the list still comes.
        await updateCheckout(root, 'fetch', (await shell.ready).env).catch((error: Error) => log('warn', `worktrees: fetch in ${root} failed: ${error.message}`));
      }
      // gh and git at the same time; the pull requests are matched to branches afterwards.
      const pullRequests = pullRequestsFor(root, fetch);
      const list = await listWorktrees(root, { sessions: sessionPlaces() }).catch((error: Error) => {
        throw new RpcError('GIT_FAILED', error.message);
      });
      const prs = await pullRequests;
      if (!prs) return list;
      return { ...list, pullRequests: true, worktrees: list.worktrees.map((w) => (w.branch && !w.isMain ? { ...w, pr: prs.get(w.branch) ?? null } : w)) };
    },
    'worktrees.size': async ({ paths, refresh }) => {
      const known: WorktreeSize[] = [];
      for (const path of paths) {
        const size = worktreeSizes.get(path);
        if (size) known.push(size);
        if ((!size || refresh) && !sizeQueue.includes(path) && existsSync(path)) sizeQueue.push(path);
      }
      measureNext();
      return { sizes: known };
    },
    'worktrees.remove': async ({ root, items }) => {
      if (!resolver.resolve(root).gitDir) throw new RpcError('NOT_A_REPO', 'Not a git repository');
      const results = await removeWorktrees(root, items, {
        activity: sessionActivity,
        release: async (ids) => {
          for (const id of ids) await hosts.release(id);
        },
      });
      for (const result of results) if (result.removed) worktreeSizes.delete(result.path);
      for (const result of results) {
        if (result.ok) log('info', `worktrees: removed ${result.path}${result.branchDeleted ? ' and its branch' : ''}${result.recoveryRef ? ` (kept ${result.recoveryRef})` : ''}`);
      }
      return { results };
    },
    'worktrees.push': async ({ path }) => {
      if (!existsSync(path) || !resolver.resolve(path).gitDir) throw new RpcError('NOT_A_REPO', 'Not a git repository');
      const status = await worktreeStatus(path).catch((error: Error) => {
        throw new RpcError('GIT_FAILED', error.message);
      });
      const sync = syncCommand(status, 'push', (await terminals.shell()).quote);
      if ('code' in sync) throw new RpcError(sync.code, sync.message);
      const args = status.upstream ? ['push', '--quiet'] : ['push', '--quiet', '-u', status.pushRemote!, status.branch!];
      try {
        await git(status.path, args, { env: { ...(await shell.ready).env, GIT_TERMINAL_PROMPT: '0' }, timeout: 120_000 });
      } catch (error) {
        throw new RpcError('GIT_FAILED', (error as Error).message);
      }
      return {};
    },
    'worktrees.ignoredFiles': async ({ path }) => {
      if (!existsSync(path)) return { files: [], total: 0 };
      try {
        return await ignoredFiles(path);
      } catch (error) {
        throw new RpcError('GIT_FAILED', (error as Error).message);
      }
    },
    'branches.list': async ({ root, fetch }) => {
      if (!resolver.resolve(root).gitDir) throw new RpcError('NOT_A_REPO', 'Not a git repository');
      if (fetch) {
        // Gone and merged are only as current as the last fetch. Offline or signed out, the list still comes.
        await fetchAllRemotes(root, (await shell.ready).env).catch((error: Error) => log('warn', `branches: fetch in ${root} failed: ${error.message}`));
      }
      const pullRequests = await pullRequestsFor(root, fetch);
      try {
        return await listBranchOverview(root, { pullRequests });
      } catch (error) {
        throw new RpcError('GIT_FAILED', (error as Error).message);
      }
    },
    'branches.delete': async ({ root, items }) => {
      if (!resolver.resolve(root).gitDir) throw new RpcError('NOT_A_REPO', 'Not a git repository');
      // Deleting a branch on GitHub closes its open pull request: refuse those, as far as gh can tell.
      const prs = await pullRequestsFor(root, false);
      const results = await deleteBranches(root, items, {
        env: (await shell.ready).env,
        openPullRequest: (name) => {
          const pr = prs?.get(name);
          return pr?.state === 'open' ? pr : null;
        },
      }).catch((error: Error) => {
        throw new RpcError('GIT_FAILED', error.message);
      });
      for (const result of results) {
        if (result.ok) log('info', `branches: deleted ${result.name}${result.localDeleted ? ' here' : ''}${result.localDeleted && result.remoteDeleted ? ' and' : ''}${result.remoteDeleted ? ' on the remote' : ''}${result.recoveryRef ? ` (kept ${result.recoveryRef})` : ''}`);
      }
      return { results };
    },
    'terminal.open': async (params) => {
      if (params.kind === 'claude' && params.sessionId && !params.fork) {
        if (hosts.has(params.sessionId)) {
          throw new RpcError('SESSION_RUNNING_HERE', 'This session is running in Switchboard. Stop it there first, or open a fork in the terminal.');
        }
        if (liveList().some((l) => l.sessionId === params.sessionId)) {
          throw new RpcError('SESSION_BUSY_ELSEWHERE', 'This session is open in another Claude Code window. Close it there first, or open a fork.');
        }
      }
      const cwd = params.cwd ?? homedir();
      const profileId = params.profileId ? requireProfile(params.profileId) : (params.sessionId ? sessionProfile(params.sessionId) : folderProfile(cwd));
      if (questions.contains(cwd)) questions.ensure();
      try {
        return await terminals.open({ ...params, cwd, env: profileEnv(profileId) });
      } catch (error) {
        throw new RpcError('TERMINAL_FAILED', (error as Error).message);
      }
    },
    'terminal.run': async ({ sessionId, cwd, command, sendOutput }) => {
      const firstLine = command.split('\n')[0]!.trim();
      const title = firstLine.length > 40 ? `${firstLine.slice(0, 39)}…` : firstLine;
      try {
        const info = await terminals.open({ sessionId, cwd, kind: 'action', command, title, cols: 100, rows: 20, fork: false, env: profileEnv(sessionProfile(sessionId)) });
        if (sendOutput) runReports.set(info.id, { sessionId, command });
        return info;
      } catch (error) {
        throw new RpcError('TERMINAL_FAILED', (error as Error).message);
      }
    },
    'terminal.list': () => ({ terminals: terminals.list() }),
    'terminal.font': () => {
      const font = detectTerminalFont();
      const fontFamilies = font?.fontFamilies ?? [];
      // `fontFamily` (the first name) is for an older window that talks to this engine from another computer.
      return { fontFamily: fontFamilies[0] ?? null, fontFamilies, source: font?.source ?? null };
    },
    'terminal.attach': ({ id }, context) => {
      const result = terminals.replay(id);
      viewTerminal(id, context, true);
      return result;
    },
    'terminal.detach': ({ id }, context) => {
      viewTerminal(id, context, false);
      return {};
    },
    'terminal.write': async ({ id, data, whenReady }) => {
      if (whenReady) await terminals.whenReady(id);
      terminals.write(id, data);
      return {};
    },
    'terminal.resize': ({ id, cols, rows }) => {
      terminals.resize(id, cols, rows);
      return {};
    },
    'terminal.close': ({ id }) => {
      terminals.close(id);
      terminalViewers.delete(id);
      actionRuns.delete(id);
      runReports.delete(id);
      return {};
    },
    'terminal.stop': ({ id }) => {
      terminals.stop(id);
      return {};
    },
    'memory.list': ({ root }) => {
      memoryWatcher.watch(root, memory.dirs(root));
      return memory.list(root);
    },
    'memory.personal': () => {
      const personal = memory.personal();
      memoryWatcher.watch(null, [personal.dir]);
      return personal;
    },
    'memory.setPersonalDir': ({ path }) => {
      const personal = memory.setPersonalDir(path);
      memoryWatcher.watch(null, [personal.dir]);
      log('info', `Personal memory folder is now ${path}`);
      broadcast('memory.changed', { root: null });
      return personal;
    },
    'memory.blockPreview': () => ({ line: memory.blockText(), profiles: memory.blockPreview() }),
    'memory.installBlock': () => {
      memory.installBlock();
      log('info', 'Added the personal memory block to CLAUDE.md');
      broadcast('memory.changed', { root: null });
      return memory.personal();
    },
    'memory.removeBlock': () => {
      memory.removeBlock();
      log('info', 'Removed the personal memory block from CLAUDE.md');
      broadcast('memory.changed', { root: null });
      return memory.personal();
    },
    'memory.move': async (params) => {
      const result = await memory.move(params);
      broadcast('memory.changed', { root: params.root });
      broadcast('memory.changed', { root: null });
      return result;
    },
    'memory.resolveConflict': async (params) => {
      const result = await memory.resolveConflict(params);
      broadcast('memory.changed', { root: params.root });
      return result;
    },
    'memory.copyToProfile': (params) => {
      const result = memory.copyToProfile(params);
      broadcast('memory.changed', { root: params.root });
      return result;
    },
    'memory.writeInstruction': async (params) => {
      const result = await memory.writeInstruction(params);
      broadcast('memory.changed', { root: params.root });
      return result;
    },
    'memory.overview': () => ({ projects: memory.overview(memoryProjects().map((p) => p.root)) }),
    'memory.importExportPreview': ({ paths }) => {
      const parsed = readExport(paths);
      log('info', `Read ${parsed.files.length} memories from a Claude export (conversations are never read)`);
      return memory.planImport(candidatesOf(parsed), memoryProjects(), parsed.projects);
    },
    'memory.importPastePreview': ({ text }) => memory.planImport(candidatesFromPaste(text), memoryProjects()),
    'memory.import': ({ token, picks }) => {
      const result = memory.applyImport(token, picks, memoryProjects().map((p) => p.root));
      log('info', `Imported memory: ${result.created} new, ${result.updated} updated`);
      broadcast('memory.changed', { root: null });
      for (const root of new Set(picks.map((p) => p.target).filter((t) => isLocalAbsolutePath(t, process.platform)))) broadcast('memory.changed', { root });
      return result;
    },
    'memory.exportCandidates': () => ({ memories: memory.exportCandidates(memoryProjects()) }),
    'memory.exportText': ({ paths }) => ({ text: memory.exportText(paths, memoryProjects().map((p) => p.root)) }),
    'memory.read': ({ root, path }) => ({ content: memory.read(root, path), modified: statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0 }),
    'memory.loadOrder': ({ root, profileId }) => memory.loadOrder(root, profileId),
    'memory.create': (params) => {
      const result = memory.create(params);
      broadcast('memory.changed', { root: params.root });
      return result;
    },
    'memory.write': (params) => {
      const result = memory.write(params);
      broadcast('memory.changed', { root: params.root });
      return result;
    },
    'memory.rename': (params) => {
      const result = memory.rename(params);
      broadcast('memory.changed', { root: params.root });
      // A link in a personal memory may have been updated too.
      if (result.updatedLinks.length && params.root !== null) broadcast('memory.changed', { root: null });
      return result;
    },
    'memory.links': ({ root }) => ({ links: memory.links(root) }),
    'memory.checkSecrets': ({ text }) => ({ found: findSecrets(text) }),
    'memory.health': async ({ root }) => ({ findings: await memory.health(root) }),
    'memory.fixIndexPreview': ({ root, indexPath }) => ({ diff: memory.fixIndexPreview(root, indexPath).diff }),
    'memory.fixIndex': ({ root, indexPath }) => {
      memory.fixIndex(root, indexPath);
      broadcast('memory.changed', { root });
      return {};
    },
    'memory.remove': async (params) => {
      const result = await memory.remove(params);
      log('info', `Moved memory ${params.path} to the Trash`);
      broadcast('memory.changed', { root: params.root });
      return result;
    },
    'memory.restore': ({ undoToken }) => {
      const result = memory.restore(undoToken);
      broadcast('memory.changed', { root: null });
      return result;
    },
    'memory.sharePreview': (params) => memory.sharePreview(params),
    'memory.share': async (params) => {
      const result = await memory.share(params);
      log('info', `Shared ${params.memoryPath} into ${result.targetPath}${result.removed ? ' (memory moved to the Trash)' : ''}`);
      broadcast('memory.changed', { root: params.root });
      return result;
    },
    'memory.undoShare': async ({ undoToken }) => {
      broadcast('memory.changed', { root: await memory.undoShare(undoToken) });
      return {};
    },
    'memory.ignoreLocal': ({ root }) => {
      const path = memory.ignoreLocal(root);
      broadcast('memory.changed', { root });
      return { path };
    },
    'memory.createFromSection': async (params) => {
      const result = await memory.createFromSection(params);
      if (!params.dryRun) broadcast('memory.changed', { root: params.root });
      return result;
    },
    'companion.focus': ({ sessionId, scope }, context) => {
      sidebarScope = scope;
      companion?.focus(context, sessionId, scope);
      return {};
    },
    'companion.received': ({ deliveryId, error }) => {
      companion?.received(deliveryId, error);
      return {};
    },
    'companion.status': () => companion?.status() ?? { listening: false, clients: 0, error: null },
    'catchup.get': ({ sessionId }) => ({ catchUp: catchUp.get(sessionId) }),
    'catchup.list': () => ({ catchUps: catchUp.list() }),
    'catchup.build': async ({ sessionId }) => {
      scanLive();
      const host = hosts.list().hosts.find((h) => h.sessionId === sessionId);
      const busy = host ? host.state === 'running' || host.state === 'starting' : liveList().some((l) => l.sessionId === sessionId && l.status === 'running');
      if (busy) throw new RpcError('SESSION_BUSY', 'Claude is still working in this session.');
      const card = await catchUp.build(sessionId);
      if (!card) throw new RpcError('NOT_FOUND', 'This session has no finished turn to catch up on.');
      return { catchUp: card };
    },
    'catchup.why': async ({ sessionId, requestId }) => {
      const why = await catchUp.why(sessionId, requestId);
      if (!why) throw new RpcError('NOT_FOUND', 'This request was already answered.');
      return { why };
    },
    'remote.status': () => requireRemote().status(),
    'remote.configure': (change) => requireRemote().configure(change),
    'remote.pair.start': () => requireRemote().startPairing(),
    'remote.connectLink': () => requireRemote().connectLink(),
    'remote.pair.cancel': () => {
      remote?.cancelPairing();
      return {};
    },
    'remote.pair.decide': ({ requestId, allow }) => {
      requireRemote().decidePairing(requestId, allow);
      return {};
    },
    'remote.revoke': ({ deviceId }) => {
      requireRemote().revoke(deviceId);
      return {};
    },
    'remote.rename': ({ deviceId, name }) => {
      requireRemote().rename(deviceId, name);
      return {};
    },
    'computers.status': () => computers?.status() ?? { available: false, computers: [], pairing: null },
    'computers.add': async ({ link }) => {
      await requireComputers().add(link);
      return {};
    },
    'computers.cancelPairing': () => {
      computers?.cancelPairing();
      return {};
    },
    'computers.forget': ({ id }) => {
      requireComputers().forget(id);
      return {};
    },
    'computers.retry': ({ id }) => {
      requireComputers().retry(id);
      return {};
    },
    'computers.call': async ({ computerId, method, params }) => (await requireComputers().call(computerId, method, params)) as JsonValue,
    'claudeUpdate.get': () => claudeUpdater.state,
    'claudeUpdate.check': () => {
      void claudeUpdater.check();
      return {};
    },
    'claudeUpdate.update': () => {
      // A refusal (busy, can't run it) throws here and answers the request; the update reports through claudeUpdate.changed.
      claudeUpdater.update().catch((error: Error) => log('error', `Claude Code update failed: ${error.message}`));
      return {};
    },
    'settings.export': ({ path, sections, preferences, themes, appVersion }) => {
      writeSettingsFile(path, exportSettings(settingsStores, { sections, preferences, themes, appVersion }));
      log('info', `Exported settings (${sections.join(', ')}) to ${path}`);
      return { path };
    },
    'settings.import': ({ path, sections, mode, relocate, preferences, themes, appVersion, apply }) => {
      const plan = planImport(settingsStores, readSettingsFile(path), { sections, mode, relocate, preferences, themes });
      if (!apply) return { preview: plan.preview, backupPath: null, preferences: null, themes: [] };
      // Everything as it is now, so the import can be undone by importing this file with Replace.
      const backupPath = writeBackup(join(options.dataDir, 'backups'), exportSettings(settingsStores, { sections: BACKUP_SECTIONS, preferences, themes, appVersion }));
      const result = plan.apply();
      // Owned and continued sessions and session flags are also held in memory.
      for (const { id } of cache.db.prepare('SELECT id FROM owned_sessions').all() as Array<{ id: string }>) owned.add(id);
      for (const { id } of cache.db.prepare('SELECT id FROM continued_sessions').all() as Array<{ id: string }>) continued.add(id);
      sessions.reloadFlags();
      schedulesBroadcast();
      scheduler.rearm();
      triggersBroadcast();
      broadcast('settings.imported', {});
      log('info', `Imported settings from ${path} (${mode}); backup at ${backupPath}`);
      return { preview: plan.preview, backupPath, preferences: result.preferences, themes: result.themes };
    },
    'claudeUpdate.dismiss': () => {
      claudeUpdater.dismiss();
      return {};
    },
    'claudeUpdate.setEnabled': ({ enabled }) => {
      claudeUpdater.setEnabled(enabled);
      return {};
    },
    'terminal.restart': async ({ id }) => {
      // An action is looked up again: it may have been edited, deleted or lost its approval since.
      const run = actionRuns.get(id);
      let change: { command?: string; cwd?: string } = {};
      if (run) {
        const action = findAction(run.projectRoot, run.id);
        if (action.type !== 'shell') throw new RpcError('NOT_FOUND', `"${action.name}" no longer runs in a terminal`);
        change = {
          command: expandCommand(action.command, actionVars(run.sessionId, run.projectRoot, run.cwd), await terminals.shell()),
          cwd: action.cwd === 'project-root' ? run.projectRoot : run.cwd,
        };
        // Its switch may have changed since, too.
        if (action.sendOutput) runReports.set(id, { sessionId: run.sessionId, command: change.command!, action: action.name });
        else runReports.delete(id);
      }
      try {
        return await terminals.restart(id, change);
      } catch (error) {
        throw new RpcError('TERMINAL_FAILED', (error as Error).message);
      }
    },
  };

  return {
    attach(transport) {
      const server = serveRpc(contract, transport, handlers, {
        onUnexpectedError: (method, error) =>
          log('error', `${method} failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`),
      });
      servers.add(server);
      return () => {
        servers.delete(server);
        server.dispose();
      };
    },
    log,
    setRetention,
    setAutoModel: (prefs) => {
      autoModel = prefs;
    },
    setCatchUpSummaries: (enabled) => {
      catchUpSummaries = enabled;
    },
    setResumeAtLimit: (mode) => {
      resumeAtLimit = mode;
    },
    smokeQueueHost: standInHost,
    smokePipelineTurn: async ({ sessionId, outcome, reply }) => {
      if (!options.stubQueueStarts) return;
      smokeReplies.set(sessionId, reply);
      const cwd = smokeHosts.get(sessionId)?.cwd ?? options.dataDir;
      standInHost({ sessionId, cwd, state: 'idle' });
      await runner?.turnEnded(sessionId, outcome, null);
    },
    wake: () => scheduler.wake(),
    advanceScheduleClock: (ms) => {
      if (!options.stubQueueStarts) return;
      scheduleClockOffset += ms;
      scheduler.rearm();
    },
    setQueueFocus: (focus) => {
      queueFocus = focus;
      void autoStarter?.check();
    },
    setShowMods: (enabled) => hosts.setShowMods(enabled),
    setChrome: (enabled) => hosts.setChrome(enabled),
    setAppIcon: (key) => remote?.setAppIcon(key),
    setForeground: (foreground) => checksWatcher.setForeground(foreground),
    startModsSmoke: async () => {
      const spec = JSON.parse(process.env.SWITCHBOARD_SMOKE_MODS ?? 'null') as { pluginDir: string; configDir: string; cwd: string; out: string; prompt?: string; profileName?: string } | null;
      if (!spec) return;
      const write = (result: Record<string, unknown>) => writeFileSync(spec.out, JSON.stringify(result));
      try {
        const profileId = profiles.add(spec.profileName ?? 'Smoke mods', 'gray', spec.configDir);
        smokePluginDirs.set(profileId, spec.pluginDir);
        const sessionId = await hosts.create({ cwd: spec.cwd, profileId, prompt: spec.prompt ?? '/smoke-ping', attachments: [], model: null, permissionMode: 'default', effort: null, worktree: null });
        // Claude Code says whether it draws mods once it has started.
        const deadline = Date.now() + 30_000;
        let supported = false;
        while (Date.now() < deadline) {
          const state = hosts.modsSnapshots().find((s) => s.state.sessionId === sessionId)?.state;
          if (state?.attached || (state && hosts.list().hosts.find((h) => h.sessionId === sessionId)?.state === 'idle')) {
            supported = state.supported;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        write({ sessionId, profileId, supported });
      } catch (error) {
        write({ error: (error as Error).message });
      }
    },
    deleteArchivedNow: runCleanup,
    close() {
      clearInterval(dailyCleanup);
      clones.close();
      clearTimeout(settingTimer);
      companion?.stop();
      remote?.stop();
      computers?.stop();
      memoryWatcher.close();
      sharedFileWatcher.close();
      clearTimeout(memorySyncTimer);
      clearTimeout(startupMemorySync);
      for (const server of servers) server.dispose();
      servers.clear();
      limits.close();
      autoStarter?.close();
      // Before the hosts close: their turns end as `quit`, and the runs pause instead of stopping.
      clearTimeout(resumeRuns);
      runner?.close();
      scheduler.close();
      triggerWatcher?.close();
      if (demoLimitFile) unwatchFile(demoLimitFile);
      if (demoQueueFile) unwatchFile(demoQueueFile);
      if (demoTriggersFile) unwatchFile(demoTriggersFile);
      if (demoPipelinesFile) unwatchFile(demoPipelinesFile);
      hosts.closeAll();
      for (const monitor of usageMonitors.values()) monitor.stop();
      insights.close();
      checksWatcher.close();
      claudeUpdater.close();
      terminals.closeAll();
      clearTimeout(searchTimer);
      sessions.stop();
      for (const registry of registries.values()) registry.stop();
      accounts.stop();
      transcripts.stop();
      cache.close();
    },
  };
}
