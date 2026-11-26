import { describe as describeRule, effectiveMaxAtOnce, type ApprovalCard, type PipelineSave, type PipelineStep, type ProjectAction, type ScheduleRule, type TriggerSave } from '@seshboard/protocol';

/*
 * What an approval card shows for each kind of save or start (docs/seshboard-tools.md): a short preview, every prompt
 * and command in full, and the risky choices as their own lines, unticked unless the user ticks them. Pure, so the
 * previews are tested without a session.
 */

type Line = ApprovalCard['lines'][number];
type Option = ApprovalCard['options'][number];
type Block = ApprovalCard['blocks'][number];

const line = (text: string, detail: string | null = null, depth = 0): Line => ({ text: text.slice(0, 300), detail: detail ? detail.slice(0, 300) : null, depth });
const option = (key: string, label: string, detail: string | null = null): Option => ({ key, label, detail, checked: false });

const MODE_WORDS: Record<string, string> = { default: 'asks first', acceptEdits: 'accept edits', plan: 'plan mode', auto: 'auto mode', bypassPermissions: 'bypass permissions', dontAsk: 'don’t ask' };
const modeWord = (mode: string | null | undefined) => (mode ? (MODE_WORDS[mode] ?? mode) : null);
const modelWord = (model: string | null | undefined) => (model ? model.charAt(0).toUpperCase() + model.slice(1) : 'project’s model');

/** One step of a pipeline, as the card's line says it: "Opus · forked from Plan · accept edits". */
export function stepDetail(step: PipelineStep, autoPush: boolean): string {
  if (step.kind === 'push') return `${step.draft ? 'draft pull request' : 'pull request'} (${autoPush ? 'goes without you' : 'waits for you'})`;
  const parts = [modelWord(step.model)];
  if (typeof step.start === 'object') parts.push(`forked from ${step.start.fork}`);
  if (step.readOnly) parts.push('read only');
  const mode = modeWord(step.permissionMode);
  if (mode && !step.readOnly) parts.push(mode);
  if (step.actionsFirst.length) parts.push(`runs ${step.actionsFirst.join(', ')} first`);
  if (step.verdict) parts.push(`verdict → ${step.verdict.sendTo}, ${step.verdict.rounds} ${step.verdict.rounds === 1 ? 'round' : 'rounds'}`);
  if (step.confirmBefore) parts.push('waits for you first');
  if (step.approvePlan) parts.push('plan approved for you');
  if (step.provider) parts.push(step.provider);
  return parts.join(' · ');
}

/** A pipeline's steps as indented lines, and every step's prompt in full. */
function pipelineBody(pipeline: Pick<PipelineSave, 'steps' | 'autoPush'>): { lines: Line[]; blocks: Block[] } {
  const steps = pipeline.steps as PipelineStep[];
  return {
    lines: steps.map((step) => line(step.name, stepDetail(step, pipeline.autoPush === true), 1)),
    blocks: steps.flatMap((step) => (step.kind === 'claude' && step.prompt.trim() ? [{ label: `${step.name}’s prompt`, text: step.prompt }] : [])),
  };
}

/** The card for save_pipeline. `where`: "this project (app)" or "every project". */
export function pipelineCard(pipeline: PipelineSave & { steps: PipelineStep[] }, where: string, change: boolean): { title: string; description: string; card: ApprovalCard } {
  // The preview shows what Save saves with nothing ticked: Push waits for you until you tick otherwise.
  const { lines, blocks } = pipelineBody({ ...pipeline, autoPush: false });
  const options: Option[] = [];
  // Risky choices the agent asked for: each its own line, unticked, so nothing goes without you unless you say so.
  if (pipeline.autoPush) options.push(option('autoPush', 'Open the pull request without me', 'Push commits, pushes and opens it when the steps are done.'));
  for (const step of pipeline.steps) if (step.kind === 'claude' && step.approvePlan) options.push(option(`approvePlan:${step.name}`, `Approve ${step.name}’s plan for me`, 'The run goes on once the plan is written.'));
  return {
    title: `wants to ${change ? 'change' : 'save'} a pipeline: "${pipeline.name}"`,
    description: `${pipeline.steps.length} ${pipeline.steps.length === 1 ? 'step' : 'steps'}. Every prompt is below.`,
    card: { kind: 'pipeline', allowLabel: 'Save', lines: [line(change ? 'Changes your pipeline' : 'A new pipeline', `for ${where}`), ...lines], blocks, options, editor: 'pipeline', draft: null },
  };
}

