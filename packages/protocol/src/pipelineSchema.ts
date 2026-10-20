import { z } from 'zod';
import { AbsolutePath } from './absolutePath.ts';
import { Effort, PermissionMode } from './host.ts';
import { limitSharedPipeline, PIPELINE_LIMITS, sharedPipelineIssues } from './pipelines.ts';
import { PROMPT_NAME_MAX, PROMPT_TEXT_MAX } from './savedPrompts.ts';

// Pipelines (#179): what is stored and sent. The rules (what happens when a step ends, the verdict, the prompts, the
// tree in the sidebar) are in `pipelines.ts`, without zod, for the UI. The design is docs/pipelines.md.

/** A pipeline's name. */
const PipelineName = z.string().trim().min(1, 'Give the pipeline a name').max(PROMPT_NAME_MAX);
/** A step's name: used in `{{step:<name>.reply}}`, so no braces or line breaks. */
const StepName = z
  .string()
  .trim()
  .min(1, 'Give the step a name')
  .max(PIPELINE_LIMITS.stepName)
  .regex(/^[^{}\n\r]+$/, 'A step name can’t have braces or line breaks');

/** How a Claude step starts: a fresh session (with briefs of earlier steps), or a fork of an earlier step's sub-session. */
export const PipelineStart = z.discriminatedUnion('kind', [
  /** `briefOf` names the steps whose briefs go in the prompt; left out, it is the step before (or the parent for the first step). */
  z.object({ kind: z.literal('fresh'), briefOf: z.array(StepName).max(PIPELINE_LIMITS.steps).optional() }),
  z.object({ kind: z.literal('fork'), step: StepName }),
]);
export type PipelineStart = z.infer<typeof PipelineStart>;

/** A step that is one sub-session: a Claude Code session with its own model, effort and permission mode. */
export const ClaudeStep = z.object({
  kind: z.literal('claude'),
  name: StepName,
  /** With `{{task}}`, `{{previous.reply}}`, `{{step:<name>.reply}}` and saved-prompt blanks. */
  prompt: z.string().trim().min(1, 'Write the step’s prompt').max(PROMPT_TEXT_MAX),
  start: PipelineStart.default({ kind: 'fresh' }),
  /** Null: the project's default. */
  model: z.string().max(200).nullable().default(null),
  effort: Effort.nullable().default(null),
  permissionMode: PermissionMode.nullable().default(null),
  /** Only tools that read (`isReadOnlyTool`). */
  readOnly: z.boolean().optional(),
  /** Project actions (shell ones) run in the run's folder before Claude starts; their exit codes and output go in the prompt. */
  actionsFirst: z.array(z.string().trim().min(1).max(100)).max(PIPELINE_LIMITS.actions).optional(),
  /** The step ends with a verdict. On "changes needed" the list goes to `sendTo` and this step runs again, up to `rounds` times. */
  verdict: z.object({ sendTo: StepName, rounds: z.number().int().min(PIPELINE_LIMITS.rounds.min).max(PIPELINE_LIMITS.rounds.max) }).optional(),
});
export type ClaudeStep = z.infer<typeof ClaudeStep>;

/** Switchboard's own step: commit, push and open a pull request. No model. */
export const PushStep = z.object({
  kind: z.literal('push'),
  name: StepName,
  /** Commit what the steps changed first. */
  commit: z.boolean().default(true),
  /** Open a pull request after the push; null pushes only. */
  pullRequest: z.object({ base: z.string().trim().min(1).max(250).nullable().default(null), draft: z.boolean().default(false) }).nullable().default(null),
});
export type PushStep = z.infer<typeof PushStep>;

export const PipelineStep = z.discriminatedUnion('kind', [ClaudeStep, PushStep]);
export type PipelineStep = z.infer<typeof PipelineStep>;

/** What a pipeline is, without where it is kept. */
export const PipelineBody = z.object({
  name: PipelineName,
  /** Where the sub-sessions work: one new worktree for the run, or the parent's folder. */
  workspace: z.enum(['worktree', 'current']).default('worktree'),
  steps: z.array(PipelineStep).min(1, 'Add a step').max(PIPELINE_LIMITS.steps),
  /** Steps that wait for you before they start, by name. A push step always waits, unless `autoPush` is on. */
  confirmBefore: z.array(StepName).max(PIPELINE_LIMITS.steps).default([]),
  /** Push without asking. Only for your own pipelines: ignored in `.switchboard.json`. */
  autoPush: z.boolean().optional(),
});
export type PipelineBody = z.infer<typeof PipelineBody>;

