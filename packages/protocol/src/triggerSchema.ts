import { z } from 'zod';
import { AbsolutePath } from './absolutePath.ts';
import { Effort, PermissionMode, WorktreeBaseSchema } from './host.ts';
import { MAX_PROMPT_LENGTH } from './promptConstants.ts';
import { DEFAULT_STATE_LABELS, TRIGGER_EVENTS_KEPT, TRIGGER_LIMITS } from './triggers.ts';

// Event triggers (#180): what is stored and sent. The rules (which issues are new, what starts, the state labels) are
// in `triggers.ts`, without zod, for the UI.

const Name = z.string().trim().min(1).max(200);
const LabelName = z.string().trim().min(1).max(50);

/**
 * Where a trigger looks for work. `ci`: failed workflow runs on a branch (null: the repository's default branch), of
 * some workflows (empty: all of them). `issues`: open issues with a label, assigned to someone (`@me`: the account gh
 * is signed in with), or both; at least one of the two is set.
 */
export const TriggerSource = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('ci'),
      branch: z.string().trim().min(1).max(250).nullable().default(null),
      workflows: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
    }),
    z.object({
      kind: z.literal('issues'),
      label: LabelName.nullable().default(null),
      assignee: z.string().trim().min(1).max(100).regex(/^(@me|[A-Za-z0-9-]+(\[bot\])?)$/, 'Pick a GitHub login').nullable().default(null),
      /** Only issues opened by the repository's owners, members and collaborators. */
      collaboratorsOnly: z.boolean().default(true),
    }),
  ])
  .superRefine((source, ctx) => {
    if (source.kind === 'issues' && !source.label && !source.assignee) ctx.addIssue({ code: 'custom', message: 'Pick a label, an assignee, or both.' });
  });
export type TriggerSource = z.infer<typeof TriggerSource>;

/**
 * What a triggered session starts with: New session's choices, like a queued item's. Never bypass permissions: a
 * trigger starts work from text other people wrote, while nobody watches.
 */
export const TriggerDraft = z.object({
  profileId: z.string().min(1).max(100).nullable().default(null),
  model: z.string().max(200).nullable().default(null),
  effort: Effort.nullable().default(null),
  permissionMode: PermissionMode.exclude(['bypassPermissions']).default('default'),
  workspace: z.enum(['current', 'worktree']).default('worktree'),
  baseRef: WorktreeBaseSchema.default('fresh'),
});
export type TriggerDraft = z.infer<typeof TriggerDraft>;

/**
 * What a trigger starts for each event: a session with its draft, or a run of one of the project's pipelines with the
 * event as its task (#185). A trigger saved before pipelines could start reads as a session.
 */
export const TriggerStart = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session') }),
  z.object({
    kind: z.literal('pipeline'),
    pipelineId: z.string().min(1).max(100),
    /** Run without stopping for you: approve plans, start steps that wait for you, answer Claude's questions with "decide". */
    unattended: z.boolean().default(false),
    /** Push commits, pushes and opens the pull request without waiting for you. Merging stays with you. */
    autoPush: z.boolean().default(false),
  }),
]);
export type TriggerStart = z.infer<typeof TriggerStart>;

/** The second label a trigger keeps on an issue, saying where the work is. Off unless turned on. */
export const StateLabels = z.object({
  on: z.boolean().default(false),
  working: LabelName.default(DEFAULT_STATE_LABELS.working),
  needsInput: LabelName.default(DEFAULT_STATE_LABELS.needsInput),
  prOpen: LabelName.default(DEFAULT_STATE_LABELS.prOpen),
  failed: LabelName.default(DEFAULT_STATE_LABELS.failed),
});
export type StateLabels = z.infer<typeof StateLabels>;

