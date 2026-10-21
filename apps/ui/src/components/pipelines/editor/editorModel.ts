import { mentionsIn, PARENT_MENTION, PIPELINE_LIMITS, pipelineIssues, type Pipeline, type PipelineClaudeStep, type PipelineIssue, type PipelinePushStep, type PipelineSave, type PipelineScope, type PipelineStep } from '@switchboard/protocol/client';

// Settings › Pipelines' editor as a form, without React: adding, moving and removing steps, renaming one (which
// follows its forks, verdicts and @mentions), and the form as the engine saves it. The rules are the protocol's.

export interface PipelineForm {
  /** Null for a pipeline that isn't saved yet. */
  id: string | null;
  builtIn: boolean;
  name: string;
  scope: PipelineScope;
  steps: PipelineStep[];
  autoPush: boolean;
  /** One per step, kept through moves: React keys for the cards. */
  keys: number[];
  /**
   * The name the other steps know each step by (forks, verdicts, @mentions): its last name that was usable. Typing a
   * name passes through empty and taken ones ("Plan" on the way to "Planning"); those don't move the references.
   */
  refNames: string[];
  /** The next key to hand out. */
  nextKey: number;
}

const withKeys = (base: Omit<PipelineForm, 'keys' | 'refNames' | 'nextKey'>): PipelineForm => ({
  ...base,
  keys: base.steps.map((_, i) => i),
  refNames: base.steps.map((s) => s.name.trim()),
  nextKey: base.steps.length,
});

/** A saved pipeline (or a built-in) as a form. */
export function formOf(pipeline: Pipeline): PipelineForm {
  return withKeys({ id: pipeline.id, builtIn: pipeline.builtIn, name: pipeline.name, scope: pipeline.scope, steps: pipeline.steps.map(copyStep), autoPush: pipeline.autoPush });
}

const copyStep = (step: PipelineStep): PipelineStep =>
  step.kind === 'push' ? { ...step } : { ...step, start: typeof step.start === 'object' ? { ...step.start } : step.start, actionsFirst: [...step.actionsFirst], verdict: step.verdict ? { ...step.verdict } : null };