/** Applies the ticks of a pipeline card: what wasn't ticked is saved off. */
export function applyPipelineOptions<P extends PipelineSave>(pipeline: P, options: Record<string, boolean>): P {
  return {
    ...pipeline,
    autoPush: pipeline.autoPush === true && options.autoPush === true,
    steps: pipeline.steps.map((step) => (step.kind === 'claude' && step.approvePlan ? { ...step, approvePlan: options[`approvePlan:${step.name}`] === true } : step)),
  };
}

/** The card for run_pipeline. */
export function runCard(pipeline: { name: string; steps: PipelineStep[]; autoPush: boolean }, task: string | null, under: string | null): { title: string; description: string; card: ApprovalCard } {
  const { lines, blocks } = pipelineBody(pipeline);
  return {
    title: `wants to run a pipeline: "${pipeline.name}"`,
    description: under ? `Its steps go under this session and work in its folder.` : 'It runs as a run row of its own, in a new worktree.',
    card: { kind: 'run', allowLabel: 'Run', lines: [line('Runs', under ? 'under this session' : 'as a run row'), ...lines], blocks: [...(task ? [{ label: 'Task', text: task }] : []), ...blocks], options: [], editor: null, draft: null },
  };
}

/** How a trigger's source reads: "Issues labelled bug, assigned to @me, from collaborators". */
export function sourceWords(source: TriggerSave['source']): string {
  if (source.kind === 'ci') return `Failed CI runs on ${source.branch ?? 'the default branch'}${source.workflows?.length ? `, of ${source.workflows.join(', ')}` : ''}`;
  const parts: string[] = [];
  if (source.kind === 'issues') {
    parts.push('Issues');
    if (source.label) parts.push(`labelled ${source.label}`);
    if (source.assignee) parts.push(`assigned to ${source.assignee}`);
  } else {
    parts.push('Pull requests');
    if (source.reviewer) parts.push(`that ask ${source.reviewer} for a review`);
    if (source.label) parts.push(`labelled ${source.label}`);
  }
  parts.push(source.collaboratorsOnly === false ? 'from anyone' : 'from collaborators');
  return parts.join(' ');
}

/** The card for save_trigger. `pipelineName`: the pipeline it starts, by name. `isNew`: it is saved paused unless ticked. */
export function triggerCard(trigger: TriggerSave, projectName: string, pipelineName: string | null, isNew: boolean): { title: string; description: string; card: ApprovalCard } {
  const draft = trigger.draft ?? {};
  const start = trigger.start ?? { kind: 'session' as const };
  const starts =
    start.kind === 'pipeline'
      ? `a run of "${pipelineName ?? start.pipelineId}"`
      : `a session${(draft.workspace ?? 'worktree') === 'worktree' ? ' in its own worktree' : ' in the project’s folder'}, ${modeWord(draft.permissionMode ?? 'default')}${draft.model ? `, ${modelWord(draft.model)}` : ''}`;
  const atOnce = effectiveMaxAtOnce({ maxAtOnce: trigger.maxAtOnce ?? 3, start, draft: { workspace: draft.workspace ?? 'worktree' } } as Parameters<typeof effectiveMaxAtOnce>[0]);
  const lines = [
    line('Watches', sourceWords(trigger.source)),
    line('Starts', starts),
    line('Checks', `every ${trigger.intervalMinutes ?? 5} minutes, ${atOnce} at most at once`),
    line('Project', projectName),
  ];
  const options: Option[] = [];
  if (isNew) options.push(option('watch', 'Start watching now', 'Unticked, it is saved paused. Resume it on the Triggers tab.'));
  if (start.kind === 'pipeline' && start.unattended) options.push(option('unattended', 'Run without stopping for me', 'Plans are approved and questions answered for you.'));
  if (start.kind === 'pipeline' && start.autoPush) options.push(option('autoPush', 'Open the pull request without me'));
  if (trigger.stateLabels?.on) options.push(option('stateLabels', 'Keep state labels on GitHub', 'It adds and changes labels on the issue or pull request.'));
  if (trigger.assignOnPickUp) options.push(option('assign', 'Assign the issue to me when it starts'));
  if (trigger.source.kind !== 'ci' && trigger.source.collaboratorsOnly === false) options.push(option('anyone', 'Take issues and pull requests from anyone', 'Unticked, only from the repository’s collaborators.'));
  return {
    title: `wants to ${isNew ? 'save' : 'change'} a trigger: "${trigger.name}"`,
    description: isNew ? 'A new trigger is saved paused unless you tick Start watching now.' : 'It keeps whether it is paused.',
    card: { kind: 'trigger', allowLabel: 'Save', lines, blocks: [{ label: 'Prompt for each event', text: trigger.prompt }], options, editor: 'trigger', draft: null },
  };
}

