import { z } from 'zod';
import { AbsolutePath } from './absolutePath.ts';
import type { ContractShape } from './rpc.ts';
import {
  AutoPick,
  AutoTierSchema,
  EditorInfo,
  Effort,
  ImageAttachment,
  ModelOption,
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
  ProjectInspection,
  FolderEntry,
  RewindResult,
  ContextUsage,
  QueuedMessage,
  SendMode,
  SessionHostInfo,
  SlashCommand,
  StreamDelta,
  WorktreeRequest,
} from './host.ts';
import {
  LiveSession,
  ProfileDefaults,
  ProjectDefaults,
  ProjectIconChoice,
  ProjectInfo,
  SearchHit,
  SessionsChanged,
  SessionsSnapshot,
  AgentUsage,
  TranscriptDiagnosis,
  TranscriptMessage,
  TranscriptUpdate,
} from './sessions.ts';
import { TerminalInfo, TerminalKind } from './terminal.ts';
import { LimitsState } from './usageLimit.ts';
import { PlanHistory, UsageBreakdown, UsageGroup, UsagePeriod, UsageScan, UsageSnapshot, WindowCost } from './usage.ts';
import { ActionRunResult, ActionSuggestion, ListedAction, ProjectAction } from './actions.ts';
import { ChangesBase, CheckLog, ChecksFinished, GithubStarStatus, GitChanges, GitSyncAction, PrChecks, PrDraft, PrProgress, WorktreeStatus } from './git.ts';
import { Capabilities } from './capabilities.ts';
import { WorktreeList, WorktreePullRequest, WorktreeRemoveItem, WorktreeRemoveResult, WorktreeSize } from './worktrees.ts';
import { BranchDeleteItem, BranchDeleteResult, BranchList } from './branches.ts';
import { ProfileColor, ProfilesSnapshot } from './profiles.ts';
import { ClaudeUpdateState } from './claudeUpdate.ts';
import { BackupSectionSchema, FolderMapping, ImportMode, ImportPreview } from './backup.ts';
import { LaterDraft, LaterItem, QueueAuto, QueueStarted, QueueWaitFor } from './later.ts';
import { Schedule, ScheduleRunEvent, ScheduleSave, ScheduleSession } from './scheduleSchema.ts';
import { Trigger, TriggerEvent, TriggerNotice, TriggerRepoInfo, TriggerSave, TriggersState } from './triggerSchema.ts';
import { Pipeline, PipelineNotice, PipelineRunState, PipelineSave, PushPreview } from './pipelineSchema.ts';
import { PROJECT_NAME_MAX } from './projectConstants.ts';
import { AskEvent, AskThreadList } from './sideQuestions.ts';
import { CatchUp, RequestWhy } from './catchUp.ts';
import { MAX_SIDE_QUESTION_LENGTH } from './sideQuestionConstants.ts';
import { MAX_PROMPT_LENGTH, MAX_SEARCH_QUERY_LENGTH } from './promptConstants.ts';
import { ContextItems } from './context.ts';
import { PromptScope, SavedPrompt, SavedPromptId, SavedPromptInput } from './savedPromptSchema.ts';
import { GithubIssueDetail, GithubOrigin, GithubPrDetail, GithubReason, GithubSearchResult } from './github.ts';
import { CompanionTarget } from './companion.ts';
import { DeviceName, RemoteSettings, RemoteStatus } from './remote.ts';
import { ComputerEvent, ComputerMethodSchema, ComputersStatus } from './computers.ts';
import { ClonePlan, CloneProgress, CloneSettings } from './clone.ts';
import { CONTINUE_EDITORS } from './companionConstants.ts';
import { KEEP_REASONS } from './retention.ts';
import {
  HookableComponentSchema,
  ModFocusParams,
  ModFocusResult,
  ModInfo,
  ModInputParams,
  ModInstance,
  ModLog,
  ModPaneRoster,
  ModPressParams,
  ModPromptAnswer,
  ModPromptAsk,
  ModRenderParams,
  ModRenderResult,
  ModScrollParams,
  ModScrollResult,
  ModSelectParams,
  ModSite,
  ModsSnapshot,
  ModsSurfaceState,
  ModStatus,
  ModToast,
} from './mods.ts';
import { ExportCandidate, HealthFinding, LoadEntry, MemoryHit, MemoryImportPreview, MemoryList, PersonalMemory, SectionCopy, SharePreview, ShareTarget } from './memory.ts';

export const ClaudeInstall = z.object({
  path: z.string(),
  /** Semver from `claude --version`, or null when the binary exists but the version could not be read. */
  version: z.string().nullable(),
});
export type ClaudeInstall = z.infer<typeof ClaudeInstall>;

export const SystemInfo = z.object({
  engineVersion: z.string(),
  startedAt: z.number(),
  versions: z.object({
    node: z.string(),
    electron: z.string().nullable(),
    sqlite: z.string(),
  }),
  paths: z.object({
    dataDir: z.string(),
    database: z.string(),
    claudeConfigDir: z.string(),
    /** The folder a terminal without a folder starts in. */
    home: z.string(),
  }),
  shell: z.object({
    path: z.string(),
    /** False when the login-shell environment could not be read and process.env was used instead. */
    resolved: z.boolean(),
    /** True when the environment came from the cache of a previous launch (refreshed in the background). */
    cached: z.boolean(),
    durationMs: z.number(),
  }),
  /** Null when no `claude` binary was found. */
  claude: ClaudeInstall.nullable(),
});
export type SystemInfo = z.infer<typeof SystemInfo>;

export const LogLevel = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof LogLevel>;

export const LogEntry = z.object({
  level: LogLevel,
  message: z.string(),
  at: z.number(),
});
export type LogEntry = z.infer<typeof LogEntry>;

const AppStateKey = z.string().min(1).max(200);
const SessionId = z.string().min(1).max(200);
const Prompt = z.string().max(MAX_PROMPT_LENGTH);
const ProfileId = z.string().min(1).max(100);
const ProfileName = z.string().trim().min(1).max(60);
const SettingsFilePath = AbsolutePath.regex(/\.json$/i, 'Settings files end in .json');
/** The app's preferences, which main keeps: the renderer passes them in and applies what comes back. */
const PreferencesRecord = z.record(z.string(), z.unknown());
/** A Markdown heading's text: one line. */
const SectionHeading = z.string().trim().min(1).max(200).regex(/^[^\r\n]+$/, 'A heading is one line');
/** A memory's file name without `.md` (validated again in the engine). */
const MemoryName = z.string().trim().min(1).max(80);
const MemoryTypeName = z.string().trim().min(1).max(40).regex(/^[a-z][a-z0-9_-]*$/);
const MemoryBody = z.string().max(500_000);
/** `add` a new section, or `replace` the section with the same heading. */
const SharePlacement = z.enum(['add', 'replace']).default('add');
/** Theme files as main keeps them (validated where they are read). */
const ThemeFiles = z.array(z.unknown()).max(500).default([]);

/** Auto model's routing answer: the model and Haiku's reason, or why it couldn't pick. */
export const RouteResult = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    routeId: z.string(),
    model: AutoTierSchema,
    reason: z.string(),
    tokens: z.number(),
    /** What the model uses against Opus, 0–1 (an estimate). */
    estimateVsOpus: z.number(),
    allowed: z.array(AutoTierSchema),
  }),
  z.object({ ok: z.literal(false), routeId: z.string().nullable(), reason: z.string(), tokens: z.number(), allowed: z.array(AutoTierSchema) }),
]);
export type RouteResult = z.infer<typeof RouteResult>;

