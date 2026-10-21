import { z } from 'zod';
import type { ContractShape } from './rpc.ts';
import { CompanionStatus } from './companion.ts';
import { CatchUp } from './catchUp.ts';
import { ChangedFile } from './git.ts';
import { ClonePlan, CloneProgress } from './clone.ts';
import { AutoTierSchema, BackgroundTask, Effort, ImageAttachment, ModelOption, PermissionDecision, PermissionMode, QueuedMessage, SendMode, StreamDelta } from './host.ts';
import { Pipeline, PipelineRun, PipelineRunStep, PushPreview } from './pipelineSchema.ts';
import { ProfileColor } from './profiles.ts';
import { MAX_PROMPT_LENGTH } from './promptConstants.ts';
import { MAX_SIDE_QUESTION_LENGTH } from './sideQuestionConstants.ts';
import { AskEvent, AskThreadList } from './sideQuestions.ts';
import { REMOTE_ATTACHMENT_BYTES, REMOTE_DEVICE_NAME_MAX, REMOTE_IMAGE_BYTES, REMOTE_MAX_FILES, REMOTE_MAX_IMAGES } from './remoteConstants.ts';
import { RemoteLimitStanding } from './usageLimit.ts';
import { UsageBreakdown, UsageGroup, UsagePeriod, UsageRow, UsageSnapshot, WindowCost } from './usage.ts';

/**
 * Remote's contracts: what a paired phone may ask the engine, and the one request of a phone that is pairing. They
 * are their own contracts, not the app's: a new method in `contract.ts` never becomes reachable from a phone by
 * accident. Each result is a smaller remote type, without what a phone has no use for (other profiles' paths,
 * settings, the environment). See docs/remote-access.md.
 */

const SessionId = z.string().min(1).max(200);
const Prompt = z.string().trim().min(1).max(MAX_PROMPT_LENGTH);
/** A project as the phone knows it: an opaque id, never its path. */
const ProjectId = z.string().regex(/^[a-f0-9]{16}$/);
const ProfileId = z.string().min(1).max(100);
/** The name a phone gives itself while pairing ("Elio's iPhone"). */
export const DeviceName = z.string().trim().min(1).max(REMOTE_DEVICE_NAME_MAX);

/** A Claude profile as a session row shows it: its colour and name. */
export const RemoteSessionProfile = z.object({ id: z.string(), name: z.string(), color: ProfileColor });
export type RemoteSessionProfile = z.infer<typeof RemoteSessionProfile>;

export const RemoteSession = z.object({
  id: z.string(),
  title: z.string(),
  projectId: ProjectId,
  projectName: z.string(),
  branch: z.string().nullable(),
  status: CompanionStatus,
  updatedAt: z.number(),
  /**
   * When its turn began (Claude Code's registry: when it went busy), which the Working section orders by: the last
   * write moves all the time. Null when not known; left out by a Switchboard from before phones ordered by it.
   */
  workingSince: z.number().nullable().optional(),
  /** Finished since you last looked, on any device: the title shows in bold. */
  unread: z.boolean(),
  pinned: z.boolean(),
  /** While it runs in Switchboard: its model, effort and permission mode, for the chips in the message box. */
  model: z.string().nullable(),
  /** Null: the model's own. Left out by a Switchboard from before a phone could change it. */
  effort: Effort.nullable().optional(),
  permissionMode: PermissionMode.nullable(),
  /** The Claude profile (login) it runs with; null while there is only one profile (the app shows none then), or not known. */
  profile: RemoteSessionProfile.nullable(),
  /**
   * Auto picked the model it started on, until you change the model: what it picked (null: picking failed, the default
   * model), or `choosing` while it still picks. Null without Auto; left out by a Switchboard from before phones knew it.
   */
  auto: z.object({ picked: AutoTierSchema.nullable(), choosing: z.boolean() }).nullable().optional(),
  /**
   * What it keeps running after its turn (a shell command, an agent, a workflow), while it runs in Switchboard; each
   * can be stopped with `session.stopTask`. Left out by a Switchboard from before phones knew them.
   */
  background: z.array(BackgroundTask).optional(),
  /**
   * The session or run row it sits under: a pipeline step's sub-session under the session the run started from, or
   * under its run (a run row's id, `RemoteRun.id`). Null on its own; left out by a Switchboard from before phones knew runs.
   */
  parentId: z.string().nullable().optional(),
});
export type RemoteSession = z.infer<typeof RemoteSession>;