/** Applies the ticks of a trigger card. */
export function applyTriggerOptions(trigger: TriggerSave, options: Record<string, boolean>, isNew: boolean): TriggerSave {
  const start = trigger.start?.kind === 'pipeline' ? { ...trigger.start, unattended: trigger.start.unattended === true && options.unattended === true, autoPush: trigger.start.autoPush === true && options.autoPush === true } : trigger.start;
  const source = trigger.source.kind !== 'ci' && trigger.source.collaboratorsOnly === false ? { ...trigger.source, collaboratorsOnly: options.anyone !== true } : trigger.source;
  return {
    ...trigger,
    ...(start ? { start } : {}),
    source,
    stateLabels: trigger.stateLabels ? { ...trigger.stateLabels, on: trigger.stateLabels.on === true && options.stateLabels === true } : trigger.stateLabels,
    assignOnPickUp: trigger.assignOnPickUp === true && options.assign === true,
    ...(isNew ? { paused: options.watch !== true } : {}),
  } as TriggerSave;
}

/** The card for save_schedule. */
export function scheduleCard(schedule: { name: string; rule: ScheduleRule; draft: { prompt: string; workspace?: string; permissionMode?: string; model?: string | null } }, projectName: string, next: string | null, isNew: boolean): { title: string; description: string; card: ApprovalCard } {
  const draft = schedule.draft;
  return {
    title: `wants to ${isNew ? 'save' : 'change'} a schedule: "${schedule.name}"`,
    description: next ? `Its next run is ${next}.` : 'It has no run ahead.',
    card: {
      kind: 'schedule',
      allowLabel: 'Save',
      lines: [line('Runs', describeRule(schedule.rule)), line('Starts', `a session${draft.workspace === 'worktree' ? ' in its own worktree' : ' in the project’s folder'}, ${modeWord(draft.permissionMode ?? 'default')}${draft.model ? `, ${modelWord(draft.model)}` : ''}`), line('Project', projectName)],
      blocks: [{ label: 'Prompt', text: draft.prompt }],
      options: [],
      editor: 'schedule',
      draft: null,
    },
  };
}

/** The card for save_action. */
export function actionCard(action: ProjectAction, projectName: string, shared: boolean, change: boolean): { title: string; description: string; card: ApprovalCard } {
  return {
    title: `wants to ${change ? 'change' : 'save'} a project action: "${action.name}"`,
    description: shared ? 'Saved in the project’s .seshboard.json, for everyone on the project. Saving it approves its command for you.' : 'Saved for you only, for this project.',
    card: {
      kind: 'action',
      allowLabel: 'Save',
      lines: [
        line(action.type === 'prompt' ? 'Sends a prompt' : 'Runs a command', action.type === 'prompt' ? 'to the session' : `in ${action.cwd === 'project-root' ? 'the project’s folder' : 'the session’s folder'}`),
        ...(action.runOnWorktreeCreate ? [line('Also runs', 'in every new worktree, before Claude starts')] : []),
        ...(action.sendOutput ? [line('Sends its output', 'to the session when it ends')] : []),
        line('Project', projectName),
      ],
      blocks: [{ label: action.type === 'prompt' ? 'Prompt' : 'Command', text: action.command }],
      options: [],
      editor: 'action',
      draft: null,
    },
  };
}

/** A card with only lines and blocks: pause, delete, run now, start later and the rest. */
export function simpleCard(kind: ApprovalCard['kind'], allowLabel: string, lines: Array<[string, string | null]>, blocks: Block[] = []): ApprovalCard {
  return { kind, allowLabel, lines: lines.map(([text, detail]) => line(text, detail)), blocks, options: [], editor: null, draft: null };
}