/** A trigger: starts a session in its project when its source has a new event. */
export const Trigger = z.object({
  id: z.string().min(1).max(100),
  /** The project it belongs to: its folder, where sessions start (or the worktrees they get). */
  projectRoot: AbsolutePath,
  name: Name,
  source: TriggerSource,
  /** The instruction (a pipeline's task); `{{event.title}}` and the other fields are filled in for each event. */
  prompt: z.string().trim().min(1).max(MAX_PROMPT_LENGTH),
  /** A session, or a pipeline run. */
  start: TriggerStart.default({ kind: 'session' }),
  /** What a session starts with. A pipeline's steps set their own; only the profile is used for a run. */
  draft: TriggerDraft.default(TriggerDraft.parse({})),
  /** How many of its sessions (or runs) may be busy at once. Always 1 for sessions in the project's folder (`effectiveMaxAtOnce`). */
  maxAtOnce: z.number().int().min(TRIGGER_LIMITS.atOnce.min).max(TRIGGER_LIMITS.atOnce.max).default(3),
  /** How many events may wait for a slot; beyond that they are skipped. */
  maxWaiting: z.number().int().min(TRIGGER_LIMITS.waiting.min).max(TRIGGER_LIMITS.waiting.max).default(10),
  /** How often its source is checked, in minutes. */
  intervalMinutes: z.number().int().min(TRIGGER_LIMITS.interval.min).max(TRIGGER_LIMITS.interval.max).default(5),
  stateLabels: StateLabels.default(StateLabels.parse({})),
  /** Assign the issue to you when its work is picked up; issues that already have an assignee are skipped. */
  assignOnPickUp: z.boolean().default(false),
  paused: z.boolean().default(false),
  /** Why Switchboard paused it ("gh is signed out"); null when you paused it, or it runs. */
  pausedReason: z.string().max(300).nullable().default(null),
  /** Checks that failed in a row; five pause it. */
  failures: z.number().int().min(0).default(0),
  /** What the last check that failed said, while it keeps failing. */
  lastError: z.string().max(300).nullable().default(null),
  /** A rate limit stops its checks until then. */
  blockedUntil: z.number().nullable().default(null),
  lastCheckedAt: z.number().nullable().default(null),
  /** When the first check marked what was there as seen; null until it has (a new or resumed trigger). */
  seededAt: z.number().nullable().default(null),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Trigger = z.infer<typeof Trigger>;
export type TriggerInput = z.input<typeof Trigger>;

/** What `triggers.save` takes: a trigger without what Switchboard keeps about its checks. */
export const TriggerSave = Trigger.omit({
  createdAt: true,
  updatedAt: true,
  pausedReason: true,
  failures: true,
  lastError: true,
  blockedUntil: true,
  lastCheckedAt: true,
  seededAt: true,
}).extend({ id: z.string().min(1).max(100).optional() });
export type TriggerSave = z.input<typeof TriggerSave>;

/**
 * What happened to an event. `waiting`: for a slot under `maxAtOnce`. `started`: a session works on it. `queued`: the
 * focus limit or a usage limit held it, so it went to the queue as an item that starts by itself. `skipped`: not
 * started, with the reason (Start anyway). `replaced`: a newer failure of the same workflow took its place.
 */
export const TriggerEventStatus = z.enum(['waiting', 'started', 'queued', 'skipped', 'replaced']);
export type TriggerEventStatus = z.infer<typeof TriggerEventStatus>;

/** One event of a trigger: a failed run, or an issue that newly matched. */
export const TriggerEvent = z.object({
  id: z.string().min(1).max(100),
  triggerId: z.string().min(1).max(100),
  /** What it is told apart by: the workflow and commit of a run, the number of an issue. */
  key: z.string().min(1).max(300),
  kind: z.enum(['ci', 'issue']),
  /** The run's title (its commit's first line) or the issue's. */
  title: z.string().max(500),
  url: z.string().max(1000),
  /** What `{{event.<field>}}` fills in: `number`, `workflow`, `branch`, `commit`, `run`, `author`, `labels`, … */
  fields: z.record(z.string(), z.string().max(2000)).default({}),
  status: TriggerEventStatus,
  /** Why it was skipped or held, in a few words. */
  reason: z.string().max(300).nullable().default(null),
  sessionId: z.string().max(200).nullable().default(null),
  /** The pipeline run that works on it, for a trigger that starts a pipeline. */
  runId: z.string().max(200).nullable().default(null),
  /** The queued item it became (`queued`). */
  itemId: z.string().max(100).nullable().default(null),
  /** The state label Switchboard last put on the issue; null before it did, or with state labels off. */
  label: z.string().max(50).nullable().default(null),
  /** Who has the issue now, when it was assigned to someone else while its session works. */
  reassignedTo: z.string().max(100).nullable().default(null),
  createdAt: z.number(),
  startedAt: z.number().nullable().default(null),
});
export type TriggerEvent = z.infer<typeof TriggerEvent>;

/** A session (or a pipeline's run row) a trigger started: the bolt on its row, and the line in its header. */
export const TriggerSession = z.object({
  /** The session, or the run's id for a pipeline run. */
  sessionId: z.string(),
  triggerId: z.string(),
  eventId: z.string(),
  /** The trigger's name when it started, kept for a trigger deleted since. */
  triggerName: z.string(),
  kind: z.enum(['ci', 'issue']),
  /** "CI #4512" or "#212". */
  ref: z.string(),
  url: z.string(),
  at: z.number(),
});
export type TriggerSession = z.infer<typeof TriggerSession>;

/** What the editor shows about the project's repository: who gh is, the default branch, the workflows. */
export const TriggerRepoInfo = z.object({
  /** `owner/name`; null when the project has no remote on GitHub. */
  repo: z.string().nullable(),
  /** The account gh is signed in with; null when it isn't (or gh is missing). */
  login: z.string().nullable(),
  defaultBranch: z.string().nullable(),
  workflows: z.array(z.string()),
  /** People who can push; null when gh can't tell (you can't see them). */
  collaborators: z.number().int().nullable(),
  /** Why the rest is missing, in words; null when gh answered. */
  problem: z.string().nullable(),
});
export type TriggerRepoInfo = z.infer<typeof TriggerRepoInfo>;

/** What main's notifier hears: a session started, an issue picked up (it waits for a slot), or a trigger paused. */
export const TriggerNotice = z.object({
  kind: z.enum(['started', 'pickedUp', 'paused']),
  triggerId: z.string(),
  triggerName: z.string(),
  /** The trigger's project: a click on the notification opens its Triggers tab. */
  projectRoot: z.string(),
  projectName: z.string(),
  /** The event's kind, for the wording; null for a pause. */
  eventKind: z.enum(['ci', 'issue']).nullable(),
  /** "main", for a CI failure. */
  branch: z.string().nullable(),
  /** "CI #4512" or "#212". */
  ref: z.string().nullable(),
  /** The session's title. */
  title: z.string().nullable(),
  /** The session, or the run's id for a pipeline run. */
  sessionId: z.string().nullable(),
  /** Why it paused. */
  reason: z.string().nullable(),
});
export type TriggerNotice = z.infer<typeof TriggerNotice>;

/** Every trigger with its events (the last `TRIGGER_EVENTS_KEPT` each, and everything waiting) and sessions. */
export const TriggersState = z.object({
  triggers: z.array(Trigger),
  events: z.array(TriggerEvent).max(TRIGGER_EVENTS_KEPT * 1000),
  sessions: z.array(TriggerSession),
});
export type TriggersState = z.infer<typeof TriggersState>;
