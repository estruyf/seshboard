import { z } from 'zod';
import { AbsolutePath } from './absolutePath.ts';
import { Effort, PermissionMode } from './host.ts';
import { SessionOutcome } from './later.ts';
import { PIPELINE_LIMITS, pipelineIssues } from './pipelines.ts';

// Pipelines (#179): what is stored and sent. The rules (what starts next, verdicts, the prompt a step gets, the
// sidebar's tree) are in `pipelines.ts`, without zod, for the UI.

const StepName = z.string().trim().min(1).max(PIPELINE_LIMITS.name);

/** How a `claude` step starts: a new session, or a fork of an earlier step's latest sub-session (its context and cache). */
export const PipelineStart = z.union([z.literal('fresh'), z.object({ fork: StepName })]);
export type PipelineStart = z.infer<typeof PipelineStart>;

/** A step ends with `Verdict: pass` or `Verdict: changes needed`. Changes go to `sendTo`, and the step runs again, `rounds` times at most. */
export const PipelineVerdict = z.object({
  sendTo: StepName,
  rounds: z.number().int().min(PIPELINE_LIMITS.rounds.min).max(PIPELINE_LIMITS.rounds.max),
});
export type PipelineVerdict = z.infer<typeof PipelineVerdict>;

/** A step that is a sub-session: Claude Code with its own model, effort, mode and prompt. */
export const PipelineClaudeStep = z.object({
  kind: z.literal('claude'),
  name: StepName,
  start: PipelineStart.default('fresh'),
  /** Null: the project's default. */
  model: z.string().max(200).nullable().default(null),
  effort: Effort.nullable().default(null),
  permissionMode: PermissionMode.nullable().default(null),
  /** Only tools that read (`isReadOnlyTool`): plan mode would end in a plan to approve. */
  readOnly: z.boolean().default(false),
  /** With `{{task}}`, `@parent` and `@<earlier step>`. */
  prompt: z.string().max(PIPELINE_LIMITS.prompt).default(''),
  /** Project actions run in the run's folder before Claude starts, by name; their results go in the prompt. */
  actionsFirst: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  verdict: PipelineVerdict.nullable().default(null),
  /** The run waits for you (Continue) before this step starts. */
  confirmBefore: z.boolean().default(false),
});
export type PipelineClaudeStep = z.infer<typeof PipelineClaudeStep>;

/** Switchboard's own last step: commit, push and Create pull request, no model. It waits for you unless `autoPush`. */
export const PipelinePushStep = z.object({
  kind: z.literal('push'),
  name: StepName,
  /** Open the pull request as a draft. */
  draft: z.boolean().default(false),
});
export type PipelinePushStep = z.infer<typeof PipelinePushStep>;

export const PipelineStep = z.discriminatedUnion('kind', [PipelineClaudeStep, PipelinePushStep]);
export type PipelineStep = z.infer<typeof PipelineStep>;

/** Where a pipeline shows: one project's, or every project's. */
export const PipelineScope = z.discriminatedUnion('kind', [z.object({ kind: z.literal('project'), root: AbsolutePath }), z.object({ kind: z.literal('all') })]);
export type PipelineScope = z.infer<typeof PipelineScope>;

const PipelineFields = z.object({
  name: z.string().trim().min(1).max(PIPELINE_LIMITS.pipelineName),
  scope: PipelineScope,
  steps: z.array(PipelineStep).min(1).max(PIPELINE_LIMITS.steps),
  /** Push without asking. Only for your own pipelines. */
  autoPush: z.boolean().default(false),
});