/** Every request the UI can make and every event the engine can push. */
export const contract = {
  requests: {
    'system.info': {
      params: z.object({}),
      result: SystemInfo,
    },
    'system.ping': {
      params: z.object({ sentAt: z.number() }),
      result: z.object({ sentAt: z.number(), engineTime: z.number() }),
    },
    'appState.get': {
      params: z.object({ key: AppStateKey }),
      result: z.object({ value: z.json().nullable() }),
    },
    'appState.set': {
      params: z.object({ key: AppStateKey, value: z.json() }),
      result: z.object({}),
    },
    /** Sidebar data. Answers from the cache immediately; `sessions.changed` follows when the scan finishes. */
    'sessions.list': {
      params: z.object({}),
      result: SessionsSnapshot,
    },
    /** Pin a session, or archive it (moves it to "Archived") until it has new activity. */
    'sessions.setFlags': {
      params: z.object({ sessionId: SessionId, pinned: z.boolean().optional(), archived: z.boolean().optional() }),
      result: z.object({}),
    },
    /**
     * What a linked session's chip shows (session linking): its branch, its pull request, and whether it is gone. Also
     * warms what the engine needs to write the brief when the message is sent (the project's pull requests, the
     * branch's commits), so sending doesn't wait for gh.
     */
    'sessions.linkInfo': {
      params: z.object({ sessionId: SessionId }),
      result: z.object({ gone: z.boolean(), branch: z.string().nullable(), pr: WorktreePullRequest.nullable() }),
    },
    /**
     * Moves a session's transcript (and its subagent transcripts) to the Trash.
     * Stops it first when it runs in this app; refuses (SESSION_BUSY_ELSEWHERE) when another window has it open.
     */
    'session.delete': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    /**
     * Moves many sessions to the Trash, as `session.delete` does for one, and says which went and which stayed. Keeps
     * pinned and working sessions, ones that need you, are open in another window, or have a queued prompt or an unsent
     * message. Refuses (NO_TRASH) when nothing can move files to the Trash: it never deletes for good.
     */
    'sessions.deleteMany': {
      params: z.object({ sessionIds: z.array(SessionId).max(20_000) }),
      result: z.object({
        deleted: z.array(z.object({ id: z.string(), fileSize: z.number().nullable() })),
        skipped: z.array(z.object({ id: z.string(), reason: z.enum([...KEEP_REASONS, 'not-found', 'failed']), error: z.string().nullable() })),
      }),
    },
    /** Shows a session's transcript in Finder (Explorer on Windows). */
    'session.reveal': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    /** Shows a profile's projects folder, where Claude Code keeps its transcripts. */
    'profiles.revealProjects': { params: z.object({ profileId: ProfileId }), result: z.object({}) },
    /**
     * Claude Code's own clean-up, per profile: `cleanupPeriodDays` in its config folder's `settings.json` (null when the
     * key is missing, so Claude Code uses 30 days). `error` when the file isn't readable JSON.
     */
    'profiles.cleanupPeriods': {
      params: z.object({}),
      result: z.object({ profiles: z.array(z.object({ profileId: z.string(), settingsPath: z.string(), days: z.number().nullable(), error: z.string().nullable() })) }),
    },
    /** Sets `cleanupPeriodDays` in a profile's `settings.json` (null removes it), keeping every other setting. */
    'profiles.setCleanupPeriod': { params: z.object({ profileId: ProfileId, days: z.number().int().min(1).max(36_500).nullable() }), result: z.object({}) },
    /**
     * Gives a session a title of your own, stored in its transcript like Claude Code's `/rename`,
     * so `claude --resume` shows it too. The new title arrives with `sessions.changed`.
     */
    'session.rename': { params: z.object({ sessionId: SessionId, title: z.string().trim().min(1).max(200) }), result: z.object({}) },
    /** The user is looking at this session now; clears its unread state. */
    'sessions.markViewed': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    /** Mark as unread: the session counts as unread again until it is looked at. */
    'sessions.markUnviewed': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    /**
     * Your projects (`added`) in your order, plus every other folder Claude Code has sessions for
     * (`added: false`), which the Add project picker offers and the sidebar uses for icons.
     */
    'projects.list': { params: z.object({}), result: z.object({ projects: z.array(ProjectInfo) }) },
    'projects.add': { params: z.object({ path: AbsolutePath }), result: z.object({}) },
    /** Removes a project from Switchboard's list. Nothing on disk changes; its sessions stay. */
    'projects.remove': { params: z.object({ root: AbsolutePath }), result: z.object({}) },
    'projects.setIcon': { params: z.object({ root: AbsolutePath, icon: ProjectIconChoice }), result: z.object({}) },
    /** Names a project in Switchboard; null (or the folder's own name) goes back to the folder's name. The folder isn't touched. */
    'projects.rename': { params: z.object({ root: AbsolutePath, name: z.string().max(PROJECT_NAME_MAX).nullable() }), result: z.object({}) },
    /** Links a project to a Claude profile; null uses the default profile. */
    'projects.setProfile': { params: z.object({ root: AbsolutePath, profileId: ProfileId.nullable() }), result: z.object({}) },
    /** Replaces a project's defaults for new sessions. */
    'projects.setDefaults': { params: z.object({ root: AbsolutePath, defaults: ProjectDefaults }), result: z.object({}) },
    /** Puts your projects in this order (roots not listed keep their place after these). */
    'projects.reorder': { params: z.object({ roots: z.array(AbsolutePath).max(5000) }), result: z.object({}) },
    /**
     * A local checkout of GitHub's `owner/name`: the first of your projects, then the other folders with
     * sessions (most recently active first), with a git remote on that repository. Null when none has one.
     */
    'projects.findByRepo': { params: z.object({ repo: z.string().max(200).regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/) }), result: z.object({ root: AbsolutePath.nullable() }) },
    // --- Clone from GitHub (Settings › Projects) ------------------------------------------------------------
    'projects.cloneSettings': { params: z.object({}), result: CloneSettings },
    /** Changes Settings › Projects › Clone from GitHub; turning it on needs a folder (INVALID). `projects.cloneSettings` follows. */
    'projects.setCloneSettings': { params: CloneSettings.partial(), result: CloneSettings },
    /**
     * Where a clone of the repository a URL names would go (`name`: the folder's name, the repository's when left out),
     * and whether something is there already. INVALID for a URL that isn't a GitHub repository, with why.
     */
    'projects.clonePlan': { params: z.object({ url: z.string().max(2_000), name: z.string().max(255).optional() }), result: ClonePlan },
    /**
     * Clones the repository into the Clone into folder as `name`, then adds it to your projects. Returns at once; the
     * clone reports through `projects.cloneProgress` with `jobId`. A checkout of the same repository already there is
     * used as it is. CLONE_OFF while the setting is off, CLONE_TAKEN when something else has the name.
     */
    'projects.clone': { params: z.object({ jobId: z.string().min(1).max(100), url: z.string().max(2_000), name: z.string().min(1).max(255) }), result: z.object({}) },
    /** Stops a clone; the folder it made goes (never one that was there before). `cancelled` follows. */
    'projects.cancelClone': { params: z.object({ jobId: z.string().min(1).max(100) }), result: z.object({}) },
    // --- Claude profiles (one login per config folder) --------------------------------------
    'profiles.list': { params: z.object({}), result: ProfilesSnapshot },
    /** Adds a profile for a config folder (created when missing). Sign in there with `CLAUDE_CONFIG_DIR=<folder> claude`. */
    'profiles.add': {
      params: z.object({ name: ProfileName, color: ProfileColor, configDir: AbsolutePath }),
      result: z.object({ id: z.string() }),
    },
    'profiles.update': { params: z.object({ id: ProfileId, name: ProfileName.optional(), color: ProfileColor.optional() }), result: z.object({}) },
    /** Removes a profile from Switchboard (its folder, login and sessions stay). Its projects fall back to the default. */
    'profiles.remove': { params: z.object({ id: ProfileId }), result: z.object({}) },
    'profiles.setDefault': { params: z.object({ id: ProfileId }), result: z.object({}) },
    /** Replaces a profile's defaults for new sessions (projects' own defaults still come first). */
    'profiles.setDefaults': { params: z.object({ id: ProfileId, defaults: ProfileDefaults }), result: z.object({}) },
    /** Forces a full rescan of ~/.claude/projects. */
    'sessions.refresh': {
      params: z.object({}),
      result: z.object({}),
    },
    'transcript.get': {
      params: z.object({ sessionId: SessionId }),
      result: z.object({ sessionId: z.string(), messages: z.array(TranscriptMessage) }),
    },
    /** One image from a transcript, as base64. */
    'transcript.image': {
      params: z.object({ sessionId: SessionId, imageId: z.string().min(1).max(300) }),
      result: z.object({ mediaType: z.string(), data: z.string() }),
    },
    /** The transcript of the subagent a Task/Agent tool call started (null when it hasn't written one yet). */
    'transcript.subagent': {
      params: z.object({ sessionId: SessionId, toolUseId: z.string().min(1).max(200) }),
      result: z.object({ agentId: z.string().nullable(), agentType: z.string().nullable(), messages: z.array(TranscriptMessage) }),
    },
    /**
     * The tokens each subagent of a session used, from their own transcripts (the session's transcript doesn't have
     * them), counted the way the Usage view counts them. For the tokens of the turn that started each one.
     */
    'transcript.agentUsage': {
      params: z.object({ sessionId: SessionId }),
      result: z.object({ agents: z.array(AgentUsage) }),
    },
    /**
     * Checks why a session's conversation shows the way it does: its transcript files in every
     * profile's folder, what is in them, and what Claude Code's reader returns (or the error it throws).
     */
    'transcript.diagnose': {
      params: z.object({ sessionId: SessionId }),
      result: TranscriptDiagnosis,
    },
    /** Subscribes this window to `transcript.updated` for one session until unwatched or disconnected. */
    'transcript.watch': {
      params: z.object({ sessionId: SessionId }),
      result: z.object({}),
    },
    'transcript.unwatch': {
      params: z.object({ sessionId: SessionId }),
      result: z.object({}),
    },

    // --- Sessions run by this app ----------------------------------------------------------
    /** Running sessions and their open permission requests (for a window that just connected). */
    'hosts.list': {
      params: z.object({}),
      result: z.object({ hosts: z.array(SessionHostInfo), permissions: z.array(PermissionRequest) }),
    },
    /** Starts a new Claude Code session and sends the first message. */
    'session.create': {
      params: z.object({
        cwd: AbsolutePath,
        prompt: Prompt,
        attachments: z.array(ImageAttachment).max(20).default([]),
        model: z.string().max(200).nullable().default(null),
        permissionMode: PermissionMode.default('default'),
        effort: Effort.nullable().default(null),
        worktree: WorktreeRequest.nullable().default(null),
        /** The Claude profile to run with; null uses the project's, else the default. */
        profileId: ProfileId.nullable().default(null),
        /** Check out this branch in `cwd` first (not with a worktree). Fails when git refuses, e.g. over uncommitted changes. */
        checkoutBranch: z.string().min(1).max(250).nullable().default(null),
        /**
         * Check out this pull request in `cwd` first (`gh pr checkout`; not with a worktree or a branch). DIRTY when the
         * folder has changes ("3 changed files. Commit or stash them first."), GH_FAILED with gh's reason.
         */
        checkoutPullRequest: z.object({ number: z.number().int().positive(), repo: GithubOrigin.shape.repo }).optional(),
        /**
         * The issue or pull request New session was filled in from, kept with the session (`github.origin`). In a
         * session from a fork's pull request Switchboard can't push to (`readOnly`), push and Create pull request are off.
         */
        github: GithubOrigin.optional(),
      }),
      result: z.object({ sessionId: z.string() }),
    },
    /** What Auto picked for a session, also when it isn't running (null: Auto didn't pick its model). */
    'session.autoPick': { params: z.object({ sessionId: SessionId }), result: z.object({ autoPick: AutoPick.nullable() }) },
    /**
     * Sends a message, resuming the session first when it isn't running in this app.
     * Fails with SESSION_BUSY_ELSEWHERE when another Claude Code process has it open, unless `fork` is set.
     */
    'session.send': {
      params: z.object({
        sessionId: SessionId,
        text: Prompt,
        attachments: z.array(ImageAttachment).max(20).default([]),
        fork: z.boolean().default(false),
        /**
         * While Claude is working: `queue` holds the message until the turn ends (it shows in the queue meanwhile),
         * `steer` hands it to Claude now so it reads it at its next step, `now` stops the turn and runs it at once.
         * Nothing differs while Claude is idle.
         */
        mode: SendMode.default('queue'),
      }),
      result: z.object({
        sessionId: z.string(),
        /** The message's uuid in the transcript, or the queue entry's id when `queued`. */
        messageUuid: z.string(),
        /** Held in the queue instead of sent. */
        queued: z.boolean().default(false),
      }),
    },
    /** Takes a message out of a session's queue; the result is what it held, to put back in the message box. */
    'session.queue.remove': {
      params: z.object({ sessionId: SessionId, id: z.string() }),
      result: z.object({ message: z.object({ text: z.string(), attachments: z.array(ImageAttachment) }).nullable() }),
    },
    /** Moves a queued message to another place in the queue (0 is next). */
    'session.queue.move': { params: z.object({ sessionId: SessionId, id: z.string(), toIndex: z.number().int().min(0) }), result: z.object({}) },
    /** Sends one queued message now, stopping Claude's turn; the rest keep waiting. */
    'session.queue.sendNow': { params: z.object({ sessionId: SessionId, id: z.string() }), result: z.object({}) },
    /** After a stopped or failed turn: sends the next queued message and lets the queue move on by itself again. */
    'session.queue.resume': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    /** Every session's Up next as it is kept (also sessions that aren't running); `upNext.changed` follows each change. */
    'upNext.list': { params: z.object({}), result: z.object({ queues: z.array(z.object({ sessionId: z.string(), queue: z.array(QueuedMessage) })) }) },
    /**
     * Asks about the session (Ask about this session, or `/btw`): Claude answers from the session's conversation and
     * the project, with read-only tools (read files, search, git status, diff, log and show), and nothing is added to
     * the conversation. It runs beside a turn in progress, never in Up next. Without `threadId` it starts a new
     * thread; with one, the thread's earlier questions and answers go along. The answer comes through `session.ask`
     * events with the returned ids.
     */
    'session.ask': {
      params: z.object({
        sessionId: SessionId,
        threadId: z.string().max(100).optional(),
        question: z.string().trim().min(1).max(MAX_SIDE_QUESTION_LENGTH),
        /** A failed question in the thread that this asks again: it goes, and this one takes its place at the end. */
        replaces: z.string().max(100).optional(),
      }),
      result: z.object({ threadId: z.string(), id: z.string(), at: z.number() }),
    },
    /** The threads kept for a session, newest first. */
    'session.askThreads': { params: z.object({ sessionId: SessionId }), result: AskThreadList },
    'session.interrupt': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    /** Stops one of the session's background tasks (a shell command, subagent or workflow); Claude is told it was stopped. */
    'session.stopTask': { params: z.object({ sessionId: SessionId, taskId: z.string() }), result: z.object({}) },
    /**
     * The end of what a background command printed, from the output file Claude Code named in the transcript (the
     * engine reads only task output files). `missing`: no such file, yet or any more.
     */
    'session.taskOutput': {
      params: z.object({ sessionId: SessionId, outputFile: AbsolutePath }),
      result: z.object({ text: z.string(), size: z.number(), truncated: z.boolean(), missing: z.boolean() }),
    },
    /** A new session with this one's conversation up to and including `messageUuid`. */
    'session.forkAt': { params: z.object({ sessionId: SessionId, messageUuid: z.string() }), result: z.object({ sessionId: z.string() }) },
    /**
     * Restores the files Claude changed to how they were before one of your messages
     * (`dryRun` reports what would change). The conversation itself is untouched.
     */
    'session.rewind': {
      params: z.object({ sessionId: SessionId, messageUuid: z.string(), dryRun: z.boolean().default(false) }),
      result: RewindResult,
    },
    /** The model, effort and permission mode a session resumes with (the set calls only save them while it isn't running). */
    'session.savedSettings': {
      params: z.object({ sessionId: SessionId }),
      result: z.object({ model: z.string().nullable(), effort: Effort.nullable(), permissionMode: PermissionMode }),
    },
    'session.setPermissionMode': { params: z.object({ sessionId: SessionId, mode: PermissionMode }), result: z.object({}) },
    'session.setModel': { params: z.object({ sessionId: SessionId, model: z.string().max(200).nullable() }), result: z.object({}) },
    /** Changes how hard Claude thinks, for this session only (null: back to the default). */
    'session.setEffort': { params: z.object({ sessionId: SessionId, effort: Effort.nullable() }), result: z.object({}) },
    /** What fills a running session's context window, by category. */
    'session.context': { params: z.object({ sessionId: SessionId }), result: ContextUsage },
    /** Stops the Claude Code process behind a session (the transcript stays; sending resumes it). */
    'session.close': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    'session.respond': { params: z.object({ requestId: z.string(), decision: PermissionDecision }), result: z.object({}) },
    /** Slash commands, skills and plugin commands available to a session (or folder, for a new one). */
    'session.commands': {
      params: z.object({ sessionId: SessionId.optional(), cwd: AbsolutePath.optional(), profileId: ProfileId.optional() }),
      result: z.object({ commands: z.array(SlashCommand) }),
    },
    /** MCP servers, agents, skills and commands, and plugins for a session (live when it runs here) or a folder. */
    'session.capabilities': {
      params: z.object({ sessionId: SessionId.optional(), cwd: AbsolutePath, refresh: z.boolean().default(false), profileId: ProfileId.optional() }),
      result: Capabilities,
    },
    /**
     * Drops every cached list of skills and commands, so skills added or removed on disk show up.
     * Running sessions re-read their skill folders when they next list them; windows get `commands.changed`.
     */
    'skills.reload': { params: z.object({}), result: z.object({}) },
    /** Turns an MCP server on or off, or reconnects it, in a session running in this app. */
    'session.mcp': {
      params: z.object({ sessionId: SessionId, server: z.string().max(200), action: z.enum(['enable', 'disable', 'reconnect']) }),
      result: z.object({}),
    },
    /** Starts a Claude Code process for a folder ahead of time so the first message answers faster. */
    'session.prewarm': { params: z.object({ cwd: AbsolutePath, profileId: ProfileId.nullable().default(null) }), result: z.object({}) },
    'models.list': { params: z.object({}), result: z.object({ models: z.array(ModelOption) }) },
    /**
     * Plan usage (5-hour and weekly limits) from Claude Code's /usage report. Cached for a minute;
     * `refresh` fetches now. `usage` is null without a claude.ai plan or before the first fetch.
     */
    'usage.get': {
      /** The profile whose plan to report (default: the default profile). */
      params: z.object({ refresh: z.boolean().default(false), profileId: ProfileId.optional() }),
      result: z.object({ usage: UsageSnapshot.nullable(), error: z.string().nullable() }),
    },
    /**
     * Where a profile's tokens went in a period, from its transcripts (read in the background; `scan` is set while the
     * first read runs). `groupBy` picks the rows; `model` narrows everything to one model (the model panel). Local
     * days follow `timeZone` (IANA). Profiles that share a config folder report the same numbers.
     */
    'usage.breakdown': {
      params: z.object({
        profileId: ProfileId.optional(),
        period: UsagePeriod,
        groupBy: UsageGroup.default('session'),
        model: z.string().max(200).nullable().default(null),
        timeZone: z.string().max(100).default('UTC'),
      }),
      result: UsageBreakdown,
    },
    /**
     * The estimated API cost of each running plan window (the 5-hour one and the weekly ones), from the profile's
     * transcripts on this computer. A window without a reset time ahead has none.
     */
    'usage.cost': {
      params: z.object({ profileId: ProfileId.optional() }),
      result: z.object({ windows: z.array(WindowCost) }),
    },
    /**
     * The estimated API cost of one session since it started, in US dollars: its transcript and the helper calls made
     * for it. `cost` is null before any of its tokens were read; `partial` when a model without a known price was left out.
     */
    'usage.sessionCost': {
      params: z.object({ sessionId: SessionId, profileId: ProfileId.optional() }),
      result: z.object({ cost: z.object({ usd: z.number(), partial: z.boolean() }).nullable() }),
    },
    /** A profile's plan % over the period, per window, as recorded from /usage results and rate-limit updates. */
    'usage.history': {
      params: z.object({ profileId: ProfileId.optional(), period: UsagePeriod, timeZone: z.string().max(100).default('UTC') }),
      result: PlanHistory,
    },

    /** Profiles at a plan usage limit, the sessions armed to resume when it resets, and those that gave up; `limits.changed` follows each change. */
    'limits.state': { params: z.object({}), result: LimitsState },
    /** Resume now: sends a short message to a session a usage limit stopped, and lets its queue move on once a turn gets through. */
    'limits.resume': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    /** Resume when it resets: arms (or disarms) a session to continue by itself shortly after its profile's limit resets. */
    'limits.arm': { params: z.object({ sessionId: SessionId, armed: z.boolean() }), result: z.object({}) },

    // --- Folders, files and editors -----------------------------------------------------------
    /**
     * The scratch folder quick questions run in (created when missing), one for every question. It is never a
     * project: `projects.list` leaves it out, and adding, renaming or setting defaults for it is refused (INVALID).
     */
    'questions.folder': { params: z.object({}), result: z.object({ path: AbsolutePath }) },
    /** Whether `path` is a folder (`exists` is false for a file, with `isFile` set) and the git checkout it is in. */
    'projects.inspect': { params: z.object({ path: AbsolutePath }), result: ProjectInspection },
    /**
     * The folders in `path` (absolute, `~` or `~/…`) whose name starts with `prefix`, ignoring case: folders only,
     * sorted by name, at most 50, hidden ones only for a prefix that starts with a dot. `here` is `path` itself, null
     * when it is not a folder. Unreadable folders are left out; nothing here is an error. For typing a path in New session.
     */
    'fs.folders': {
      params: z.object({ path: z.string().min(1).max(1024), prefix: z.string().max(255).default('') }),
      result: z.object({ here: FolderEntry.nullable(), folders: z.array(FolderEntry) }),
    },
    /** Fuzzy file search for @-mentions (git-tracked and untracked-but-not-ignored files). */
    'files.search': {
      params: z.object({ cwd: AbsolutePath, query: z.string().max(500), limit: z.number().int().min(1).max(200).default(50) }),
      result: z.object({ files: z.array(z.string()) }),
    },
    /**
     * Which paths mentioned in a conversation exist, as absolute paths (null where none does): absolute,
     * `~/…`, or relative to `cwd`. Used to turn file names in Claude's replies into links.
     */
    'files.resolve': {
      params: z.object({ cwd: AbsolutePath.nullable(), paths: z.array(z.string().min(1).max(1024)).max(100) }),
      result: z.object({ paths: z.array(z.string().nullable()) }),
    },
    /**
     * Reads a Markdown, HTML or code file (see `previewKind`) to preview it. `content` is null when the file is over
     * `MAX_PREVIEW_BYTES` (`size` still says how big it is). HTML comes with a Content-Security-Policy meta added and its
     * local images inlined as data URIs. `modified` is the mtime in ms. NOT_FOUND when it is missing; UNSUPPORTED for a
     * folder or any other extension: only previewable files are read.
     */
    'files.read': {
      params: z.object({ path: AbsolutePath }),
      result: z.object({ kind: z.enum(['markdown', 'html', 'code']), size: z.number(), content: z.string().nullable(), modified: z.number() }),
    },
    /**
     * Reads an image a previewed file shows, as base64 (the shape of `transcript.image`). Only png, jpeg, gif, webp and
     * svg, checked by their first bytes rather than the extension, up to `MAX_PREVIEW_IMAGE_BYTES`. NOT_FOUND when it is
     * missing; UNSUPPORTED for a folder or something that isn't one of those images; TOO_LARGE over the limit.
     */
    'files.image': {
      params: z.object({ path: AbsolutePath }),
      result: z.object({ mediaType: z.string(), data: z.string() }),
    },
    'editors.list': { params: z.object({}), result: z.object({ editors: z.array(EditorInfo), defaultId: z.string().nullable() }) },
    /** Opens a folder or file (optionally at a line) in an editor; `editorId` defaults to the user's default. */
    'editors.open': {
      params: z.object({ path: AbsolutePath, line: z.number().int().positive().optional(), editorId: z.string().optional() }),
      result: z.object({}),
    },
    'editors.setDefault': { params: z.object({ editorId: z.string() }), result: z.object({}) },

    // --- Project actions -----------------------------------------------------------------------
    /** Merged actions for a project: yours for it, then shared (.switchboard.json), then global. */
    'actions.list': {
      params: z.object({ projectRoot: AbsolutePath }),
      result: z.object({ actions: z.array(ListedAction), sharedFile: z.string().nullable(), errors: z.array(z.string()) }),
    },
    /**
     * Saves one of your actions; `projectRoot: null` makes it global. `shared` saves it in the project's
     * .switchboard.json instead, for everyone on the project (and approves its command for you). `previousId` renames.
     */
    'actions.save': {
      params: z.object({ projectRoot: AbsolutePath.nullable(), action: ProjectAction, previousId: z.string().optional(), shared: z.boolean().optional() }),
      result: z.object({}),
    },
    /** Deletes one of your actions, or with `shared` takes it out of the project's .switchboard.json. */
    'actions.delete': { params: z.object({ projectRoot: AbsolutePath.nullable(), id: z.string(), shared: z.boolean().optional() }), result: z.object({}) },
    /** Approves a shared action's exact command (an edited command needs approval again), or an imported action of yours. */
    'actions.trust': { params: z.object({ projectRoot: AbsolutePath, id: z.string() }), result: z.object({}) },
    /** Starter actions for a project (package.json scripts, git, gh). */
    'actions.suggest': { params: z.object({ projectRoot: AbsolutePath }), result: z.object({ suggestions: z.array(ActionSuggestion) }) },
    /** Runs an action for a session: shell actions open a terminal tab, prompt actions message the session. */
    'actions.run': {
      params: z.object({ sessionId: SessionId, projectRoot: AbsolutePath, cwd: AbsolutePath, id: z.string() }),
      result: ActionRunResult,
    },

    // --- Saved prompts ---------------------------------------------------------------------------
    /**
     * Your prompts for every project, plus the project's own (just for you, and shared in its .switchboard.json)
     * when `root` is given, most recently used first. `errors` says what in the shared file couldn't be read.
     */
    'savedPrompts.list': {
      params: z.object({ root: AbsolutePath.optional() }),
      result: z.object({ prompts: z.array(SavedPrompt), errors: z.array(z.string()) }),
    },
    /** Creates a prompt (without an `id`) or updates one in its place. Shared ones are written to the project's file. */
    'savedPrompts.save': { params: z.object({ prompt: SavedPromptInput }), result: z.object({ prompt: SavedPrompt }) },
    'savedPrompts.delete': { params: z.object({ id: SavedPromptId, scope: PromptScope }), result: z.object({}) },
    /**
     * Moves a prompt to another place (global, just for you, shared; in another project too) in one step: it is
     * written there first, then taken out of where it was, so a failure loses nothing. WRITE_FAILED says why.
     */
    'savedPrompts.move': { params: z.object({ id: SavedPromptId, from: PromptScope, to: PromptScope }), result: z.object({ prompt: SavedPrompt }) },
    /** A prompt was sent: counts it, for ordering. Shared prompts' counts stay in the database. */
    'savedPrompts.used': { params: z.object({ id: SavedPromptId, scope: PromptScope }), result: z.object({}) },
    // --- GitHub issues and pull requests (through gh, read-only) --------------------------------------
    /** Whether the `#` list works in a project: `no-gh`, `not-signed-in`, `not-github` or `ok`. Checked once a minute. */
    'github.status': {
      params: z.object({ root: AbsolutePath }),
      result: z.object({ available: z.boolean(), reason: z.enum(['ok', 'no-gh', 'not-signed-in', 'not-github']), repo: z.string().nullable() }),
    },
    /**
     * Open issues and pull requests of the project's repository, at most 10 of each, for the `#` list and saved prompts'
     * blanks (cached per project and query for a minute; `refresh` asks gh again). An empty query lists the most
     * recently updated; a number or `#123` puts that item first, open or closed; a pasted link finds that item, in any
     * repository. Never fails: without gh, a sign-in or a GitHub remote the lists are empty with a `reason`, and a
     * rate limit or a network error keeps the last lists (`stale`).
     */
    'github.search': {
      params: z.object({ root: AbsolutePath, query: z.string().max(500).default(''), refresh: z.boolean().default(false) }),
      result: GithubSearchResult,
    },
    /** An issue with its text, from a link, `#123` or `123` (cached for a minute). Null with a reason when it can't be read. */
    'github.issue': {
      params: z.object({ root: AbsolutePath, ref: z.string().trim().min(1).max(500) }),
      result: z.object({ issue: GithubIssueDetail.nullable(), reason: GithubReason, message: z.string().nullable() }),
    },
    /** A pull request with its text, branches, whether you can push to it and its unresolved review comments. */
    /** The issue or pull request a session was started from (New session from it); null for any other session. */
    'github.origin': { params: z.object({ sessionId: SessionId }), result: z.object({ origin: GithubOrigin.nullable() }) },
    'github.pr': {
      params: z.object({ root: AbsolutePath, ref: z.string().trim().min(1).max(500) }),
      result: z.object({ pr: GithubPrDetail.nullable(), reason: GithubReason, message: z.string().nullable() }),
    },

    /**
     * Full-text search over your prompts and Claude's replies in every session, best matches first.
     * `indexing` reports background progress while transcripts are still being indexed.
     */
    'search.query': {
      // `switchboard` searches only the sessions started or continued in Switchboard, as the sidebar lists them.
      // Memories (`memories`) match their name, description and text; `memoryTypes` and `memoryScope` (a project root,
      // `personal` or `all`) narrow them, and `only` leaves out conversations or memory.
      params: z.object({
        query: z.string().max(MAX_SEARCH_QUERY_LENGTH),
        limit: z.number().int().min(1).max(500).default(200),
        scope: z.enum(['switchboard', 'all']).default('all'),
        only: z.enum(['all', 'conversations', 'memory']).default('all'),
        memoryTypes: z.array(z.string().max(40)).max(10).default([]),
        memoryScope: z.string().max(4096).default('all'),
      }),
      result: z.object({ hits: z.array(SearchHit), memories: z.array(MemoryHit), indexing: z.object({ indexed: z.number(), total: z.number() }) }),
    },
    /**
     * What to look at in a project's memory and the personal folder (`root` null: personal only): stale references,
     * duplicates, MEMORY.md against its folder, an index past what loads, old memories. Read-only; cached until files change.
     */
    'memory.health': { params: z.object({ root: AbsolutePath.nullable() }), result: z.object({ findings: z.array(HealthFinding) }) },
    /** What Fix index would change in a MEMORY.md: only lines for missing files out, lines for unlisted memories in. */
    'memory.fixIndexPreview': { params: z.object({ root: AbsolutePath.nullable(), indexPath: AbsolutePath }), result: z.object({ diff: z.string() }) },
    'memory.fixIndex': { params: z.object({ root: AbsolutePath.nullable(), indexPath: AbsolutePath }), result: z.object({}) },
    /** What in a text looks like a token, key or password (the same check as sharing and importing). Nothing is kept. */
    'memory.checkSecrets': { params: z.object({ text: z.string().max(500_000) }), result: z.object({ found: z.array(z.string()) }) },
    /** The memories a session wrote (their `metadata.originSessionId`), newest first. */
    'memory.bySession': { params: z.object({ sessionId: SessionId }), result: z.object({ memories: z.array(MemoryHit) }) },

    // --- Git -----------------------------------------------------------------------------------
    /** What changed in the checkout a session works in (see ChangesBase). */
    'git.changes': { params: z.object({ cwd: AbsolutePath, base: ChangesBase }), result: GitChanges },
    'git.diff': {
      params: z.object({ cwd: AbsolutePath, base: ChangesBase, path: z.string().max(4096) }),
      result: z.object({ diff: z.string(), truncated: z.boolean() }),
    },
    /**
     * Local branches of the repository at `cwd`, and the one checked out (null when detached or not a repo).
     * `checkedOutElsewhere`: the branches checked out in another worktree, which git won't switch to here.
     */
    'git.branches': {
      params: z.object({ cwd: AbsolutePath }),
      result: z.object({ current: z.string().nullable(), branches: z.array(z.string()), checkedOutElsewhere: z.array(z.string()).optional() }),
    },
    /**
     * Checks out a local branch in the checkout at `cwd` with `git switch`: uncommitted changes that
     * don't conflict come along, and git refuses (GIT_FAILED) when they do. Nothing is stashed or
     * discarded. Refused (SESSION_BUSY) while Claude is working in a session in this checkout.
     */
    'git.switch': { params: z.object({ cwd: AbsolutePath, branch: z.string().min(1).max(250) }), result: z.object({ current: z.string().nullable() }) },
    /** The checkout's page on github.com (at the branch when it is pushed); null when no remote is on GitHub. */
    'git.github': { params: z.object({ cwd: AbsolutePath }), result: z.object({ repo: z.string(), url: z.string() }).nullable() },
    'git.stage': { params: z.object({ cwd: AbsolutePath, paths: z.array(z.string().max(4096)).max(5000), staged: z.boolean() }), result: z.object({}) },
    /** Puts files back to HEAD. New files go to the Trash. */
    'git.revert': { params: z.object({ cwd: AbsolutePath, paths: z.array(z.string().max(4096)).min(1).max(5000) }), result: z.object({}) },

    /**
     * Fetches, pulls or pushes the branch checked out at `cwd`, in a terminal tab of the session so you can see the
     * result. A branch without an upstream is pushed with `-u`. Pull is refused (SESSION_BUSY) while Claude is working
     * in this checkout. Pull requests go through `git.prCreate`.
     */
    'git.sync': { params: z.object({ sessionId: SessionId, cwd: AbsolutePath, action: GitSyncAction }), result: z.object({ terminalId: z.string() }) },
    /**
     * Fetches, or pulls the upstream into the branch checked out at `cwd`, without a session or terminal
     * (New session), and returns where the checkout stands afterwards. The pull only fast-forwards
     * (DIVERGED otherwise) and is refused (SESSION_BUSY) while Claude is working in this checkout.
     */
    'git.update': { params: z.object({ cwd: AbsolutePath, action: z.enum(['fetch', 'pull']) }), result: WorktreeStatus },
    /**
     * Commits with your message, in a terminal tab of the session so hooks and their output stay
     * visible. Commits what is staged; with nothing staged, every change (new files too) is staged
     * first. Refused (SESSION_BUSY) while Claude is working in this checkout, and NOTHING_TO_COMMIT on a clean one.
     */
    'git.commit': { params: z.object({ sessionId: SessionId, cwd: AbsolutePath, message: z.string().trim().min(1).max(20_000) }), result: z.object({ terminalId: z.string() }) },
    /**
     * A commit message for what `git.commit` would commit now, written by Haiku on the session's profile from the
     * change alone (files, stat and a capped patch, plus recent subjects for the style), never the conversation, so it
     * costs a few thousand tokens however long the session is. Nothing is staged. NOTHING_TO_COMMIT on a clean
     * checkout, NO_MESSAGE when Haiku didn't answer in time.
     */
    'git.commitMessage': { params: z.object({ sessionId: SessionId, cwd: AbsolutePath }), result: z.object({ message: z.string() }) },
    /**
     * What the Create pull request dialog starts with for the branch checked out at `cwd`: its commits and diff against
     * `base` (else the project's base, `projectBase`, else the remote's default branch), the remote's branches, the
     * repository's templates, a pull request it may have already, and whether gh is there and signed in.
     * NOT_A_REPO outside git; DETACHED, NO_REMOTE or WRONG_BRANCH when no pull request can come from here.
     */
    'git.prDraft': {
      params: z.object({ cwd: AbsolutePath, base: z.string().min(1).max(250).optional(), projectBase: z.string().min(1).max(250).nullable().default(null) }),
      result: PrDraft,
    },
    /**
     * Pushes the branch checked out at `cwd` without a terminal (`-u` to the push remote the first time; nothing can ask
     * for a password), then creates the pull request with `gh pr create`, the description on its stdin. With `web` it
     * opens nothing itself: it ends with GitHub's compare page, for when gh isn't there. Returns once it has started;
     * progress, the pull request or why it stopped arrive through `git.pr` with `jobId`. BUSY while one runs here.
     */
    'git.prCreate': {
      params: z.object({
        jobId: z.string().min(1).max(100),
        cwd: AbsolutePath,
        title: z.string().trim().min(1).max(1_000),
        // Longer than GitHub takes, so the engine can say BODY_TOO_LONG rather than INVALID_PARAMS.
        body: z.string().max(2_000_000),
        base: z.string().min(1).max(250),
        draft: z.boolean().default(false),
        web: z.boolean().default(false),
      }),
      result: z.object({}),
    },
    /** The newest pull request of the branch checked out at `cwd`, from gh (cached for a few minutes; `fresh` asks again). Null without one, or without gh. */
    'git.prFor': { params: z.object({ cwd: AbsolutePath, fresh: z.boolean().default(false) }), result: z.object({ pr: WorktreePullRequest.nullable() }) },
    /** Marks a draft pull request ready for review (`gh pr ready`). GH_FAILED with gh's message. */
    'git.prReady': { params: z.object({ cwd: AbsolutePath, number: z.number().int().positive() }), result: z.object({}) },
    /**
     * The checks of the open pull request of the branch checked out at `cwd` (`gh pr checks`), null without one. A read
     * from the last 20 seconds is reused unless `fresh`; `afterPush` keeps asking for a while when there are none yet
     * (GitHub takes a moment to start them). While some run, the engine reads them again by itself (every 30 seconds,
     * every 5 minutes while no window has focus) and sends each read through `git.checks`; `sessionId` is the session
     * told through `git.checksFinished` when they finish.
     */
    'git.prChecks': {
      params: z.object({ cwd: AbsolutePath, sessionId: SessionId.optional(), fresh: z.boolean().default(false), afterPush: z.boolean().default(false) }),
      result: z.object({ checks: PrChecks.nullable() }),
    },
    /**
     * The end of each failed check's log (`gh run view <run> --job <job> --log-failed`): its last 150 lines, without
     * colours and timestamps, all of them together within what a message can hold.
     */
    'git.prCheckLogs': {
      params: z.object({ cwd: AbsolutePath, checks: z.array(z.object({ name: z.string().max(500), workflow: z.string().max(500), link: z.string().max(2_000) })).min(1).max(50) }),
      result: z.object({ logs: z.array(CheckLog) }),
    },

    /** Whether the account gh is signed in with has starred Switchboard (the sidebar's Star on GitHub button). */
    'github.starStatus': { params: z.object({}), result: z.object({ status: GithubStarStatus }) },
    /** Stars Switchboard for the account gh is signed in with. GH_MISSING, GH_AUTH or GH_FAILED when it can't. */
    'github.star': { params: z.object({}), result: z.object({}) },

    /** Where a session's checkout stands: ahead/behind its base and its upstream, uncommitted, pushed. */
    'worktree.status': { params: z.object({ cwd: AbsolutePath }), result: WorktreeStatus },
    /**
     * Finishes a worktree. `merge` merges its branch into the main checkout (which must be on the
     * base branch and clean), in a terminal tab. Pull requests go through `git.prCreate`.
     * `remove` stops the session here and removes the worktree (refused with uncommitted changes).
     */
    'worktree.finish': {
      params: z.object({ sessionId: SessionId, cwd: AbsolutePath, action: z.enum(['merge', 'remove']), deleteBranch: z.boolean().default(false) }),
      result: z.object({ terminalId: z.string().nullable() }),
    },

    // --- Worktree overview (a project's worktrees and their clean-up) ------------------------------
    /**
     * Every worktree of the repository at `root` (`git worktree list`), main checkout first, with what it takes to decide
     * whether it can go. `fetch` runs `git fetch` first so "merged" and "pushed" are current; pull requests come from `gh`
     * (cached for a few minutes; `fetch` asks again). NOT_A_REPO outside git.
     */
    'worktrees.list': { params: z.object({ root: AbsolutePath, fetch: z.boolean().default(false) }), result: WorktreeList },
    /**
     * Sizes on disk measured so far (cached), right away. Missing ones, and with `refresh` all of them, are measured in
     * the background and arrive through `worktrees.sizes`.
     */
    'worktrees.size': { params: z.object({ paths: z.array(AbsolutePath).max(500), refresh: z.boolean().default(false) }), result: z.object({ sizes: z.array(WorktreeSize) }) },
    /**
     * Removes worktrees of the repository at `root`, one after the other, each with `git worktree remove` (never a plain
     * delete) or, when its folder is gone, `git worktree prune`. Refuses (per item) the main checkout, a locked worktree,
     * uncommitted changes and a session working there or open in another Claude Code process; a session idle in
     * Switchboard is stopped first. Optionally deletes the branch, after saving a recovery ref.
     */
    'worktrees.remove': { params: z.object({ root: AbsolutePath, items: z.array(WorktreeRemoveItem).min(1).max(200) }), result: z.object({ results: z.array(WorktreeRemoveResult) }) },
    /**
     * Pushes the branch checked out in a worktree, without a session or terminal (the overview has none): `git push`, or
     * `git push -u <remote> <branch>` the first time. Nothing can ask for a password, so a remote that wants one fails.
     */
    'worktrees.push': { params: z.object({ path: AbsolutePath }), result: z.object({}) },
    /** Ignored files in a worktree that removing it would delete, leaving out dependencies and build output (node_modules, dist, …). */
    'worktrees.ignoredFiles': { params: z.object({ path: AbsolutePath }), result: z.object({ files: z.array(z.string()), total: z.number() }) },

    // --- Branch overview (a project's branches, here and on its remotes) ---------------------------
    /**
     * Every local branch of the repository at `root`, each with its copy on a remote, and the remote branches that have
     * no local copy, with what it takes to decide whether they can go. `fetch` runs `git fetch --prune` first, so
     * branches deleted on the remote show as gone. Pull requests come from `gh` (shared with `worktrees.list`). NOT_A_REPO outside git.
     */
    'branches.list': { params: z.object({ root: AbsolutePath, fetch: z.boolean().default(false) }), result: BranchList },
    /**
     * Deletes branches of the repository at `root`, one after the other: the local branch with `git branch -D` (after an
     * optional recovery ref), the remote one with `git push <remote> --delete`. Refuses (per item) the base branch, the
     * remote's default branch, a branch checked out in a worktree, and a remote branch with an open pull request.
     */
    'branches.delete': { params: z.object({ root: AbsolutePath, items: z.array(BranchDeleteItem).min(1).max(500) }), result: z.object({ results: z.array(BranchDeleteResult) }) },

    // --- Terminals ---------------------------------------------------------------------------
    /**
     * Starts a terminal. `claude` runs `claude --resume <session>` (or `--fork-session` with `fork`);
     * it refuses with SESSION_RUNNING_HERE / SESSION_BUSY_ELSEWHERE when the session is open in a process already.
     * Without a session it is the window's own terminal (outside session views); without `cwd` it starts in the home folder.
     * It gets the Claude profile of its session, or of its folder's project; `profileId` picks one instead (Settings › Claude
     * profiles opens `claude` with a new profile's folder to sign in), and is refused with NOT_FOUND when that profile is gone.
     */
    'terminal.open': {
      params: z.object({
        sessionId: SessionId.nullable(),
        cwd: AbsolutePath.optional(),
        kind: TerminalKind,
        cols: z.number().int().min(2).max(1000),
        rows: z.number().int().min(1).max(500),
        fork: z.boolean().default(false),
        profileId: ProfileId.optional(),
      }),
      result: TerminalInfo,
    },
    /**
     * Runs a command (from a code block in the conversation) in a terminal tab of its own, which ends with it. With
     * `sendOutput`, its exit code and the end of its output then go to the session as a message, queued while Claude works.
     */
    'terminal.run': {
      params: z.object({ sessionId: SessionId, cwd: AbsolutePath, command: z.string().trim().min(1).max(10_000), sendOutput: z.boolean().default(false) }),
      result: TerminalInfo,
    },
    'terminal.list': { params: z.object({}), result: z.object({ terminals: z.array(TerminalInfo) }) },
    /** The font the user's own terminal uses (Ghostty, VS Code), so prompts with Nerd Font glyphs render. */
    'terminal.font': { params: z.object({}), result: z.object({ fontFamily: z.string().nullable(), fontFamilies: z.array(z.string()), source: z.string().nullable() }) },
    /** Streams this terminal's output to the caller; returns recent output to replay first. */
    'terminal.attach': { params: z.object({ id: z.string() }), result: z.object({ info: TerminalInfo, replay: z.string() }) },
    'terminal.detach': { params: z.object({ id: z.string() }), result: z.object({}) },
    /**
     * Types into a terminal. `whenReady` is for a shell that was just opened: it waits until the shell has started (its
     * startup output has gone quiet, a few seconds at most), since a shell config that is still loading can drop typed input.
     */
    'terminal.write': { params: z.object({ id: z.string(), data: z.string().max(1_000_000), whenReady: z.boolean().optional() }), result: z.object({}) },
    'terminal.resize': {
      params: z.object({ id: z.string(), cols: z.number().int().min(2).max(1000), rows: z.number().int().min(1).max(500) }),
      result: z.object({}),
    },
    /** Kills the process (if still running) and forgets the terminal. */
    'terminal.close': { params: z.object({ id: z.string() }), result: z.object({}) },
    /** Stops the running process like Ctrl+C (then terminates, then kills it); the tab stays open with the exit code. */
    'terminal.stop': { params: z.object({ id: z.string() }), result: z.object({}) },
    /**
     * Runs an exited terminal's process again in the same tab. A project action is looked up again,
     * so an edited command is used and one that is no longer approved is refused with UNTRUSTED.
     */
    'terminal.restart': { params: z.object({ id: z.string() }), result: TerminalInfo },

    // --- Queue (the Later list, as it was first called) -------------------------------------------
    /**
     * The queue in order, first to start first; only one folder's with `cwd`. `started` maps queued items that
     * were started to their sessions, for the items still waiting on them; `auto` is what the engine knows about
     * items that start by themselves.
     */
    'later.list': { params: z.object({ cwd: AbsolutePath.optional() }), result: z.object({ items: z.array(LaterItem), started: z.array(QueueStarted), auto: QueueAuto }) },
    /**
     * Queues a prompt, at the end unless `index` says where. `id`, `createdAt`, `index` and `waitFor` put a removed
     * item back as it was (Undo).
     */
    'later.add': {
      params: z.object({
        draft: LaterDraft,
        id: z.string().min(1).max(100).optional(),
        createdAt: z.number().optional(),
        index: z.number().int().min(0).optional(),
        waitFor: QueueWaitFor.optional(),
      }),
      result: z.object({ item: LaterItem }),
    },
    /**
     * Takes an item off the queue. `startedAs`: it was started another way (edited in New session first), as this
     * session; items waiting on it follow that session.
     */
    'later.remove': { params: z.object({ id: z.string().min(1).max(100), startedAs: z.string().min(1).max(100).optional() }), result: z.object({}) },
    /** Moves an item to `toIndex` in the queue (clamped to its length). */
    'later.reorder': { params: z.object({ id: z.string().min(1).max(100), toIndex: z.number().int().min(0) }), result: z.object({}) },
    /**
     * Changes what an item waits for, whether it starts by itself, or its prompt and choices (edited in New session,
     * kept as you type). It keeps its place. Waiting for nothing turns `autoStart` off. NOT_FOUND when it is gone.
     */
    'later.update': {
      params: z.object({ id: z.string().min(1).max(100), waitFor: QueueWaitFor.optional(), autoStart: z.boolean().optional(), draft: LaterDraft.optional() }),
      result: z.object({ item: LaterItem }),
    },
    /**
     * Starts a queued item: the session is created from its draft exactly as New session creates one, then the
     * item leaves the queue. The focus limit's gate is the caller's (the UI asks before calling this).
     */
    'later.start': { params: z.object({ id: z.string().min(1).max(100) }), result: z.object({ sessionId: z.string() }) },

    // --- Scheduled sessions (#173) -----------------------------------------------------------------
    /**
     * Every schedule, oldest first, with the sessions they started (for the repeat icon on their rows). The engine runs
     * them; the windows only show them.
     */
    'schedules.list': { params: z.object({}), result: z.object({ schedules: z.array(Schedule), sessions: z.array(ScheduleSession) }) },
    /**
     * Creates a schedule (no `id`) or changes one: its name, draft, rule, missed rule and paused. It keeps its last run.
     * Saving starts counting its runs from now, so a time already past today doesn't run at once.
     */
    'schedules.save': { params: z.object({ schedule: ScheduleSave }), result: z.object({ schedule: Schedule }) },
    'schedules.delete': { params: z.object({ id: z.string().min(1).max(100) }), result: z.object({}) },
    /** Puts a deleted schedule back as it was (Undo). */
    'schedules.restore': { params: z.object({ schedule: Schedule }), result: z.object({ schedule: Schedule }) },
    /** Pauses or resumes. A resumed schedule counts its runs from now: what was due while it was paused doesn't run. */
    'schedules.setPaused': { params: z.object({ id: z.string().min(1).max(100), paused: z.boolean() }), result: z.object({ schedule: Schedule }) },
    /**
     * Runs it now, with the same rules as a run at its time (skipped while the last run is busy, queued at a limit). It
     * doesn't move the next run. The result is the run's.
     */
    /**
     * Skip this run: the run at `at` (an ISO time one of its runs falls on) doesn't start. Its time passes as a
     * skipped run, "Skipped by you". `unskipRun` takes it back.
     */
    'schedules.skipRun': { params: z.object({ id: z.string().min(1).max(100), at: z.iso.datetime() }), result: z.object({ schedule: Schedule }) },
    'schedules.unskipRun': { params: z.object({ id: z.string().min(1).max(100), at: z.iso.datetime() }), result: z.object({ schedule: Schedule }) },
    'schedules.runNow': { params: z.object({ id: z.string().min(1).max(100) }), result: z.object({ run: ScheduleRunEvent }) },

    // --- Event triggers (#180) -------------------------------------------------------------------
    /** Every trigger, oldest first, with its events and the sessions triggers started (the bolt on their rows). */
    'triggers.list': { params: z.object({}), result: TriggersState },
    /**
     * Creates a trigger (no `id`) or changes one. Never with bypass permissions. A new one, or one whose source changed,
     * looks at once and marks what is there as seen; only what comes after starts a session.
     */
    'triggers.save': { params: z.object({ trigger: TriggerSave }), result: z.object({ trigger: Trigger }) },
    /** Deletes a trigger and its events; what it was is returned for Undo. The sessions it started keep their bolt. */
    'triggers.delete': { params: z.object({ id: z.string().min(1).max(100) }), result: z.object({ trigger: Trigger.nullable(), events: z.array(TriggerEvent) }) },
    /** Puts a deleted trigger back (Undo), with its events. It looks again before it starts anything. */
    'triggers.restore': { params: z.object({ trigger: Trigger, events: z.array(TriggerEvent).max(1000) }), result: z.object({ trigger: Trigger }) },
    /** Pauses or resumes. Resumed, it looks again first: what came while it was paused is marked as seen. */
    'triggers.setPaused': { params: z.object({ id: z.string().min(1).max(100), paused: z.boolean() }), result: z.object({ trigger: Trigger }) },
    /** Checks a trigger now, whether due or not: the trigger after it, and how many new events the check found. */
    'triggers.checkNow': { params: z.object({ id: z.string().min(1).max(100) }), result: z.object({ trigger: Trigger, found: z.number().int().min(0) }) },
    /** Start now (a waiting event) or Start anyway (a skipped one), past `maxAtOnce`; the focus and usage limits still hold it. */
    'triggers.startEvent': { params: z.object({ eventId: z.string().min(1).max(100) }), result: z.object({ event: TriggerEvent.nullable() }) },
    /** The editor's facts about a project's repository: gh's account, the default branch, the workflows, the collaborators. */
    'triggers.repoInfo': { params: z.object({ root: AbsolutePath }), result: TriggerRepoInfo },

    // --- Pipelines (#179) ------------------------------------------------------------------------
    /** The built-ins, then your pipelines; with `root`, only the ones that project can run. */
    'pipelines.list': { params: z.object({ root: AbsolutePath.nullable().default(null) }), result: z.object({ pipelines: z.array(Pipeline) }) },
    /** Creates a pipeline (no `id`) or changes one of yours. Refused while `pipelineIssues` finds anything, or for a built-in. */
    'pipelines.save': { params: z.object({ pipeline: PipelineSave }), result: z.object({ pipeline: Pipeline }) },
    /** Deletes one of your pipelines; what it was is returned for Undo. Runs that started from it go on. */
    'pipelines.delete': { params: z.object({ id: z.string().min(1).max(100) }), result: z.object({ pipeline: Pipeline.nullable() }) },
    /** Puts a deleted pipeline back (Undo). */
    'pipelines.restore': { params: z.object({ pipeline: Pipeline }), result: z.object({ pipeline: Pipeline }) },
    /**
     * Runs a pipeline: from a session (it becomes the parent), or from New session with a task and a project (a run
     * row is the parent). The run's folder is made first; the first step starts, or waits for a slot or for you.
     */
    'pipelines.run': {
      params: z.object({
        pipelineId: z.string().min(1).max(100),
        parentSessionId: z.string().min(1).max(200).nullable().default(null),
        task: z.string().max(MAX_PROMPT_LENGTH).nullable().default(null),
        project: AbsolutePath.nullable().default(null),
        profileId: z.string().min(1).max(100).nullable().default(null),
        /** New session's model, effort and mode: the steps that don't set their own take them. Null: none. */
        choices: z.object({ model: z.string().max(200).nullable(), effort: Effort.nullable(), permissionMode: PermissionMode.nullable() }).nullable().default(null),
      }),
      result: z.object({ state: PipelineRunState }),
    },
    /** Every run with its steps, oldest first. */
    'runs.list': { params: z.object({}), result: z.object({ runs: z.array(PipelineRunState) }) },
    'runs.get': { params: z.object({ runId: z.string().min(1).max(100) }), result: z.object({ state: PipelineRunState.nullable() }) },
    /**
     * Continue: starts the step that waits for you (Wait for me, or Push, with an edited commit message), goes on to the
     * next step after a stop, or goes on with a paused run.
     */
    'runs.continue': { params: z.object({ runId: z.string().min(1).max(100), message: z.string().max(5_000).nullable().default(null) }), result: z.object({ state: PipelineRunState }) },
    /** Run this step again: a new round of the current step, in a new sub-session. */
    'runs.retryStep': { params: z.object({ runId: z.string().min(1).max(100) }), result: z.object({ state: PipelineRunState }) },
    /** Skip this step: the next one starts, or waits. */
    'runs.skipStep': { params: z.object({ runId: z.string().min(1).max(100) }), result: z.object({ state: PipelineRunState }) },
    /** Stop the run: the step that works stops, and nothing starts after it. */
    'runs.stop': { params: z.object({ runId: z.string().min(1).max(100) }), result: z.object({ state: PipelineRunState }) },
    /**
     * Archives or unarchives a run's tree in one go: the parent session (or the run row) and every sub-session under
     * it. Refuses while a run in it goes on (stop it first). The runs of the tree, after.
     */
    'runs.archive': { params: z.object({ runId: z.string().min(1).max(100), archived: z.boolean() }), result: z.object({ runs: z.array(PipelineRunState) }) },
    /**
     * Deletes a run's tree from Switchboard: its runs (stopped first), the parent session, and the sub-sessions unless
     * `keepSubSessions` (they then show on their own). Transcripts stay on disk.
     */
    'runs.delete': { params: z.object({ runId: z.string().min(1).max(100), keepSubSessions: z.boolean().default(false) }), result: z.object({}) },
    /** Push's card: the commit message Haiku writes from the diff (once per run, unless `fresh`), the files and the branches. */
    'runs.pushPreview': { params: z.object({ runId: z.string().min(1).max(100), fresh: z.boolean().default(false) }), result: z.object({ preview: PushPreview }) },
    /**
     * You wrote in a run row (a run started from New session): it gets a session of its own in the run's folder, with a
     * brief of the run before your text, and its sub-sessions go under that session.
     */
    'runs.write': { params: z.object({ runId: z.string().min(1).max(100), text: z.string().min(1).max(MAX_PROMPT_LENGTH) }), result: z.object({ sessionId: z.string() }) },

    // --- Settings backup -----------------------------------------------------------------------
    /** Writes the chosen kinds of user choices (never the cache) to a settings file. */
    'settings.export': {
      params: z.object({
        path: SettingsFilePath,
        sections: z.array(BackupSectionSchema).min(1),
        preferences: PreferencesRecord,
        /** Main keeps imported themes; the renderer passes their files in. */
        themes: ThemeFiles,
        appVersion: z.string().max(100),
      }),
      result: z.object({ path: z.string() }),
    },
    /**
     * Reads a settings file and reports what importing it would change. With `apply`, first backs up the
     * current settings (`backupPath`), then imports; `preferences` is what the renderer should apply.
     * Imported shell actions need approval again before they run.
     */
    'settings.import': {
      params: z.object({
        path: SettingsFilePath,
        sections: z.array(BackupSectionSchema),
        mode: ImportMode.default('merge'),
        relocate: z.array(FolderMapping).max(5000).default([]),
        /** The current preferences, to compare with and to back up. */
        preferences: PreferencesRecord,
        /** The imported themes there are now (their files), to compare with and to back up. */
        themes: ThemeFiles,
        appVersion: z.string().max(100),
        apply: z.boolean().default(false),
      }),
      result: z.object({
        preview: ImportPreview,
        backupPath: z.string().nullable(),
        preferences: PreferencesRecord.nullable(),
        /** Themes for the renderer to hand to main: added, or replacing the one with the same name. */
        themes: z.array(z.object({ raw: z.unknown(), how: z.enum(['add', 'replace']) })),
      }),
    },

    // --- VS Code companion ---------------------------------------------------------------------
    /**
     * The session in this window's active pane (null on Home, New session or Settings): where the companion sends
     * context first. `scope` is the sidebar's (`sessionScope`): the companion lists the sessions it lists.
     */
    'companion.focus': { params: z.object({ sessionId: SessionId.nullable(), scope: z.enum(['switchboard', 'all']).default('switchboard') }), result: z.object({}) },
    /** This window added the context of a `companion.context` event (or couldn't, and says why). */
    'companion.received': {
      params: z.object({ deliveryId: z.string().min(1).max(100), error: z.string().max(500).nullable().default(null) }),
      result: z.object({}),
    },
    /** Whether the companion socket is listening, and how many editors are connected to it. */
    'companion.status': { params: z.object({}), result: z.object({ listening: z.boolean(), clients: z.number(), error: z.string().nullable() }) },

    // --- Remote: follow and steer sessions from a phone (docs/remote-access.md) --------------------------------
    'remote.status': { params: z.object({}), result: RemoteStatus },
    /** Changes Settings › Remote; the server starts, restarts or stops to match. */
    'remote.configure': { params: RemoteSettings.partial(), result: RemoteStatus },
    /** Pair a device: the link for the QR code (good for one use and two minutes). */
    'remote.pair.start': { params: z.object({}), result: z.object({ url: z.string(), expiresAt: z.number() }) },
    /** A link for phones already paired, with the engine's current address (a tunnel that got a new one). */
    'remote.connectLink': { params: z.object({}), result: z.object({ url: z.string() }) },
    /** The pairing dialog was closed: the QR code stops working, and a phone waiting for Allow is denied. */
    'remote.pair.cancel': { params: z.object({}), result: z.object({}) },
    /** Allow or Deny for the phone waiting with this request's code. */
    'remote.pair.decide': { params: z.object({ requestId: z.string().min(1).max(100), allow: z.boolean() }), result: z.object({}) },
    /** Revoke: the device can't connect any more, and its open connections close at once. */
    'remote.revoke': { params: z.object({ deviceId: z.string().min(1).max(100) }), result: z.object({}) },
    /** Renames a paired device (Settings › Remote, Rename); `remote.changed` follows with the new name. */
    'remote.rename': { params: z.object({ deviceId: z.string().min(1).max(100), name: DeviceName }), result: z.object({}) },

    // --- Other computers: this app paired with Remote on another computer (docs/remote-access.md) -------------------
    'computers.status': { params: z.object({}), result: ComputersStatus },
    /**
     * A link copied from another computer's Pair a device: pairs with it (the progress and the code to compare come
     * with `computers.changed`). A link from Reconnect a paired device tells a paired computer's new address.
     */
    'computers.add': { params: z.object({ link: z.string().trim().min(1).max(2_000) }), result: z.object({}) },
    /** Stops pairing (the other computer's question goes away with the connection). */
    'computers.cancelPairing': { params: z.object({}), result: z.object({}) },
    /** Forgets a paired computer here (that computer still lists this one until you revoke it there). */
    'computers.forget': { params: z.object({ id: z.string().min(1).max(100) }), result: z.object({}) },
    /** Try again now to reach a computer that is offline. */
    'computers.retry': { params: z.object({ id: z.string().min(1).max(100) }), result: z.object({}) },
    /**
     * A request to another computer, in its remote contract (`COMPUTER_METHODS`). That computer checks the params;
     * the result is its, unchecked here: show it as text, as the remote app does. UNAVAILABLE while not connected.
     */
    'computers.call': {
      params: z.object({ computerId: z.string().min(1).max(100), method: ComputerMethodSchema, params: z.json() }),
      result: z.json(),
    },
    /**
     * Continues a session in an editor's Claude Code extension: stops it here and waits for its process to exit,
     * opens its folder in the editor, then the session in the extension (it only resumes sessions of the folder
     * that's open). Refused (SESSION_BUSY_ELSEWHERE) when another Claude Code process has it open.
     */
    'session.continueInEditor': {
      params: z.object({ sessionId: SessionId, editorId: z.enum(CONTINUE_EDITORS).default('vscode') }),
      result: z.object({}),
    },

    // --- Memory and project instructions ------------------------------------------------------
    /**
     * A project's auto memory (the `*.md` files in its memory folder, for every Claude profile, `MEMORY.md` left out)
     * and its instruction files (CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md, .claude/rules/). Read-only.
     */
    'memory.list': { params: z.object({ root: AbsolutePath }), result: MemoryList },
    /**
     * One memory or instruction file, with when it last changed. Only inside the project's memory folders, the project
     * itself or the personal memory folder (`root` null: only that), FORBIDDEN otherwise.
     */
    'memory.read': { params: z.object({ root: AbsolutePath.nullable(), path: AbsolutePath }), result: z.object({ content: z.string(), modified: z.number() }) },
    /**
     * A new memory in Claude Code's format, with its MEMORY.md line in the style of the others: in the project's folder
     * of a profile (its own by default) or, with `root` null, the personal folder. NAME_TAKEN when the name is.
     */
    'memory.create': {
      params: z.object({
        root: AbsolutePath.nullable(),
        profileId: ProfileId.nullable().default(null),
        name: MemoryName,
        type: MemoryTypeName,
        description: z.string().max(300),
        body: MemoryBody,
        /** Extra `metadata:` fields, such as `originSessionId` and `source`. */
        metadata: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), z.string().max(500)).optional(),
      }),
      result: z.object({ path: z.string() }),
    },
    /**
     * Saves a memory's description, type and body; every other frontmatter field stays. CHANGED when the file changed on
     * disk after `expectedModified` (unless `force`). A new description becomes its MEMORY.md line's hook.
     */
    'memory.write': {
      params: z.object({
        root: AbsolutePath.nullable(),
        path: AbsolutePath,
        description: z.string().max(300),
        type: MemoryTypeName,
        body: MemoryBody,
        expectedModified: z.number().nullable(),
        force: z.boolean().default(false),
      }),
      result: z.object({ modified: z.number() }),
    },
    /** Renames a memory: the file, its `name:` and its MEMORY.md line. NAME_TAKEN when the new name is. */
    /** With `updateLinks`, the `[[old]]` links to it in other memories follow (`updatedLinks`: the files changed). */
    'memory.rename': {
      params: z.object({ root: AbsolutePath.nullable(), path: AbsolutePath, name: MemoryName, updateLinks: z.boolean().default(false) }),
      result: z.object({ path: z.string(), updatedLinks: z.array(z.string()) }),
    },
    /**
     * Every memory's `[[name]]` links in the project's folders and the personal one (`root` null: personal only), each
     * resolved in its own folder first, then the personal folder (`target` null: not written yet), and what links to it.
     */
    'memory.links': {
      params: z.object({ root: AbsolutePath.nullable() }),
      result: z.object({ links: z.record(z.string(), z.object({ links: z.array(z.object({ name: z.string(), target: z.string().nullable() })), backlinks: z.array(z.string()) })) }),
    },
    /** Moves a memory to the Trash and takes out its MEMORY.md line; `memory.restore` with the token puts both back. */
    'memory.remove': { params: z.object({ root: AbsolutePath.nullable(), path: AbsolutePath }), result: z.object({ undoToken: z.string() }) },
    'memory.restore': { params: z.object({ undoToken: z.string().min(1).max(100) }), result: z.object({ path: z.string() }) },
    /**
     * What Claude Code loads at the start of a session in this project with a profile (the project's own by default), in
     * order, with sizes; MEMORY.md says how much of it loads. Rules limited to `paths:` come last, as on demand.
     */
    /** The personal memory folder (loaded in every project), its memories and whether each profile's CLAUDE.md loads it. */
    'memory.personal': { params: z.object({}), result: PersonalMemory },
    /** Chooses the personal folder (an iCloud, Dropbox or git folder syncs it). A block already in CLAUDE.md follows it. */
    'memory.setPersonalDir': { params: z.object({ path: AbsolutePath }), result: PersonalMemory },
    /** What adding the marked block would change in each profile's CLAUDE.md, before anything is written. */
    'memory.blockPreview': {
      params: z.object({}),
      result: z.object({ line: z.string(), profiles: z.array(z.object({ profileId: z.string(), path: z.string(), exists: z.boolean(), diff: z.string() })) }),
    },
    /** Adds (or updates) the marked block that loads the personal folder in every profile's CLAUDE.md. */
    'memory.installBlock': { params: z.object({}), result: PersonalMemory },
    /** Remove from Claude Code: takes only the marked block out of every profile's CLAUDE.md; the memory files stay. */
    'memory.removeBlock': { params: z.object({}), result: PersonalMemory },
    /** Moves a memory between the project's folder and the personal one, with both MEMORY.md lines. NAME_TAKEN when the name is. */
    'memory.move': {
      params: z.object({ root: AbsolutePath, path: AbsolutePath, to: z.enum(['personal', 'project']), profileId: ProfileId.nullable().default(null) }),
      result: z.object({ path: z.string() }),
    },
    /** A sync conflict copy: keep it (it replaces the memory it stands for) or the other; the one that goes moves to the Trash. */
    'memory.resolveConflict': { params: z.object({ root: AbsolutePath.nullable(), path: AbsolutePath, keep: z.enum(['this', 'other']) }), result: z.object({ path: z.string() }) },
    /** Copies a project memory to the same project's folder of another Claude profile (a taken name gets `-2`). */
    'memory.copyToProfile': { params: z.object({ root: AbsolutePath, path: AbsolutePath, profileId: ProfileId }), result: z.object({ path: z.string() }) },
    /**
     * Saves one of the project's instruction files. CHANGED when it changed on disk after `expectedModified` (unless
     * `force`). `changedInGit`: it is committed with the project and now has changes to look at in Changes.
     */
    'memory.writeInstruction': {
      params: z.object({ root: AbsolutePath, path: AbsolutePath, content: MemoryBody, expectedModified: z.number().nullable(), force: z.boolean().default(false) }),
      result: z.object({ modified: z.number(), changedInGit: z.boolean() }),
    },
    /** For each of your projects: how many memories it has and how many lines its MEMORY.md has. */
    'memory.overview': { params: z.object({}), result: z.object({ projects: z.array(z.object({ root: z.string(), memories: z.number(), indexLines: z.number() })) }) },
    /**
     * Reads a Claude data export (the memories and projects zips, an unzipped folder, `memories/<uuid>.json` or the
     * manifest) and says what importing it would write, where, and what to look at. Only `memories` and `projects` are
     * read, never `conversations`. Nothing is written.
     */
    'memory.importExportPreview': { params: z.object({ paths: z.array(AbsolutePath).min(1).max(10) }), result: MemoryImportPreview },
    /** The same preview for text pasted from the Claude app, split into one memory per heading or bullet. It is data, never a prompt. */
    'memory.importPastePreview': { params: z.object({ text: z.string().min(1).max(500_000) }), result: MemoryImportPreview },
    /** Writes the entries picked from the last preview (each with where it goes and its type), with their MEMORY.md lines. */
    'memory.import': {
      params: z.object({
        token: z.string().min(1).max(100),
        picks: z.array(z.object({ id: z.string(), target: z.string().min(1), type: MemoryTypeName })).max(2000),
      }),
      result: z.object({ created: z.number(), updated: z.number() }),
    },
    /** Memories Copy for Claude app can pick from: the personal folder's and every project's. */
    'memory.exportCandidates': { params: z.object({}), result: z.object({ memories: z.array(ExportCandidate) }) },
    /** One plain-text block of the memories picked, for the Claude app's memory import. */
    'memory.exportText': { params: z.object({ paths: z.array(AbsolutePath).min(1).max(500) }), result: z.object({ text: z.string() }) },
    'memory.loadOrder': { params: z.object({ root: AbsolutePath, profileId: ProfileId.nullable().default(null) }), result: z.object({ profileId: z.string(), entries: z.array(LoadEntry) }) },
    /**
     * What sharing a memory with the team would change: the target file before and after, a unified diff and warnings.
     * `placement` matters only when the target has a section with the same heading (`sameHeading`).
     */
    'memory.sharePreview': {
      params: z.object({ root: AbsolutePath, memoryPath: AbsolutePath, target: ShareTarget, heading: SectionHeading, placement: SharePlacement }),
      result: SharePreview,
    },
    /**
     * Writes the memory into the target (never stages or commits), and with `removeMemory` moves the memory file to the
     * Trash and takes its line out of MEMORY.md. Refused when the text is already there (ALREADY_THERE), and when it looks
     * like a secret until `secretsChecked` (SECRETS). `undoToken` works with `memory.undoShare` until the next share.
     */
    'memory.share': {
      params: z.object({
        root: AbsolutePath,
        memoryPath: AbsolutePath,
        target: ShareTarget,
        heading: SectionHeading,
        placement: SharePlacement,
        removeMemory: z.boolean(),
        secretsChecked: z.boolean().default(false),
      }),
      result: z.object({ targetPath: z.string(), removed: z.boolean(), undoToken: z.string() }),
    },
    /** Puts the last share back: the target as it was (deleted when the share made it), the memory file and its MEMORY.md line. */
    'memory.undoShare': { params: z.object({ undoToken: z.string().min(1).max(100) }), result: z.object({}) },
    /** Adds CLAUDE.local.md to the project's .gitignore (created when missing). Nothing is staged. */
    'memory.ignoreLocal': { params: z.object({ root: AbsolutePath }), result: z.object({ path: z.string() }) },
    /**
     * Copies a section (`## ` or `### ` heading) of an instruction file into a new memory of the project's profile, and adds
     * its MEMORY.md line. The instruction file is never changed. `dryRun` returns what it would write.
     */
    'memory.createFromSection': {
      params: z.object({
        root: AbsolutePath,
        file: AbsolutePath,
        heading: SectionHeading,
        name: z.string().trim().min(1).max(80),
        type: z.string().trim().min(1).max(40),
        description: z.string().trim().max(300),
        dryRun: z.boolean().default(false),
      }),
      result: SectionCopy,
    },

    // --- Catch-up ------------------------------------------------------------------------------
    /** A session's catch-up: the briefing on its last turn (null when it has none, or a new turn started since). */
    'catchup.get': { params: z.object({ sessionId: SessionId }), result: z.object({ catchUp: CatchUp.nullable() }) },
    /** Every session's catch-up, for the sidebar's review times (a window that just connected); `catchup.changed` follows each change. */
    'catchup.list': { params: z.object({}), result: z.object({ catchUps: z.array(CatchUp) }) },
    /**
     * Makes the catch-up for a session's last finished turn now, from its transcript (also for a session that ran in a
     * terminal), and sends it with `catchup.changed`. NOT_FOUND without a finished turn; SESSION_BUSY while Claude works.
     */
    'catchup.build': { params: z.object({ sessionId: SessionId }), result: z.object({ catchUp: CatchUp }) },
    /**
     * Why the session asks for an open permission or question: the turn so far and, with summaries on, Haiku's plain
     * explanation (6 seconds at most). The same request answers from memory the second time. NOT_FOUND once it is answered.
     */
    'catchup.why': { params: z.object({ sessionId: SessionId, requestId: z.string() }), result: z.object({ why: RequestWhy }) },

    // --- Claude Code updates -----------------------------------------------------------------
    'claudeUpdate.get': { params: z.object({}), result: ClaudeUpdateState },
    /** Compares the installed Claude Code with the newest on its channel now. The result arrives through `claudeUpdate.changed`. */
    'claudeUpdate.check': { params: z.object({}), result: z.object({}) },
    /**
     * Runs the update command for the install method, streaming its output through `claudeUpdate.changed`, then finds
     * `claude` again so new sessions use the new version. Refused (UNSUPPORTED) when Switchboard can't run it, BUSY while running.
     */
    'claudeUpdate.update': { params: z.object({}), result: z.object({}) },
    /** Hides the notice until a newer version than the one on offer, and clears "Updated to". */
    'claudeUpdate.dismiss': { params: z.object({}), result: z.object({}) },
    /** Turns automatic checks on or off (remembered). */
    'claudeUpdate.setEnabled': { params: z.object({ enabled: z.boolean() }), result: z.object({}) },
    /** What the mods of every running session show now (`mods.*` events follow). */
    'mods.snapshot': { params: z.object({}), result: z.object({ sessions: z.array(ModsSnapshot) }) },
    /**
     * Has a mod draw a component instance. Fails with MOD_TIMEOUT when Claude Code doesn't answer in 30 s, and with
     * MODS_OFF when the session isn't attached (Show mods is off, or its Claude Code has no mods).
     */
    'mods.render': { params: ModRenderParams, result: ModRenderResult },
    'mods.press': { params: ModPressParams, result: z.object({ handled: z.boolean() }) },
    'mods.input': { params: ModInputParams, result: z.object({ handled: z.boolean() }) },
    'mods.select': { params: ModSelectParams, result: z.object({ handled: z.boolean() }) },
    'mods.scroll': { params: ModScrollParams, result: ModScrollResult },
    'mods.focus': { params: ModFocusParams, result: ModFocusResult },
    /** The pane roster as Claude Code holds it. */
    'mods.panes': { params: z.object({ sessionId: SessionId }), result: ModPaneRoster },
    /** You picked a pane's tab (`show`), it took the keyboard (`focus`, null when it let go) or you closed it (`close`). */
    'mods.pane': {
      params: z.object({ sessionId: SessionId, action: z.enum(['show', 'focus', 'close']), id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).nullable() }),
      result: z.object({}),
    },
    /** The window's answer to a `mods.promptAsk` (the message box read, filled or given a suggestion). */
    'mods.promptAnswer': { params: ModPromptAnswer, result: z.object({}) },
    /**
     * What mods replaced last time in this profile's sessions, while the plugins and managed settings are the same, so
     * the conversation knows before Claude Code is ready (and the built-in view doesn't flash first). Empty otherwise.
     */
    'mods.hooked': { params: z.object({ profileId: ProfileId }), result: z.object({ hooked: z.array(HookableComponentSchema) }) },
    /** A session's mod log lines (`ui_log`), oldest first. */
    'mods.logs': { params: z.object({ sessionId: SessionId.optional() }), result: z.object({ logs: z.array(ModLog) }) },
    /** Plugins with a mod module, per Claude profile, from their enabled plugins, plugin folders and managed settings (Settings › Mods). */
    'mods.list': { params: z.object({}), result: z.object({ mods: z.array(ModInfo) }) },
  },
  events: {
    'engine.log': LogEntry,
    'sessions.changed': SessionsChanged,
    /** Full replacement of the live-session list whenever the registry changes. */
    'sessions.live': z.object({ live: z.array(LiveSession) }),
    'transcript.updated': TranscriptUpdate,
    'session.host': SessionHostInfo,
    /** Claude Code reported a new model list (replaces the one from `models.list`). */
    'models.changed': z.object({ models: z.array(ModelOption) }),
    'session.stream': StreamDelta,
    /** An answer coming in (`session.ask`), and its end. */
    'session.ask': AskEvent,
    'session.permission': PermissionRequest,
    'session.permissionResolved': z.object({ requestId: z.string(), sessionId: z.string() }),
    /** Output for an attached terminal (batched). */
    'terminal.data': z.object({ id: z.string(), data: z.string() }),
    'usage.changed': z.object({ profileId: z.string(), usage: UsageSnapshot.nullable() }),
    /**
     * New token numbers were read from transcripts for the profiles in `profileIds` (all that share the config folder
     * that was read): ask for the breakdown again. `scan` is the first read's progress, null once it is done.
     */
    'usage.tokens': z.object({ profileIds: z.array(z.string()), scan: UsageScan.nullable() }),
    /** Full list whenever profiles are added, changed or removed, or the default changes. */
    'profiles.changed': ProfilesSnapshot,
    /** Full list whenever terminals start, exit or close. */
    'terminals.changed': z.object({ terminals: z.array(TerminalInfo) }),
    'claudeUpdate.changed': ClaudeUpdateState,
    /** Worktree sizes measured in the background (`worktrees.size`), as they finish. */
    'worktrees.sizes': z.object({ sizes: z.array(WorktreeSize) }),
    /** A `git.prCreate` moved on: pushing, creating, done or failed. */
    'git.pr': PrProgress,
    /** A pull request's checks were read (`git.prChecks`, or the engine reading running ones again). */
    'git.checks': PrChecks,
    /** A session's pull request's checks all finished after some were running: main's notifier says so. */
    'git.checksFinished': ChecksFinished,
    /** The whole queue, in order, whenever an item is added, moved, changed, started or removed. */
    'later.changed': z.object({ items: z.array(LaterItem), started: z.array(QueueStarted), auto: QueueAuto }),
    /** A queued item started by itself (main's notifier says so; a click opens the session). */
    'later.autoStarted': z.object({ itemId: z.string(), sessionId: z.string(), prompt: z.string(), cwd: z.string(), projectName: z.string() }),
    /**
     * A queued item that starts by itself didn't, because the session it waited for ended with an error or was
     * stopped. It stays in the queue, ready.
     */
    'later.autoSkipped': z.object({ itemId: z.string(), prompt: z.string(), sessionId: z.string(), title: z.string(), outcome: z.enum(['error', 'stopped']) }),
    /** Every schedule, after any change and after each run. */
    'schedules.changed': z.object({ schedules: z.array(Schedule), sessions: z.array(ScheduleSession) }),
    /**
     * Schedules ran (at their time, as missed runs at a start or a wake, or Run now): main's notifier says so, one
     * notification for several missed runs.
     */
    'schedules.ran': z.object({ runs: z.array(ScheduleRunEvent) }),
    /** Every trigger with its events, after any change and after a check that found something. */
    'triggers.changed': TriggersState,
    /** A triggered session started, an issue was picked up, or a trigger paused: main's notifier says so. */
    'triggers.notice': z.object({ notices: z.array(TriggerNotice) }),
    /** Pipelines were saved, deleted or imported: the built-ins and yours. */
    'pipelines.changed': z.object({ pipelines: z.array(Pipeline) }),
    /** A run changed: a step started or ended, it waits for you, or it ended. */
    'runs.changed': z.object({ state: PipelineRunState }),
    /** A run was deleted (`runs.delete`). */
    'runs.removed': z.object({ runId: z.string() }),
    /** A step needs you, a run stopped, or one is done: main's notifier says so. */
    'runs.notice': z.object({ notice: PipelineNotice }),
    /** A session's Up next changed; an empty `queue` means nothing is waiting. */
    'upNext.changed': z.object({ sessionId: z.string(), queue: z.array(QueuedMessage) }),
    /** A profile hit or left a usage limit, or a resume was armed, fired or gave up. */
    'limits.changed': LimitsState,
    /** A session armed with Resume when it resets was sent its message after the reset (for the notification). */
    'limits.resumed': z.object({ sessionId: z.string() }),
    /** Skills were reloaded: ask for slash command lists again. */
    'commands.changed': z.object({}),
    /** Actions changed (saved, deleted, or the shared file changed, as after a pull): `root` null for global ones. */
    'actions.changed': z.object({ root: z.string().nullable() }),
    /** Saved prompts changed (saved, moved, deleted, or the shared file changed, as after a pull): `root` null for global ones. */
    'savedPrompts.changed': z.object({ root: z.string().nullable() }),
    /** Settings were imported: reload projects and actions. */
    'settings.imported': z.object({}),
    /** A clone (`projects.clone`) moved on: its progress, then done, failed or cancelled. */
    'projects.cloneProgress': CloneProgress,
    /** Settings › Projects › Clone from GitHub changed (in any window). */
    'projects.cloneSettings': CloneSettings,
    /**
     * Context from the VS Code companion, for this window to add as chips (to a session's message box, or New session
     * on a folder) and confirm with `companion.received`. Sent to the window that reported focus last.
     */
    'companion.context': z.object({ deliveryId: z.string(), target: CompanionTarget, items: ContextItems, reveal: z.boolean() }),
    /** The companion asked to show a session (its status bar item): select it and bring the window forward. */
    'companion.reveal': z.object({ sessionId: z.string() }),
    /** A session's catch-up was made, refreshed or cleared (null: a new message or turn started). */
    'catchup.changed': z.object({ sessionId: z.string(), catchUp: CatchUp.nullable() }),
    /** Settings › Remote changed: listening, devices, connections, pairing. */
    'remote.changed': RemoteStatus,
    /**
     * A prompt or an answer to a permission prompt came from a paired device, for its label in the conversation and
     * the sidebar's last action. `device` is its name (kept for older callers), `deviceId` the device itself; `answer`
     * is set for an answer (`requestId` set): the tool it was about and whether it was allowed.
     */
    'remote.fromDevice': z.object({
      sessionId: z.string(),
      messageUuid: z.string().nullable(),
      requestId: z.string().nullable(),
      device: z.string(),
      deviceId: z.string(),
      answer: z.object({ toolName: z.string(), allowed: z.boolean() }).nullable().default(null),
    }),
    /** Paired computers: their connections and pairing. */
    'computers.changed': ComputersStatus,
    /** An event from a connected computer (`sessions.changed`, `transcript.updated`, `session.stream`, …). */
    'computers.event': ComputerEvent,
    /** A project's memory or instruction files changed (`root` null: the personal folder): list them again. */
    'memory.changed': z.object({ root: z.string().nullable() }),
    /** A session's mods surface changed: supported, attached, what mods replace, prompt screening. */
    'mods.state': ModsSurfaceState,
    /** A mod's toast (the last 20 per session are kept). */
    'mods.toast': ModToast,
    /** A session's statuses, one per mod, whenever one changes. */
    'mods.statuses': z.object({ sessionId: z.string(), statuses: z.array(ModStatus) }),
    'mods.log': ModLog,
    /** Draw these instances again (all of them when `instances` is null). */
    'mods.invalidate': z.object({ sessionId: z.string(), instances: z.array(ModInstance).nullable() }),
    'mods.panes': z.object({ sessionId: z.string(), roster: ModPaneRoster }),
    /** A mod scrolled a band or pane. */
    'mods.scroll': z.object({ sessionId: z.string(), component: ModSite, instanceId: z.string(), offset: z.number().int(), followEnd: z.boolean() }),
    /** A mod moved the focus ring to one of its elements. */
    'mods.focus': z.object({ sessionId: z.string(), component: ModSite, instanceId: z.string(), plugin: z.string(), key: z.string() }),
    /** Claude Code asks a session's message box (answer with `mods.promptAnswer`; the window showing the session answers). */
    'mods.promptAsk': ModPromptAsk,
  },
} as const satisfies ContractShape;

export type Contract = typeof contract;