/** A pipeline as a phone knows it: its steps, without where it is saved (a project's folder). */
export const RemotePipeline = Pipeline.omit({ scope: true });
export type RemotePipeline = z.infer<typeof RemotePipeline>;

/** A pipeline run as a phone sees it: its project as an id and a name, never its folders or its profile's. */
export const RemoteRun = PipelineRun.omit({ pipeline: true, projectRoot: true, cwd: true, profileId: true }).extend({
  pipeline: RemotePipeline,
  projectId: ProjectId,
  projectName: z.string(),
  /** Its steps work in a worktree, not the project's folder. */
  worktree: z.boolean(),
});
export type RemoteRun = z.infer<typeof RemoteRun>;

/** One round of one step, without the approved plan and the output of the actions that ran first. */
export const RemoteRunStep = PipelineRunStep.omit({ plan: true, actions: true });
export type RemoteRunStep = z.infer<typeof RemoteRunStep>;

/** A run with its steps, as the app's `PipelineRunState`. */
export const RemoteRunState = z.object({ run: RemoteRun, steps: z.array(RemoteRunStep) });
export type RemoteRunState = z.infer<typeof RemoteRunState>;

/** A permission prompt, question or plan waiting for an answer, as the card on the Mac shows it. */
export const RemotePrompt = z.object({
  requestId: z.string(),
  sessionId: z.string(),
  toolName: z.string(),
  input: z.json(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  /** What "Always allow" would do; null when not offered. */
  alwaysLabel: z.string().nullable(),
  createdAt: z.number(),
});
export type RemotePrompt = z.infer<typeof RemotePrompt>;

export const RemoteSessions = z.object({
  /** Needs you first, then working, then the most recent. */
  sessions: z.array(RemoteSession),
  /** What those sessions wait on you for, oldest first. */
  prompts: z.array(RemotePrompt),
  /**
   * The pipeline runs of the sessions listed, and the run rows (runs started from New session) the sidebar lists,
   * newest first. With `REMOTE_FEATURE_PIPELINES`.
   */
  runs: z.array(RemoteRunState).optional(),
});
export type RemoteSessions = z.infer<typeof RemoteSessions>;

export const RemoteProject = z.object({ id: ProjectId, name: z.string() });
export type RemoteProject = z.infer<typeof RemoteProject>;

/** A transcript block for the phone: images are only a placeholder, tool output is plain text. */
export const RemoteBlock = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('thinking'), text: z.string() }),
  z.object({ type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.json(), truncated: z.boolean() }),
  z.object({ type: z.literal('tool_result'), toolUseId: z.string(), isError: z.boolean(), text: z.string(), truncated: z.boolean() }),
  z.object({ type: z.literal('image') }),
  z.object({ type: z.literal('unknown'), kind: z.string() }),
]);
export type RemoteBlock = z.infer<typeof RemoteBlock>;

export const RemoteMessage = z.object({
  uuid: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  timestamp: z.number().nullable(),
  parentToolUseId: z.string().nullable(),
  blocks: z.array(RemoteBlock),
  /** The paired phone that sent it, for your own messages sent from a phone. */
  device: z.string().optional(),
});
export type RemoteMessage = z.infer<typeof RemoteMessage>;

export const RemoteTranscriptUpdate = z.object({
  sessionId: z.string(),
  mode: z.enum(['append', 'replace']),
  messages: z.array(RemoteMessage),
});
export type RemoteTranscriptUpdate = z.infer<typeof RemoteTranscriptUpdate>;

/**
 * The permission modes a phone may pick. The others (don't ask, bypass permissions) let Claude run anything without
 * asking: they are only offered on the computer.
 */
export const RemotePermissionMode = z.enum(['default', 'acceptEdits', 'plan', 'auto']);
export type RemotePermissionMode = z.infer<typeof RemotePermissionMode>;

/** What a phone may choose for a new session; anything left out is the project's default, then its profile's. */
export const RemoteSessionOptions = z.object({
  /** The Claude profile to run with, for this session only; left out: the project's, else the default. */
  profileId: ProfileId.optional(),
  model: z.string().min(1).max(200).nullable().optional(),
  effort: Effort.nullable().optional(),
  permissionMode: RemotePermissionMode.optional(),
  /** In a new worktree (true) or the project's folder (false). */
  worktree: z.boolean().optional(),
  /**
   * In the project's folder: a local branch to check out first (one `projects.branches` lists), with
   * `REMOTE_FEATURE_BRANCHES`. Left out, the session starts on what is checked out. Not with a worktree.
   */
  checkoutBranch: z.string().min(1).max(250).optional(),
});
export type RemoteSessionOptions = z.infer<typeof RemoteSessionOptions>;