/**
 * Where a pipeline is kept, like a saved prompt's scope: `builtin` ships with Switchboard (read only), `global` is
 * yours in every project, `project` is yours in one project, `shared` is in one project's .switchboard.json under
 * `pipelines` for everyone who has it.
 */
export const PipelineScope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('builtin') }),
  z.object({ kind: z.literal('global') }),
  z.object({ kind: z.literal('project'), root: AbsolutePath }),
  z.object({ kind: z.literal('shared'), root: AbsolutePath }),
]);
export type PipelineScope = z.infer<typeof PipelineScope>;

/** A scope a pipeline can be saved in. */
export const PipelineSaveScope = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }),
  z.object({ kind: z.literal('project'), root: AbsolutePath }),
  z.object({ kind: z.literal('shared'), root: AbsolutePath }),
]);
export type PipelineSaveScope = z.infer<typeof PipelineSaveScope>;

/** A pipeline as listed. `issues` are what a shared one was changed for (a mode that is not allowed there, an unknown step name). */
export const Pipeline = PipelineBody.extend({
  id: z.string().min(1).max(100),
  scope: PipelineScope,
  createdAt: z.number(),
  updatedAt: z.number(),
  issues: z.array(z.string()).default([]),
});
export type Pipeline = z.infer<typeof Pipeline>;

/** What `pipelines.save` takes: leave out `id` to create one. */
export const PipelineSave = PipelineBody.extend({
  id: z.string().min(1).max(100).optional(),
  scope: PipelineSaveScope,
});
export type PipelineSave = z.infer<typeof PipelineSave>;

export const RunState = z.enum(['running', 'held', 'needs-you', 'done', 'stopped']);
export type RunState = z.infer<typeof RunState>;

/** Why a run waits or stopped. `focus`, `limit` and `folder` hold it until a slot, a reset or the folder frees; the others need you. */
export const HeldBy = z.enum(['focus', 'limit', 'folder', 'confirm', 'push', 'reply', 'verdict', 'error', 'closed', 'worktree', 'trust']);
export type HeldBy = z.infer<typeof HeldBy>;

export const StepState = z.enum(['pending', 'running', 'done', 'needs-you', 'failed', 'skipped', 'stopped']);
export type StepState = z.infer<typeof StepState>;

export const Verdict = z.enum(['pass', 'changes']);
export type Verdict = z.infer<typeof Verdict>;