/** A step name no step has yet: "Step 2", "Step 3"… */
export function freeStepName(steps: readonly PipelineStep[], base = 'Step'): string {
  const taken = new Set(steps.map((s) => s.name.trim().toLowerCase()));
  for (let n = steps.length + 1; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/** A new `claude` step: fresh, the project's defaults, and a prompt that links the parent. */
export function newClaudeStep(steps: readonly PipelineStep[]): PipelineClaudeStep {
  return {
    kind: 'claude',
    name: freeStepName(steps),
    start: 'fresh',
    model: null,
    effort: null,
    permissionMode: null,
    readOnly: false,
    prompt: `Do the task in @${PARENT_MENTION}.`,
    actionsFirst: [],
    verdict: null,
    confirmBefore: false,
    approvePlan: false,
  };
}

export const newPushStep = (steps: readonly PipelineStep[]): PipelinePushStep => ({ kind: 'push', name: steps.some((s) => s.name.trim().toLowerCase() === 'push') ? freeStepName(steps, 'Push') : 'Push', draft: false });

/** A new pipeline: no name yet, every project's, one step. */
export function newPipelineForm(scope: PipelineScope = { kind: 'all' }): PipelineForm {
  return withKeys({ id: null, builtIn: false, name: '', scope, steps: [newClaudeStep([])], autoPush: false });
}

export const hasPush = (form: Pick<PipelineForm, 'steps'>) => form.steps.some((s) => s.kind === 'push');

/** Adds a step: a `claude` step before Push (if there is one), Push at the end and only once. The new step's index too. */
export function addStep(form: PipelineForm, kind: 'claude' | 'push'): { form: PipelineForm; index: number } {
  if (form.steps.length >= PIPELINE_LIMITS.steps || (kind === 'push' && hasPush(form))) return { form, index: -1 };
  const step = kind === 'push' ? newPushStep(form.steps) : newClaudeStep(form.steps);
  const pushAt = form.steps.findIndex((s) => s.kind === 'push');
  const index = kind === 'claude' && pushAt >= 0 ? pushAt : form.steps.length;
  const insert = <T>(list: readonly T[], item: T) => [...list.slice(0, index), item, ...list.slice(index)];
  return {
    form: { ...form, steps: insert(form.steps, step), keys: insert(form.keys, form.nextKey), refNames: insert(form.refNames, step.name), nextKey: form.nextKey + 1 },
    index,
  };
}

/**
 * Removes a step. A step that forked it starts fresh; a verdict that sent changes to it sends them to the nearest
 * `claude` step before its own step instead (or goes, when there is none). @mentions of it stay, so the issue shows.
 */
export function removeStep(form: PipelineForm, index: number): PipelineForm {
  const gone = form.refNames[index];
  const drop = <T>(list: readonly T[]) => list.filter((_, i) => i !== index);
  const steps = drop(form.steps).map((step, i): PipelineStep => {
    if (step.kind === 'push') return step;
    let next = step;
    if (typeof next.start === 'object' && next.start.fork === gone) next = { ...next, start: 'fresh' };
    if (next.verdict && next.verdict.sendTo === gone) {
      const earlier = drop(form.steps)
        .slice(0, i)
        .filter((s) => s.kind === 'claude')
        .at(-1);
      next = { ...next, verdict: earlier ? { ...next.verdict, sendTo: earlier.name.trim() } : null };
    }
    return next;
  });
  return { ...form, steps, keys: drop(form.keys), refNames: drop(form.refNames) };
}

/** Whether a step can move one place up (-1) or down (1): Push stays last, and nothing moves past it. */
export function canMove(form: Pick<PipelineForm, 'steps'>, index: number, by: -1 | 1): boolean {
  const to = index + by;
  if (to < 0 || to >= form.steps.length) return false;
  return form.steps[index]!.kind !== 'push' && form.steps[to]!.kind !== 'push';
}

/** Moves a step to another place (a drag, or one up or down). Push stays last. Forks and verdicts that now point forward show as issues. */
export function moveStep(form: PipelineForm, from: number, to: number): PipelineForm {
  const pushAt = form.steps.findIndex((s) => s.kind === 'push');
  const last = pushAt >= 0 ? pushAt - 1 : form.steps.length - 1;
  if (from === to || from < 0 || from >= form.steps.length || form.steps[from]!.kind === 'push') return form;
  const target = Math.max(0, Math.min(to, last));
  if (target === from) return form;
  const move = <T>(list: readonly T[]) => {
    const out = [...list];
    const [item] = out.splice(from, 1);
    out.splice(target, 0, item!);
    return out;
  };
  return { ...form, steps: move(form.steps), keys: move(form.keys), refNames: move(form.refNames) };
}

/** Rewrites `@from` as `@to` in a prompt, where it names that step (`names` are every step's names, `from` among them). */
export function renameMentions(prompt: string, names: readonly string[], from: string, to: string): string {
  let text = prompt;
  for (const mention of [...mentionsIn(prompt, names)].reverse()) {
    if (mention.name !== from) continue;
    text = `${text.slice(0, mention.at)}@${to}${text.slice(mention.at + 1 + from.length)}`;
  }
  return text;
}

/**
 * Renames a step. Once the new name is usable (not empty, not "parent", no other step's), the forks, verdicts and
 * @mentions that named the step follow it.
 */
export function renameStep(form: PipelineForm, index: number, name: string): PipelineForm {
  const step = form.steps[index];
  if (!step) return form;
  const steps = form.steps.map((s, i) => (i === index ? { ...s, name } : s));
  const next = name.trim();
  const from = form.refNames[index] ?? '';
  const others = form.steps.filter((_, i) => i !== index).map((s) => s.name.trim().toLowerCase());
  const usable = next !== '' && next.toLowerCase() !== PARENT_MENTION && !others.includes(next.toLowerCase());
  if (!usable || !from || from === next) return { ...form, steps, refNames: usable ? form.refNames.map((r, i) => (i === index ? next : r)) : form.refNames };
  // The names the prompts are read with: this step by the name they know it by.
  const names = form.steps.map((s, i) => (i === index ? from : s.name.trim())).filter(Boolean);
  const followed = steps.map((s): PipelineStep => {
    if (s.kind === 'push') return s;
    let out = s;
    if (typeof out.start === 'object' && out.start.fork === from) out = { ...out, start: { fork: next } };
    if (out.verdict?.sendTo === from) out = { ...out, verdict: { ...out.verdict, sendTo: next } };
    const prompt = renameMentions(out.prompt, names, from, next);
    return prompt === out.prompt ? out : { ...out, prompt };
  });
  return { ...form, steps: followed, refNames: form.refNames.map((r, i) => (i === index ? next : r)) };
}

/** Changes a step's other fields. */
export function updateStep<S extends PipelineStep>(form: PipelineForm, index: number, patch: Partial<S>): PipelineForm {
  return { ...form, steps: form.steps.map((s, i) => (i === index ? ({ ...s, ...patch } as PipelineStep) : s)) };
}

/** The `claude` steps before a step: what it can fork, and send a verdict's changes to. */
export const earlierSessions = (steps: readonly PipelineStep[], index: number) => steps.slice(0, index).filter((s): s is PipelineClaudeStep => s.kind === 'claude' && s.name.trim() !== '');

/** Turns a verdict on, with changes to the nearest `claude` step before it and two rounds. */
export function verdictOn(steps: readonly PipelineStep[], index: number): PipelineClaudeStep['verdict'] {
  const to = earlierSessions(steps, index).at(-1);
  return to ? { sendTo: to.name.trim(), rounds: 2 } : null;
}

/** What is wrong with the form: the protocol's issues, plus a name, at least one step, and a project. */
export function formIssues(form: Pick<PipelineForm, 'name' | 'scope' | 'steps'>): PipelineIssue[] {
  const issues: PipelineIssue[] = [];
  if (!form.name.trim()) issues.push({ step: null, message: 'Give the pipeline a name.' });
  if (form.scope.kind === 'project' && !form.scope.root) issues.push({ step: null, message: 'Pick a project.' });
  if (!form.steps.length) issues.push({ step: null, message: 'Add a step.' });
  if (form.steps.length > PIPELINE_LIMITS.steps) issues.push({ step: null, message: `A pipeline has ${PIPELINE_LIMITS.steps} steps at most.` });
  return [...issues, ...pipelineIssues(form)];
}

/** The form as `pipelines.save` takes it: names trimmed, no id for a new one. */
export function toSave(form: PipelineForm): PipelineSave {
  const steps = form.steps.map((step): PipelineStep => {
    if (step.kind === 'push') return { ...step, name: step.name.trim() };
    return {
      ...step,
      name: step.name.trim(),
      start: typeof step.start === 'object' ? { fork: step.start.fork.trim() } : step.start,
      actionsFirst: [...new Set(step.actionsFirst.map((a) => a.trim()).filter(Boolean))],
      verdict: step.verdict ? { ...step.verdict, sendTo: step.verdict.sendTo.trim() } : null,
    };
  });
  return { ...(form.id ? { id: form.id } : {}), name: form.name.trim(), scope: form.scope, steps, autoPush: form.autoPush };
}

/** Whether the form differs from what was saved (a new pipeline always does). */
export function isDirty(form: PipelineForm, saved: Pipeline | null): boolean {
  if (!saved) return true;
  const a = toSave(form);
  return JSON.stringify([a.name, a.scope, a.steps, a.autoPush]) !== JSON.stringify([saved.name, saved.scope, saved.steps, saved.autoPush]);
}

// --- The prompt field's @ ---------------------------------------------------------------------------------------------

/** The `@` being typed before the caret, with what follows it so far: the list of choices opens for it. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|[\s(“"'])@([^\s@]*)$/.exec(before);
  if (!match) return null;
  return { start: before.length - match[2]!.length - 1, query: match[2]! };
}

/** Puts `@name ` in place of the `@` being typed (from `start` to the caret); the new text and where the caret goes. */
export function insertMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const after = text.slice(caret);
  const space = after.startsWith(' ') || after.startsWith('\n') ? '' : ' ';
  const inserted = `@${name}${space}`;
  return { text: text.slice(0, start) + inserted + after, caret: start + inserted.length + (space ? 0 : 1) };
}

/** The choices for a query: those that start with it first, then those that contain it, any case. */
export function filterChoices(choices: readonly string[], query: string): string[] {
  const q = query.toLowerCase();
  const starts = choices.filter((c) => c.toLowerCase().startsWith(q));
  return [...starts, ...choices.filter((c) => !starts.includes(c) && c.toLowerCase().includes(q))];
}

/** A prompt in runs of text and the @mentions it can link (`choices`), for the chips behind the text. */
export function promptParts(prompt: string, choices: readonly string[]): Array<{ text: string; mention: string | null }> {
  const names = choices.filter((c) => c !== PARENT_MENTION);
  const parts: Array<{ text: string; mention: string | null }> = [];
  let from = 0;
  for (const m of mentionsIn(prompt, names)) {
    if (!m.name) continue;
    if (m.at > from) parts.push({ text: prompt.slice(from, m.at), mention: null });
    parts.push({ text: prompt.slice(m.at, m.at + 1 + m.name.length), mention: m.name });
    from = m.at + 1 + m.name.length;
  }
  if (from < prompt.length) parts.push({ text: prompt.slice(from), mention: null });
  return parts;
}

// --- The list on the left ---------------------------------------------------------------------------------------------

export interface PipelineGroup {
  key: string;
  label: string;
  pipelines: Pipeline[];
}

/** The list's groups: Built in, All projects, then one per project (by its name), each in the order they came. */
export function pipelineGroups(pipelines: readonly Pipeline[], projectName: (root: string) => string): PipelineGroup[] {
  const groups: PipelineGroup[] = [
    { key: 'builtin', label: 'Built in', pipelines: pipelines.filter((p) => p.builtIn) },
    { key: 'all', label: 'All projects', pipelines: pipelines.filter((p) => !p.builtIn && p.scope.kind === 'all') },
  ];
  const byRoot = new Map<string, Pipeline[]>();
  for (const p of pipelines) if (!p.builtIn && p.scope.kind === 'project') byRoot.set(p.scope.root, [...(byRoot.get(p.scope.root) ?? []), p]);
  const projects = [...byRoot].map(([root, list]) => ({ key: `project:${root}`, label: projectName(root), pipelines: list })).sort((a, b) => a.label.localeCompare(b.label));
  return [...groups, ...projects].filter((g) => g.pipelines.length > 0);
}

/** A row's second line: "4 steps", "2 steps · this project". */
export function pipelineRowDetail(pipeline: Pick<Pipeline, 'steps' | 'scope' | 'builtIn'>): string {
  const count = `${pipeline.steps.length} ${pipeline.steps.length === 1 ? 'step' : 'steps'}`;
  return !pipeline.builtIn && pipeline.scope.kind === 'project' ? `${count} · this project` : count;
}