/** A saved pipeline. Built-ins can't be changed, only duplicated. */
export const Pipeline = PipelineFields.extend({
  id: z.string().min(1).max(100),
  builtIn: z.boolean().default(false),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Pipeline = z.infer<typeof Pipeline>;

/** A pipeline as the editor saves it: no `id` makes a new one. Refused while `pipelineIssues` finds any. */
export const PipelineSave = PipelineFields.extend({ id: z.string().min(1).max(100).optional() }).superRefine((pipeline, ctx) => {
  for (const issue of pipelineIssues(pipeline)) ctx.addIssue({ code: 'custom', message: issue.message, path: issue.step === null ? ['steps'] : ['steps', issue.step] });
});
export type PipelineSave = z.infer<typeof PipelineSave>;

/**
 * How a run stands. `running`: a step works (or waits for a slot or a reset, `hold`). `waiting`: it stopped for you,
 * with `reason`. `paused`: Switchboard quit while it ran; it goes on at the next start. `stopped` and `done` are the end.
 */
export const PipelineRunStatus = z.enum(['running', 'waiting', 'stopped', 'paused', 'done']);
export type PipelineRunStatus = z.infer<typeof PipelineRunStatus>;

/** What the run waits for: you to look (a stop), a step with `confirmBefore`, or Push. */
export const PipelineWait = z.enum(['you', 'confirm', 'push']);
export type PipelineWait = z.infer<typeof PipelineWait>;

/** A step's verdict, read from its last reply (`readVerdict`). */
export const StepVerdict = z.object({
  kind: z.enum(['pass', 'changes']),
  /** The list after the verdict line, one item each. */
  items: z.array(z.string().max(500)).max(50),
});
export type StepVerdict = z.infer<typeof StepVerdict>;

/** A project action that ran before a step: its exit code and the end of its output. */
export const StepActionResult = z.object({
  name: z.string().max(200),
  /** Null: it couldn't run (no such action here, or not approved), with why in `tail`. */
  exitCode: z.number().int().nullable(),
  /** The last lines of its output. */
  tail: z.string().max(20_000),
  ms: z.number().int().min(0),
});
export type StepActionResult = z.infer<typeof StepActionResult>;

/** A run of a pipeline: the parent, the one folder every step works in, and where it is. */
export const PipelineRun = z.object({
  id: z.string().min(1).max(100),
  pipelineId: z.string().min(1).max(100),
  /** The pipeline as it was when the run started: editing it later doesn't change this run. */
  pipeline: Pipeline,
  /** The session it started from; null for a run row (started from New session). */
  parentSessionId: z.string().nullable(),
  /** What you typed in New session (`{{task}}`); null when it started from a session. */
  task: z.string().max(PIPELINE_LIMITS.prompt).nullable(),
  /** The run row's title, or the parent session's at the start. */
  title: z.string().max(300),
  projectRoot: z.string(),
  /** The folder every step works in (a worktree made for the run, or the parent's). */
  cwd: z.string(),
  profileId: z.string().nullable(),
  status: PipelineRunStatus,
  /** Why it waits or stopped, in a sentence ("Validate has no verdict"); null while it runs. */
  reason: z.string().max(500).nullable(),
  waitingFor: PipelineWait.nullable(),
  /** Why the next step hasn't started though nothing else holds it: the focus limit, or a usage limit. */
  hold: z.enum(['focus', 'limit']).nullable(),
  /** The current step's index in `pipeline.steps`, and its round. */
  step: z.number().int().min(0),
  round: z.number().int().min(1),
  /** The changes of a verdict went to this step: when its turn ends cleanly, `step` runs again as `round`. */
  sentBackTo: z.number().int().min(0).nullable(),
  /** The pull request Push opened. */
  pr: z.object({ number: z.number().int(), url: z.string() }).nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  endedAt: z.number().nullable(),
  /** A run row archived by hand (with its tree), and unarchived: as a session's flags. A parent session has its own. */
  archivedAt: z.number().nullable().default(null),
  restoredAt: z.number().nullable().default(null),
});
export type PipelineRun = z.infer<typeof PipelineRun>;

export const PipelineStepStatus = z.enum(['working', 'waiting', 'done', 'failed', 'skipped', 'stopped']);
export type PipelineStepStatus = z.infer<typeof PipelineStepStatus>;

/** One round of one step: a sub-session (none for Push). */
export const PipelineRunStep = z.object({
  runId: z.string(),
  /** The step's name, and its index in the run's pipeline. */
  step: z.string(),
  index: z.number().int().min(0),
  round: z.number().int().min(1),
  sessionId: z.string().nullable(),
  status: PipelineStepStatus,
  outcome: SessionOutcome.nullable(),
  verdict: StepVerdict.nullable(),
  /** Why it failed or waits, or what it did ("plan approved", "Pull request #152 opened"). */
  reason: z.string().max(500).nullable(),
  /** The approved plan (`ExitPlanMode`'s input) of a step in plan mode. */
  plan: z.string().max(PIPELINE_LIMITS.prompt).nullable(),
  /** The project actions that ran first. */
  actions: z.array(StepActionResult).max(10),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
});
export type PipelineRunStep = z.infer<typeof PipelineRunStep>;

/** A run with its steps, as the windows get it. */
export const PipelineRunState = z.object({ run: PipelineRun, steps: z.array(PipelineRunStep) });
export type PipelineRunState = z.infer<typeof PipelineRunState>;

/** What Push shows before it runs: the message Haiku wrote from the diff, how many files, and where it goes. */
export const PushPreview = z.object({
  message: z.string().max(5_000),
  files: z.number().int().min(0),
  branch: z.string().nullable(),
  base: z.string().nullable(),
  /** Why it can't push (no changes and no commits, not a repository, gh missing), null when it can. */
  problem: z.string().max(500).nullable(),
});
export type PushPreview = z.infer<typeof PushPreview>;

/** Something main's notifier says about a run. */
export const PipelineNotice = z.object({
  kind: z.enum(['needsYou', 'stopped', 'done']),
  runId: z.string(),
  /** The session to open: the step's sub-session, or the parent (null for a run row). */
  sessionId: z.string().nullable(),
  title: z.string().max(300),
  body: z.string().max(500),
});
export type PipelineNotice = z.infer<typeof PipelineNotice>;