/** A project's or a profile's defaults for new sessions (null: not set there). */
export const RemoteDefaults = z.object({ model: z.string().nullable(), effort: Effort.nullable(), permissionMode: PermissionMode.nullable(), worktree: z.boolean().nullable() });
export type RemoteDefaults = z.infer<typeof RemoteDefaults>;

/** A Claude profile (login) as a phone knows it: its name and colour, never its folder or account. */
export const RemoteProfile = z.object({ id: z.string(), name: z.string(), color: ProfileColor, defaults: RemoteDefaults });
export type RemoteProfile = z.infer<typeof RemoteProfile>;

/**
 * New session's choices: the models, efforts and profiles, and each project's profile and defaults. A new session
 * takes the project's defaults, then its profile's, then Switchboard's own.
 */
export const RemoteOptions = z.object({
  models: z.array(ModelOption.pick({ value: true, displayName: true, description: true, supportsEffort: true })),
  efforts: z.array(Effort),
  modes: z.array(RemotePermissionMode),
  profiles: z.array(RemoteProfile),
  /** The profile of projects without one of their own. */
  defaultProfileId: z.string(),
  /**
   * Auto model (Settings › Conversation): when on, New session offers Auto, and Haiku picks one of `allowed` from the
   * first prompt. Off, a default of Auto starts on the default model. Left out by a Switchboard from before phones knew it.
   */
  auto: z.object({ enabled: z.boolean(), allowed: z.array(AutoTierSchema) }).optional(),
  projects: z.array(
    z.object({
      id: ProjectId,
      /** The project's own profile (null: the default). */
      profileId: z.string().nullable(),
      defaults: RemoteDefaults,
    }),
  ),
});
export type RemoteOptions = z.infer<typeof RemoteOptions>;

/** The local branches of a project's folder, most recent first; empty outside a git repository. */
export const RemoteBranches = z.object({
  /** What is checked out there now; null when detached or not a repository. */
  current: z.string().nullable(),
  branches: z.array(z.string()),
  /** Checked out in another worktree: git won't check them out in the project's folder too. */
  checkedOutElsewhere: z.array(z.string()),
});
export type RemoteBranches = z.infer<typeof RemoteBranches>;

/** A changed file in the session's checkout. */
export const RemoteChangedFile = ChangedFile.pick({ path: true, status: true, additions: true, deletions: true });
export type RemoteChangedFile = z.infer<typeof RemoteChangedFile>;

/** A browser's push subscription (`PushSubscription.toJSON()`), checked by the engine against the known push services. */
export const RemotePushSubscription = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2_000),
  keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{16,40}$/) }),
});
export type RemotePushSubscription = z.infer<typeof RemotePushSubscription>;