/** One run of a pipeline. It keeps a copy of the pipeline as it was when it started, so editing the pipeline never changes it. */
export const PipelineRun = z.object({
  id: z.string(),
  pipelineId: z.string(),
  pipeline: Pipeline,
  /** The session the run was started from; null for a run row (started from New session), until you write in it. */
  parentSessionId: z.string().nullable(),
  /** The project's folder. */
  root: z.string(),
  /** Where the sub-sessions work: the run's worktree, or the parent's folder. */
  cwd: z.string(),
  task: z.string(),
  /** The blanks of the steps' prompts, as filled in when the run started. */
  blanks: z.record(z.string(), z.string()).default({}),
  profileId: z.string().nullable(),
  state: RunState,
  heldBy: HeldBy.nullable(),
  /** The step the run is at: running, waiting to start, or stopped at. */
  stepIndex: z.number().int().min(0),
  /** When the current step ends, go to this step (a verdict step that runs again) instead of the next. */
  loopTo: z.number().int().min(0).nullable(),
  /** Why it waits or stopped, in a sentence. */
  note: z.string().nullable(),
  /** When the parent last got a brief of this run. */
  briefSentAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type PipelineRun = z.infer<typeof PipelineRun>;

/** One sub-session of a run: a step, or one round of a step that repeats. */
export const PipelineRunStep = z.object({
  id: z.string(),
  runId: z.string(),
  stepIndex: z.number().int().min(0),
  stepName: z.string(),
  round: z.number().int().min(1),
  /** Null for a push step, a skipped step, or a step whose session wasn't made. */
  sessionId: z.string().nullable(),
  state: StepState,
  verdict: Verdict.nullable(),
  /** What a verdict asked for: everything after the verdict line. */
  verdictText: z.string().nullable(),
  /** The step's last reply. */
  reply: z.string().nullable(),
  /** The plan the step's turn proposed (`ExitPlanMode`), which `{{previous.reply}}` is after a plan step. */
  plan: z.string().nullable(),
  startedAt: z.number().nullable(),
  endedAt: z.number().nullable(),
  note: z.string().nullable(),
});
export type PipelineRunStep = z.infer<typeof PipelineRunStep>;

/** A run with its steps. */
export const PipelineRunState = z.object({ run: PipelineRun, steps: z.array(PipelineRunStep) });
export type PipelineRunState = z.infer<typeof PipelineRunState>;

/** A run that needs you: main's notifier says so, and a click opens `parentId` (a session, or `run:<id>`). */
export const PipelineNeedsYou = z.object({
  runId: z.string(),
  parentId: z.string(),
  title: z.string(),
  step: z.string(),
  reason: z.string(),
});
export type PipelineNeedsYou = z.infer<typeof PipelineNeedsYou>;

/** What to show on the Push card before it runs: the commit message, and the pull request's title and body. */
export const PipelinePushDraft = z.object({
  /** Null when the step doesn't commit, or there is nothing to commit. */
  commitMessage: z.string().nullable(),
  /** Uncommitted files in the run's folder. */
  uncommitted: z.number().int().min(0),
  branch: z.string().nullable(),
  /** Null when the step opens no pull request. */
  prTitle: z.string().nullable(),
  prBody: z.string().nullable(),
  base: z.string().nullable(),
  draft: z.boolean(),
  /** Pushing is refused (a pull request from a fork Switchboard can't push to): the reason. */
  refused: z.string().nullable(),
});
export type PipelinePushDraft = z.infer<typeof PipelinePushDraft>;

/** How a push goes, step by step; `failed` has the reason. */
export const PipelinePushProgress = z.object({
  runId: z.string(),
  step: z.enum(['commit', 'push', 'create', 'done', 'failed']),
  pr: z.object({ number: z.number().int(), url: z.string(), draft: z.boolean() }).nullable(),
  compareUrl: z.string().nullable(),
  error: z.string().nullable(),
});
export type PipelinePushProgress = z.infer<typeof PipelinePushProgress>;

/** The id of a shared pipeline: its own `id`, else made from its name (lowercase letters, digits and dashes). */
export function sharedPipelineId(raw: Record<string, unknown>, index: number): string {
  if (typeof raw.id === 'string' && raw.id.trim()) return raw.id.trim();
  const slug = String(raw.name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || `pipeline-${index + 1}`;
}

/**
 * One entry of `pipelines` in .switchboard.json, read as it will run here. The file is written by hand, so an entry
 * that doesn't read gives `pipeline: null` and why; one that reads gets what a shared pipeline may do (no bypass
 * permissions, no `autoPush`) and the `issues` that say what was changed or is wrong. Rounds outside 1 to 5 are
 * brought into range and reported.
 */
export function normaliseSharedPipeline(raw: Record<string, unknown>, index: number): { id: string; pipeline: PipelineBody | null; issues: string[] } {
  const id = sharedPipelineId(raw, index);
  const issues: string[] = [];
  const { min, max } = PIPELINE_LIMITS.rounds;
  const steps = Array.isArray(raw.steps)
    ? raw.steps.map((step: unknown) => {
        const verdict = (step as { verdict?: { rounds?: unknown } } | null)?.verdict;
        if (!verdict || typeof verdict !== 'object') return step;
        const rounds = verdict.rounds;
        if (typeof rounds === 'number' && Number.isInteger(rounds) && rounds >= min && rounds <= max) return step;
        issues.push(`“${String((step as { name?: unknown }).name ?? 'A step')}” can go ${min} to ${max} rounds.`);
        const clamped = typeof rounds === 'number' && Number.isFinite(rounds) ? Math.min(max, Math.max(min, Math.round(rounds))) : min;
        return { ...(step as object), verdict: { ...verdict, rounds: clamped } };
      })
    : raw.steps;
  const parsed = PipelineBody.safeParse({ ...raw, steps });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first ? first.path.map((p) => (typeof p === 'number' ? `step ${p + 1}` : String(p))).join(' › ') : '';
    return { id, pipeline: null, issues: [`It doesn’t read${first ? `: ${where ? `${where}: ` : ''}${first.message}` : ''}.`] };
  }
  issues.push(...sharedPipelineIssues(parsed.data));
  return { id, pipeline: limitSharedPipeline(parsed.data), issues };
}
