import { mentionsIn, modelWord, modeWord, PARENT_MENTION, type Pipeline, type PipelineClaudeStep, type PipelineStep } from '@seshboard/protocol/client';

// Pipelines (#179) in the window: the words the editor shows, without React or the stores, so they can be tested. The
// rules are the protocol's (`pipelines.ts`), and the words of a run, which the remote app shows too, are in its
// `pipelineView.ts`; they are re-exported here so the views keep one place to import from.

export {
  boxChoiceUse,
  currentIndex,
  finishedLine,
  isRunRow,
  keptRunAs,
  modelWord,
  modeWord,
  pipelineMeta,
  runAsLabel,
  runAsOrder,
  runAsSteps,
  runHeaderLine,
  runIsActive,
  runTreeStatus,
  spanWords,
  STEP_VIEW_WORD,
  stepLabel,
  stepView,
  stopAdvice,
  type BoxChoiceUse,
  type RunAsStep,
  type StepView,
} from '@seshboard/protocol/client';

/** The @ names a step's prompt uses, in order, once each ("@parent", "@Execute"). */
export function stepMentions(step: PipelineClaudeStep, names: readonly string[]): string[] {
  const out: string[] = [];
  for (const m of mentionsIn(step.prompt, names)) if (m.name && !out.includes(m.name)) out.push(m.name);
  return out.map((name) => `@${name}`);
}

/**
 * A step folded to one line, as its card in the editor shows it: "Fresh · Opus · plan mode · @parent", or "commit,
 * push, pull request · waits for you" for Push.
 */
export function stepSummary(step: PipelineStep, pipeline: Pick<Pipeline, 'steps' | 'autoPush'>): string {
  if (step.kind === 'push') return ['commit, push, pull request', step.draft ? 'draft' : null, pipeline.autoPush ? 'by itself' : 'waits for you'].filter(Boolean).join(' · ');
  const names = pipeline.steps.map((s) => s.name);
  const parts = [typeof step.start === 'object' ? `Fork of ${step.start.fork}` : 'Fresh', modelWord(step.model), modeWord(step), ...stepMentions(step, names)];
  if (step.actionsFirst.length) parts.push(`runs ${step.actionsFirst.join(', ')} first`);
  if (step.verdict) parts.push(`↺ ${step.verdict.sendTo} ×${step.verdict.rounds}`);
  if (step.confirmBefore) parts.push('waits for you');
  return parts.filter(Boolean).join(' · ');
}

/** "The tree it makes": the parent and each step with its model and how it starts, as mono lines. */
export function treeLines(pipeline: Pick<Pipeline, 'steps' | 'autoPush'>): Array<{ step: string | null; name: string; detail: string }> {
  const width = Math.max(8, ...pipeline.steps.map((s) => s.name.length + 2));
  const lines: Array<{ step: string | null; name: string; detail: string }> = [{ step: null, name: '<your task>', detail: '' }];
  pipeline.steps.forEach((step, i) => {
    const last = i === pipeline.steps.length - 1;
    const branch = last ? '└─ ' : '├─ ';
    if (step.kind === 'push') {
      lines.push({ step: step.name, name: `${branch}${step.name.padEnd(width)}`, detail: pipeline.autoPush ? 'by itself' : 'waits for you' });
      return;
    }
    const how = [modelWord(step.model), typeof step.start === 'object' ? 'fork' : (modeWord(step) ?? 'fresh')].join(' · ');
    lines.push({ step: step.name, name: `${branch}${step.name.padEnd(width)}`, detail: how });
    if (step.verdict) lines.push({ step: step.name, name: `${last ? '   ' : '│  '}${''.padEnd(width)}`, detail: `↺ ${step.verdict.sendTo}, ${step.verdict.rounds} ${step.verdict.rounds === 1 ? 'round' : 'rounds'}` });
  });
  return lines;
}

/** The pipelines a project can run: every project's, and its own. */
export function pipelinesFor(pipelines: readonly Pipeline[], root: string | null): Pipeline[] {
  return pipelines.filter((p) => p.scope.kind === 'all' || (root !== null && p.scope.root === root));
}

/** A copy of a pipeline to start from (Duplicate): yours, with "copy" after the name. */
export function duplicateOf(pipeline: Pipeline, root: string | null): { name: string; scope: Pipeline['scope']; steps: PipelineStep[]; autoPush: boolean } {
  return { name: `${pipeline.name} copy`, scope: pipeline.builtIn || pipeline.scope.kind === 'all' || !root ? pipeline.scope : { kind: 'project', root }, steps: pipeline.steps.map((s) => ({ ...s })), autoPush: pipeline.autoPush };
}

/** The `@` choices in a step's prompt: the parent, then the steps before it that are sessions. */
export function mentionChoices(steps: readonly PipelineStep[], index: number): string[] {
  return [PARENT_MENTION, ...steps.slice(0, index).filter((s) => s.kind === 'claude').map((s) => s.name)];
}