/** A device's own VAPID key pair, both base64url: the uncompressed P-256 point (65 bytes) and the private scalar (32). */
export const RemoteVapidKeys = z.object({ publicKey: z.string().regex(/^[A-Za-z0-9_-]{87}$/), privateKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export type RemoteVapidKeys = z.infer<typeof RemoteVapidKeys>;

/** An image a phone sends with a message: the app's attachment, smaller. */
export const RemoteImage = ImageAttachment.extend({ data: z.string().min(1).max(REMOTE_IMAGE_BYTES) });
export type RemoteImage = z.infer<typeof RemoteImage>;

/** A file sent with a message, as it is: its name (no folders) and its bytes in base64. */
export const RemoteFile = z.object({
  name: z.string().trim().min(1).max(200).regex(/^[^/\\]+$/, 'A file name without folders'),
  data: z.string().min(1).max(REMOTE_ATTACHMENT_BYTES),
});
export type RemoteFile = z.infer<typeof RemoteFile>;

/**
 * A Claude profile's plan usage, for the remote app's Home: its name and colour (never its account), the 5-hour and
 * weekly windows, and why there are no numbers when the last check failed.
 */
export const RemoteProfileUsage = z.object({
  profile: RemoteSessionProfile,
  /** Null without a claude.ai plan, or before the first check. */
  usage: UsageSnapshot.nullable(),
  error: z.string().nullable(),
  /**
   * The account it signs in to as `accountTag` (never the account, nor the key `usage.tokens` takes): the same on
   * every computer, so Home shows a profile once when several computers sign in to it. Null without an account; left
   * out by a Switchboard from before.
   */
  account: z.string().nullable().optional(),
});
export type RemoteProfileUsage = z.infer<typeof RemoteProfileUsage>;

/** A row of `usage.tokens`: as on the computer, with its project's id and name instead of its folder. */
export const RemoteUsageRow = UsageRow.omit({ projectRoot: true }).extend({
  /** The project's id (`projects.list` has the ones you added); null outside a project. */
  projectId: ProjectId.nullable(),
  /** The project's name, or its folder's; null outside a project. */
  projectName: z.string().nullable(),
});
export type RemoteUsageRow = z.infer<typeof RemoteUsageRow>;

/** Where an account's tokens went on the computer in a period, as the Usage view's Tokens tab shows it there. */
export const RemoteUsageBreakdown = UsageBreakdown.omit({ rows: true }).extend({ rows: z.array(RemoteUsageRow) });
export type RemoteUsageBreakdown = z.infer<typeof RemoteUsageBreakdown>;

/** A clone's progress on the computer, with the project's id instead of its folder. */
export const RemoteCloneProgress = CloneProgress.omit({ root: true }).extend({ projectId: ProjectId.nullable() });
export type RemoteCloneProgress = z.infer<typeof RemoteCloneProgress>;

/** The most lines `changes.diff` returns. */
export const REMOTE_DIFF_LINES = 2_000;

const RunId = z.string().min(1).max(100);
const RunParams = z.object({ runId: RunId });
const RunResult = z.object({ state: RemoteRunState });

/** The most messages one `transcript.get` returns. */
export const REMOTE_PAGE_LIMIT = 200;

export const remoteContract = {
  requests: {
    /** The first request on a connection, after the handshake. */
    hello: {
      params: z.object({ client: z.object({ version: z.string().max(50) }) }),
      result: z.object({
        app: z.object({ version: z.string() }),
        device: z.object({ id: z.string(), name: z.string() }),
        /** What people call the computer ("Elio's iMac"), for the connection chip and the offline help. */
        computer: z.object({ name: z.string() }),
        /** What it takes beyond what every version does (`REMOTE_FEATURE_ATTACHMENTS`); missing from an older one. */
        features: z.array(z.string().max(50)).max(50).default([]),
        /**
         * The app icon colourway the remote app shows (`AppIconKey`; Settings › Theme › App icon there), Graphite
         * while "Use it on your phone too" is off. Missing from an older one, and a key the phone doesn't know, is Graphite.
         */
        appIcon: z.string().max(50).optional(),
      }),
    },
    'sessions.list': { params: z.object({}), result: RemoteSessions },
    'projects.list': { params: z.object({}), result: z.object({ projects: z.array(RemoteProject) }) },
    /** The branches New session offers for the project's folder, read from git each time. With `REMOTE_FEATURE_BRANCHES`. */
    'projects.branches': { params: z.object({ projectId: ProjectId }), result: RemoteBranches },
    /**
     * A page of a transcript. Without `before` or `after`, the last `limit` messages. `after` resumes from the last
     * message the phone has: `reset` says that message is gone (a rewind or compaction) and `messages` is the last page.
     */
    'transcript.get': {
      params: z.object({
        sessionId: SessionId,
        before: z.string().max(200).optional(),
        after: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(REMOTE_PAGE_LIMIT).default(50),
      }),
      result: z.object({ messages: z.array(RemoteMessage), hasMore: z.boolean(), reset: z.boolean() }),
    },
    /** From now on, `transcript.updated` for this session (one at a time per phone; watching another stops this one). */
    'transcript.watch': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    'transcript.unwatch': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    /**
     * Sends a prompt, or queues it while Claude is working (`mode`, as on the Mac), with images pasted, dropped or
     * photographed, and files (`REMOTE_FEATURE_ATTACHMENTS`), which the prompt mentions by their path on the computer.
     */
    'session.send': {
      params: z.object({
        sessionId: SessionId,
        text: Prompt,
        mode: SendMode.default('queue'),
        images: z.array(RemoteImage).max(REMOTE_MAX_IMAGES).default([]),
        files: z.array(RemoteFile).max(REMOTE_MAX_FILES).default([]),
      }),
      result: z.object({ queued: z.boolean() }),
    },
    'session.queue.remove': { params: z.object({ sessionId: SessionId, id: z.string().min(1).max(200) }), result: z.object({}) },
    /** Sends one message from Up next now, stopping Claude's turn first; the rest keep waiting. With `REMOTE_FEATURE_QUEUE_SEND_NOW`. */
    'session.queue.sendNow': { params: z.object({ sessionId: SessionId, id: z.string().min(1).max(200) }), result: z.object({}) },
    'session.interrupt': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    /** Stops one of the session's background tasks (`RemoteSession.background`); Claude is told it was stopped. */
    'session.stopTask': { params: z.object({ sessionId: SessionId, taskId: z.string().min(1).max(200) }), result: z.object({}) },
    /** Answers a permission prompt, question or plan. NOT_FOUND when it was already answered. */
    'session.respond': { params: z.object({ requestId: z.string().min(1).max(200), decision: PermissionDecision }), result: z.object({}) },
    /** A new session in a project Switchboard knows. What it leaves out of the options is the project's default. */
    'session.create': {
      params: z
        .object({
          projectId: ProjectId,
          prompt: Prompt,
          /** With `REMOTE_FEATURE_ATTACHMENTS`, as `session.send` takes them. */
          images: z.array(RemoteImage).max(REMOTE_MAX_IMAGES).default([]),
          files: z.array(RemoteFile).max(REMOTE_MAX_FILES).default([]),
        })
        .extend(RemoteSessionOptions.shape),
      result: z.object({ sessionId: z.string() }),
    },
    /** Puts a prompt in Switchboard's queue (Later) for a project, to start when you choose. */
    'later.add': { params: z.object({ projectId: ProjectId, prompt: Prompt }).extend(RemoteSessionOptions.shape), result: z.object({ id: z.string() }) },
    /**
     * Ask about this session, as on the computer: Claude answers from the conversation and the project with read-only
     * tools, beside a turn in progress, and nothing reaches the conversation. Without `threadId` it starts a new thread.
     * The answer comes through `session.ask` events with the returned ids.
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
    /** The questions kept for a session, newest thread first. */
    'session.askThreads': { params: z.object({ sessionId: SessionId }), result: AskThreadList },
    /** Marks a session read, as opening it on the computer does. */
    'session.markRead': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    /** Marks a session unread again: Undo after a swipe marked it read. With `REMOTE_FEATURE_MARK_UNREAD`. */
    'session.markUnread': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    /** Pins or archives a session; an archived one leaves the phone's list. */
    'session.setFlags': { params: z.object({ sessionId: SessionId, pinned: z.boolean().optional(), archived: z.boolean().optional() }), result: z.object({}) },
    /** The model of a running session (null: the default). */
    'session.setModel': { params: z.object({ sessionId: SessionId, model: z.string().min(1).max(200).nullable() }), result: z.object({}) },
    /** The effort of a running session (null: the model's own). */
    'session.setEffort': { params: z.object({ sessionId: SessionId, effort: Effort.nullable() }), result: z.object({}) },
    'session.setPermissionMode': { params: z.object({ sessionId: SessionId, mode: RemotePermissionMode }), result: z.object({}) },
    /** New session's choices. */
    'options.get': { params: z.object({}), result: RemoteOptions },
    /**
     * Plan usage of every Claude profile, the default first. From the computer's last check when it is less than a
     * minute old; `refresh` checks now. `usage.changed` follows each new check.
     */
    'usage.get': { params: z.object({ refresh: z.boolean().default(false) }), result: z.object({ profiles: z.array(RemoteProfileUsage) }) },
    /**
     * Where the tokens of the profile signed in to an account went on the computer, as `usage.breakdown` there.
     * `account` is the account's `accountKey`, so only someone who knows the account can ask, and the answer never
     * names it. `breakdown` is null when no profile there signs in to it. With `REMOTE_FEATURE_USAGE_TOKENS`.
     */
    'usage.tokens': {
      params: z.object({
        account: z.string().regex(/^[a-f0-9]{64}$/),
        period: UsagePeriod,
        groupBy: UsageGroup.default('session'),
        model: z.string().max(200).nullable().default(null),
        timeZone: z.string().max(100).default('UTC'),
      }),
      result: z.object({ breakdown: RemoteUsageBreakdown.nullable() }),
    },
    /**
     * The estimated API cost of a session there since it started (`usage.sessionCost` on that computer), in US dollars.
     * With `REMOTE_FEATURE_COSTS`.
     */
    'usage.sessionCost': {
      params: z.object({ sessionId: SessionId }),
      result: z.object({ cost: z.object({ usd: z.number(), partial: z.boolean() }).nullable() }),
    },
    /**
     * What the tokens there of the profile signed in to an account would cost in the given plan windows, each from
     * `from` until now: the plan's windows are the account's, so the asking computer says when they began. `account`
     * as in `usage.tokens`; `windows` is null when no profile there signs in to it. With `REMOTE_FEATURE_COSTS`.
     */
    'usage.windowCosts': {
      params: z.object({
        account: z.string().regex(/^[a-f0-9]{64}$/),
        windows: z.array(z.object({ kind: z.string().max(100), scope: z.string().max(200).nullable(), from: z.number() })).max(10),
      }),
      result: z.object({ windows: z.array(WindowCost).nullable() }),
    },
    /** The catch-up of a session's last turn, without paths outside its project. */
    'catchup.get': { params: z.object({ sessionId: SessionId }), result: z.object({ catchUp: CatchUp.nullable() }) },
    /** What changed in the session's checkout (its worktree when it has one), not committed yet. */
    'changes.get': {
      params: z.object({ sessionId: SessionId }),
      result: z.object({ branch: z.string().nullable(), files: z.array(RemoteChangedFile), error: z.string().nullable() }),
    },
    /** One changed file's unified diff, at most `REMOTE_DIFF_LINES` lines. Only files `changes.get` lists. */
    'changes.diff': { params: z.object({ sessionId: SessionId, path: z.string().min(1).max(4096) }), result: z.object({ diff: z.string(), truncated: z.boolean() }) },
    /**
     * Commits every change in the session's checkout, without a terminal. A failed commit (a hook said no) is not an
     * error: `output` has the last lines of what it printed. It never pushes.
     */
    'changes.commit': {
      params: z.object({ sessionId: SessionId, message: z.string().trim().min(1).max(20_000) }),
      result: z.discriminatedUnion('ok', [z.object({ ok: z.literal(true), sha: z.string() }), z.object({ ok: z.literal(false), output: z.string() })]),
    },
    /**
     * Clone from GitHub on the computer, in its own Clone into folder (`REMOTE_FEATURE_CLONE`): where it would go, and
     * whether its setting is on (`off` otherwise).
     */
    'projects.clonePlan': { params: z.object({ url: z.string().max(2_000), name: z.string().max(255).optional() }), result: ClonePlan },
    /** Clones and adds the project there; `projects.cloneProgress` reports to this connection, as on the computer. */
    'projects.clone': { params: z.object({ jobId: z.string().min(1).max(100), url: z.string().max(2_000), name: z.string().min(1).max(255) }), result: z.object({}) },
    'projects.cancelClone': { params: z.object({ jobId: z.string().min(1).max(100) }), result: z.object({}) },
    /** The pipelines a project can run there: the built-ins (unless hidden there), every project's, and its own. With `REMOTE_FEATURE_PIPELINES`. */
    'pipelines.list': { params: z.object({ projectId: ProjectId }), result: z.object({ pipelines: z.array(RemotePipeline) }) },
    /**
     * Runs a pipeline, as on the computer: from a session the list shows (it becomes the parent), or from New session
     * with a task in a project (a run row is the parent), with images and files as `session.create` takes them and the
     * message box's choices for the steps that don't set their own. With `REMOTE_FEATURE_PIPELINES`.
     */
    'pipelines.run': {
      params: z
        .object({
          pipelineId: z.string().min(1).max(100),
          parentSessionId: SessionId.optional(),
          projectId: ProjectId.optional(),
          task: Prompt.optional(),
          images: z.array(RemoteImage).max(REMOTE_MAX_IMAGES).default([]),
          files: z.array(RemoteFile).max(REMOTE_MAX_FILES).default([]),
        })
        .extend(RemoteSessionOptions.pick({ profileId: true, model: true, effort: true, permissionMode: true }).shape)
        .refine((p) => (p.parentSessionId ? !p.projectId && !p.task : p.projectId && p.task), 'From a session, or with a project and a task'),
      result: RunResult,
    },
    /** Continue: the step that waits for you starts (Push, with `message` as the commit message when given), or the run goes on after a stop. */
    'runs.continue': { params: RunParams.extend({ message: z.string().trim().min(1).max(5_000).optional() }), result: RunResult },
    /** Run this step again: a new round of the current step, in a new sub-session. */
    'runs.retryStep': { params: RunParams, result: RunResult },
    /** Another round: a verdict still asking for changes after its rounds sends them once more. */
    'runs.anotherRound': { params: RunParams, result: RunResult },
    /** Skip this step: the next one starts, or waits. */
    'runs.skipStep': { params: RunParams, result: RunResult },
    /** Stop the run: the step that works stops, and nothing starts after it. */
    'runs.stop': { params: RunParams, result: RunResult },
    /** Archives a run's tree (its parent and every sub-session) or unarchives it; refused while the run goes on. */
    'runs.archive': { params: RunParams.extend({ archived: z.boolean() }), result: z.object({}) },
    /** Push's card: the commit message Haiku wrote from the diff (once per run, unless `fresh`), the files and the branches. */
    'runs.pushPreview': { params: RunParams.extend({ fresh: z.boolean().default(false) }), result: z.object({ preview: PushPreview }) },
    /** Writes in a run row: the run gets a session of its own, in its folder, with the run's brief first. */
    'runs.write': { params: RunParams.extend({ text: Prompt }), result: z.object({ sessionId: z.string() }) },
    /** The engine's VAPID public key, for `pushManager.subscribe` (made the first time a phone asks). */
    'push.key': { params: z.object({}), result: z.object({ publicKey: z.string() }) },
    /**
     * Push to this device when a session needs you, finishes, or both; replaces what it had. With
     * `REMOTE_FEATURE_PUSH_KEY`: `vapid`, the key the subscription was made with (the device's own, shared by every
     * computer it is paired with), and `label`, what each push starts with (this computer's name, with more than one).
     */
    'push.subscribe': {
      params: z.object({ subscription: RemotePushSubscription, needsYou: z.boolean(), finished: z.boolean(), vapid: RemoteVapidKeys.optional(), label: z.string().trim().min(1).max(60).optional() }),
      result: z.object({}),
    },
    'push.unsubscribe': { params: z.object({}), result: z.object({}) },
    /**
     * How a session stands with its profile's usage limit (null: not at one). With `REMOTE_FEATURE_LIMITS`;
     * `limits.changed` follows each change for the session the phone watches.
     */
    'limits.get': { params: z.object({ sessionId: SessionId }), result: z.object({ limit: RemoteLimitStanding.nullable() }) },
    /** Resume now: sends the session its resume message at once, as on the computer. */
    'limits.resume': { params: z.object({ sessionId: SessionId }), result: z.object({}) },
    /** Resume when it resets, on or off. */
    'limits.arm': { params: z.object({ sessionId: SessionId, armed: z.boolean() }), result: z.object({}) },
    /** Whether the app is on this device's screen now: no push while it is. Sent after hello and on each change. */
    'device.visibility': { params: z.object({ visible: z.boolean() }), result: z.object({}) },
  },
  events: {
    'sessions.changed': RemoteSessions,
    'transcript.updated': RemoteTranscriptUpdate,
    'session.stream': StreamDelta,
    'upNext.changed': z.object({ sessionId: z.string(), queue: z.array(QueuedMessage) }),
    /** An answer to Ask about this session coming in, and its end: for the session the phone watches, and for questions it asked. */
    'session.ask': AskEvent,
    /** A profile's plan usage changed (a new check on the computer). */
    'usage.changed': z.object({ profileId: z.string(), usage: UsageSnapshot.nullable() }),
    /** The usage limit standing of the session the phone watches changed. */
    'limits.changed': z.object({ sessionId: z.string(), limit: RemoteLimitStanding.nullable() }),
    /** The catch-up of the session the phone watches changed. */
    'catchup.changed': z.object({ sessionId: z.string(), catchUp: CatchUp.nullable() }),
    /** A clone this connection started moved on (`projects.clone`). */
    'projects.cloneProgress': RemoteCloneProgress,
    /** The app icon colourway changed on the computer (as `appIcon` in hello): the open tab swaps its icons. */
    'app.icon': z.object({ key: z.string().max(50) }),
  },
} as const satisfies ContractShape;
export type RemoteContract = typeof remoteContract;

/** The only request a pairing phone can make, once it proved it scanned the QR code. */
export const remotePairContract = {
  requests: {
    /** Resolves once you click Allow on the Mac (fails with DENIED on Deny, a timeout or a closed dialog). */
    'pair.request': {
      params: z.object({ name: DeviceName }),
      result: z.object({ deviceId: z.string() }),
    },
  },
  events: {},
} as const satisfies ContractShape;
export type RemotePairContract = typeof remotePairContract;

// ---------------------------------------------------------------------------
// Settings › Remote, between the engine and the app's windows
// ---------------------------------------------------------------------------

/** The port Remote listens on, on this computer only (`127.0.0.1`); the tunnel forwards to it. */
export const REMOTE_DEFAULT_PORT = 47615;

/**
 * Where the remote app lives: one fixed HTTPS address, so a phone pairs once whatever the tunnel's address is, and
 * the app's code comes from Switchboard's own site rather than from the tunnel. The engine only accepts sockets
 * from this origin.
 */
export const REMOTE_APP_URL = 'https://switchboard.struyfconsulting.com/remote/';

/**
 * The remote app on the website's preview, built from `dev` by Cloudflare Pages. Development and beta builds also
 * accept sockets from it (`previewApp`), so the remote app's next version can be tried before it ships; a release
 * never does, so code that is only on `dev` can't talk to anyone's computer.
 */
export const REMOTE_PREVIEW_APP_URL = 'https://switch-dev.struyfconsulting.com/remote/';

/**
 * How a phone reaches this computer from anywhere:
 *  - `cloudflare`: a Cloudflare quick tunnel (`cloudflared`, no account; a new address each time it starts);
 *  - `ngrok`: an ngrok tunnel (an account; a fixed address with your ngrok domain);
 *  - `tailscale`: `tailscale serve`, only for your own devices on your tailnet (HTTPS certificates must be on);
 *  - `custom`: a tunnel or proxy you run yourself, forwarding your `https://` address to Remote's port.
 */
export const RemoteTunnel = z.enum(['cloudflare', 'ngrok', 'tailscale', 'custom']);
export type RemoteTunnel = z.infer<typeof RemoteTunnel>;

/** An `https://` origin, without a path. */
const HttpsOrigin = z.string().max(300).regex(/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/);

export const RemoteSettings = z.object({
  /** Allow access from my phone. */
  enabled: z.boolean(),
  tunnel: RemoteTunnel,
  /** `custom`: the public address that forwards to Remote's port. */
  customUrl: HttpsOrigin.nullable(),
  /** `ngrok`: your ngrok domain, for an address that doesn't change (`name.ngrok-free.app`). */
  ngrokDomain: z.string().max(253).regex(/^[A-Za-z0-9.-]+$/).nullable(),
  port: z.number().int().min(1024).max(65535),
});
export type RemoteSettings = z.infer<typeof RemoteSettings>;

export const RemoteStatus = z.object({
  /** False when this build doesn't offer Remote. */
  available: z.boolean(),
  settings: RemoteSettings,
  /** The remote app, for the QR codes. */
  appUrl: z.string(),
  /** The engine's public address while the tunnel runs (`https://…`). */
  address: z.string().nullable(),
  tunnel: z.object({
    state: z.enum(['off', 'starting', 'running', 'failed']),
    /** Why it failed, in the tool's own words when it said something. */
    message: z.string().nullable(),
  }),
  /** Which tunnel tools this computer has (`custom` needs none). */
  tools: z.object({ cloudflare: z.boolean(), ngrok: z.boolean(), tailscale: z.boolean() }),
  /** Why Remote isn't running when it should. */
  problem: z
    .discriminatedUnion('kind', [
      /** `suggestedPort`: the next port that was free when Remote tried to start (null: none nearby). */
      z.object({ kind: z.literal('port-in-use'), port: z.number(), suggestedPort: z.number().nullable().default(null) }),
      z.object({ kind: z.literal('tool-missing'), tunnel: RemoteTunnel }),
      z.object({ kind: z.literal('failed'), message: z.string() }),
    ])
    .nullable(),
  /** Paired devices: phones, browsers on a computer, and Switchboard on other computers. */
  devices: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(['phone', 'browser', 'computer']).default('phone'), createdAt: z.number(), lastSeenAt: z.number().nullable() })),
  connections: z.array(z.object({ deviceId: z.string(), name: z.string(), since: z.number() })),
  /**
   * The tunnel came back with a new address that no paired device has used yet: a quick tunnel restarted (Cloudflare,
   * or ngrok without a domain). Settings › Remote then offers Reconnect a paired device. Never for an address that
   * stays the same (your own, ngrok with a domain, Tailscale).
   */
  addressChanged: z.boolean().default(false),
  pairing: z.object({
    offer: z.object({ expiresAt: z.number() }).nullable(),
    request: z.object({ id: z.string(), name: z.string(), code: z.string(), expiresAt: z.number() }).nullable(),
    locked: z.boolean(),
  }),
});
export type RemoteStatus = z.infer<typeof RemoteStatus>;
