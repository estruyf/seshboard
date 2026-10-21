import { describe, expect, it } from 'vitest';
import type { Trigger, TriggerEvent } from '@switchboard/protocol/client';
import {
  cardEvents,
  checkedLine,
  checkedNowLine,
  DEFAULT_PROMPTS,
  DEFAULT_TASKS,
  eventDetail,
  foldable,
  formPipeline,
  formProblem,
  formSource,
  formToSave,
  initialFolds,
  keptFolds,
  limitsLine,
  newTriggerForm,
  pausedLine,
  problemSection,
  runEventState,
  sectionNumber,
  sharedRepoWarning,
  speakEvent,
  statusPill,
  triggerCounts,
  triggerForm,
  triggerSections,
  triggerSummary,
  updateForm,
  type SummaryPart,
  type TriggerSection,
} from './triggers.ts';

const ROOT = '/dev/switchboard';
const form = (over = {}) => ({ ...newTriggerForm(ROOT, null), ...over });

describe('the trigger editor', () => {
  it('starts on issues for you, with the project defaults and a worktree', () => {
    const f = newTriggerForm(ROOT, { model: 'sonnet', effort: null, permissionMode: 'acceptEdits', workspace: null, baseRef: null, branch: null });
    expect(f).toMatchObject({ kind: 'issues', which: 'both', label: 'switchboard', assignee: '@me', collaboratorsOnly: true, model: 'sonnet', permissionMode: 'acceptEdits', workspace: 'worktree', maxAtOnce: 3, maxWaiting: 10, name: 'Issues for you', prompt: DEFAULT_PROMPTS.issues, stateLabels: { on: false } });
    expect(newTriggerForm(ROOT, null, { prompt: 'Fix it' }).prompt).toBe('Fix it');
  });

  it('never takes bypass permissions from the project or New session', () => {
    expect(newTriggerForm(ROOT, { model: null, effort: null, permissionMode: 'bypassPermissions', workspace: null, baseRef: null, branch: null }).permissionMode).toBe('default');
    expect(newTriggerForm(ROOT, null, { permissionMode: 'bypassPermissions' }).permissionMode).toBe('default');
    expect(formProblem(form({ permissionMode: 'bypassPermissions' }))).toMatch(/never bypasses/);
    expect(formToSave(form({ permissionMode: 'bypassPermissions' })).draft?.permissionMode).toBe('default');
  });

  it('wants at least one part of the issues filter', () => {
    expect(formProblem(form({ which: 'label', label: ' ' }))).toBe('Type the label to look for.');
    expect(formProblem(form({ which: 'assignee', assignee: '' }))).toBe('Pick who the issues are assigned to.');
    expect(formProblem(form({ which: 'assignee', label: '' }))).toBeNull();
    expect(formSource(form({ which: 'assignee' }))).toEqual({ kind: 'issues', label: null, assignee: '@me', collaboratorsOnly: true });
    expect(formSource(form({ which: 'label' }))).toEqual({ kind: 'issues', label: 'switchboard', assignee: null, collaboratorsOnly: true });
  });

  it('assigns you only with a label alone, since an assignee filter has one on every issue', () => {
    expect(formToSave(form({ which: 'label', assignOnPickUp: true })).assignOnPickUp).toBe(true);
    expect(formToSave(form({ which: 'assignee', assignOnPickUp: true })).assignOnPickUp).toBe(false);
    expect(formToSave(form({ which: 'both', assignOnPickUp: true })).assignOnPickUp).toBe(false);
  });

  it('holds one session at a time in the project folder', () => {
    const inFolder = updateForm(form({ maxAtOnce: 5 }), { workspace: 'current' });
    expect(inFolder.maxAtOnce).toBe(1);
    expect(formToSave({ ...inFolder, maxAtOnce: 4 }).maxAtOnce).toBe(1);
    expect(updateForm(inFolder, { workspace: 'worktree' }).maxAtOnce).toBe(3);
  });

  it('names the trigger after its source until you type a name, and swaps the untouched prompt', () => {
    const ci = updateForm(form(), { kind: 'ci' }, 'main');
    expect(ci).toMatchObject({ name: 'CI fails on main', prompt: DEFAULT_PROMPTS.ci });
    expect(updateForm(ci, { branch: 'release' }).name).toBe('CI fails on release');
    const named = updateForm(ci, { name: 'Mine', nameTouched: true });
    expect(updateForm(named, { branch: 'dev' }).name).toBe('Mine');
    expect(updateForm(form({ prompt: 'My own' }), { kind: 'ci' }).prompt).toBe('My own');
  });

  it('saves CI triggers without state labels or assigning', () => {
    const save = formToSave(updateForm(form({ assignOnPickUp: true }), { kind: 'ci' }));
    expect(save).toMatchObject({ source: { kind: 'ci', branch: null, workflows: [] }, assignOnPickUp: false, stateLabels: { on: false } });
  });

  it('warns about a label alone on a shared repository', () => {
    expect(sharedRepoWarning({ kind: 'issues', which: 'label', label: 'switchboard' }, 'estruyf/switchboard', 6)).toBe("estruyf/switchboard has 6 collaborators. Everyone's switchboard issues will start here. Pick Both, or turn on state labels in 3.");
    expect(sharedRepoWarning({ kind: 'issues', which: 'both', label: 'switchboard' }, 'estruyf/switchboard', 6)).toBeNull();
    expect(sharedRepoWarning({ kind: 'issues', which: 'label', label: 'switchboard' }, 'me/solo', 1)).toBeNull();
    expect(sharedRepoWarning({ kind: 'issues', which: 'label', label: 'switchboard' }, 'o/r', null)).toBeNull();
  });

  it('reads a stored trigger back as the form it came from', () => {
    const trigger = { id: 't1', projectRoot: ROOT, name: 'Mine', source: { kind: 'issues', label: null, assignee: 'mara-k', collaboratorsOnly: false }, prompt: 'Do it', draft: { profileId: null, model: null, effort: null, permissionMode: 'plan', workspace: 'current', baseRef: 'fresh' }, maxAtOnce: 1, maxWaiting: 4, intervalMinutes: 5, stateLabels: { on: false, working: 'a', needsInput: 'b', prOpen: 'c', failed: 'd' }, assignOnPickUp: false, paused: true } as unknown as Trigger;
    expect(triggerForm(trigger)).toMatchObject({ which: 'assignee', assignee: 'mara-k', collaboratorsOnly: false, workspace: 'current', paused: true, nameTouched: true });
  });
});

describe('the summary sentence', () => {
  const say = (parts: SummaryPart[]) => parts.map((p) => (p.bold ? `**${p.text}**` : p.text)).join('');
  const ci = updateForm(form(), { kind: 'ci' });

  it('says which runs fail on which branch', () => {
    expect(say(triggerSummary(ci, { defaultBranch: 'main' }))).toBe('When a workflow fails on **main**, start a **session** in a new worktree. Up to **3** at once.');
    expect(say(triggerSummary({ ...ci, workflows: ['CI', 'Lint'] }, { defaultBranch: 'main' }))).toBe('When **CI** or **Lint** fails on **main**, start a **session** in a new worktree. Up to **3** at once.');
    expect(say(triggerSummary({ ...ci, workflows: ['A', 'B', 'C'], branch: 'release' }))).toMatch(/^When \*\*A\*\*, \*\*B\*\* or \*\*C\*\* fails on \*\*release\*\*,/);
    expect(say(triggerSummary(ci))).toMatch(/^When a workflow fails on the default branch, /);
  });

  it('says which issues, for each choice', () => {
    expect(say(triggerSummary(form({ which: 'label' })))).toMatch(/^When an issue gets the \*\*switchboard\*\* label, /);
    expect(say(triggerSummary(form({ which: 'assignee' }), { login: 'estruyf' }))).toMatch(/^When an issue is assigned to \*\*@estruyf\*\*, /);
    expect(say(triggerSummary(form({ which: 'assignee', assignee: 'mara-k' })))).toMatch(/^When an issue is assigned to \*\*@mara-k\*\*, /);
    expect(say(triggerSummary(form(), { login: 'estruyf' }))).toBe('When an issue with the **switchboard** label is assigned to **@estruyf**, start a **session** in a new worktree. Up to **3** at once.');
  });

  it('says what it starts, and where', () => {
    expect(say(triggerSummary(form({ workspace: 'current', maxAtOnce: 3 })))).toMatch(/, start a \*\*session\*\* in the project's folder\. One at a time\.$/);
    expect(say(triggerSummary(form({ start: 'pipeline', workspace: 'current', maxAtOnce: 2 }), { pipelineName: 'Plan, execute, validate, push' }))).toMatch(/, run \*\*Plan, execute, validate, push\*\*\. Up to \*\*2\*\* at once\.$/);
    expect(say(triggerSummary(form({ maxAtOnce: 1 })))).toMatch(/ in a new worktree\. One at a time\.$/);
  });

  it('asks for what is missing', () => {
    expect(say(triggerSummary({ ...form(), kind: null }))).toBe('Pick what starts it.');
    expect(say(triggerSummary(form({ which: 'label', label: ' ' })))).toBe('Add a label, or pick Assigned to me.');
    expect(say(triggerSummary(form({ which: 'both', assignee: '' })))).toBe('Add a label, or pick Assigned to me.');
  });
});

describe('the editor’s sections', () => {
  it('numbers them by their place', () => {
    expect(triggerSections('issues')).toEqual(['when', 'which', 'github', 'start', 'limits']);
    expect(['when', 'which', 'start', 'limits'].map((s) => sectionNumber('ci', s as TriggerSection))).toEqual([1, 2, 3, 4]);
    expect(sectionNumber('issues', 'start')).toBe(4);
  });

  it('folds GitHub with nothing to do, and Limits at their defaults', () => {
    expect([...initialFolds(form())]).toEqual(['github', 'limits']);
    expect(foldable(form({ stateLabels: { ...form().stateLabels, on: true } }), 'github')).toBe(false);
    expect(foldable(form({ which: 'label', assignOnPickUp: true }), 'github')).toBe(false);
    // Assign to me only counts with a label alone.
    expect(foldable(form({ which: 'both', assignOnPickUp: true }), 'github')).toBe(true);
    expect(foldable(form({ maxWaiting: 4 }), 'limits')).toBe(false);
    expect(foldable(updateForm(form(), { workspace: 'current' }), 'limits')).toBe(false);
    expect(limitsLine(form())).toBe('3 sessions at once, up to 10 events waiting');
    expect(limitsLine(form({ start: 'pipeline', maxWaiting: 1 }))).toBe('3 runs at once, up to 1 event waiting');
    expect([...initialFolds(updateForm(form(), { kind: 'ci' }))]).toEqual(['limits']);
  });

  it('opens a section for good once it holds more, or has the problem', () => {
    const folds = initialFolds(form());
    expect(keptFolds(folds, form(), null)).toBe(folds);
    expect([...keptFolds(folds, form({ maxAtOnce: 5 }), null)]).toEqual(['github']);
    expect([...keptFolds(folds, form(), 'github')]).toEqual(['limits']);
    // GitHub keeps its fold while a CI trigger doesn't show it.
    expect(keptFolds(folds, updateForm(form(), { kind: 'ci' }), null)).toBe(folds);
  });

  it('says which section has the problem', () => {
    expect(problemSection(form())).toBeNull();
    expect(problemSection(form({ which: 'label', label: '' }))).toBe('which');
    expect(problemSection(form({ stateLabels: { ...form().stateLabels, on: true, failed: '' } }))).toBe('github');
    expect(problemSection(form({ prompt: ' ' }))).toBe('start');
    expect(problemSection(form({ start: 'pipeline', pipelineId: null, name: '' }))).toBe('start');
    expect(problemSection(form({ name: '' }))).toBe('name');
  });
});

describe('a trigger that starts a pipeline', () => {
  it('starts a session unless a pipeline is picked, and saves which', () => {
    expect(form()).toMatchObject({ start: 'session', pipelineId: null });
    expect(formToSave(form()).start).toEqual({ kind: 'session' });
    const picked = newTriggerForm(ROOT, null, { start: 'pipeline', pipelineId: 'p1', prompt: 'Add dark mode' });
    expect(picked).toMatchObject({ start: 'pipeline', pipelineId: 'p1', prompt: 'Add dark mode' });
    expect(formToSave(picked).start).toEqual({ kind: 'pipeline', pipelineId: 'p1', unattended: false, autoPush: false });
    // Without stopping, and the pull request without you: both off until you turn them on.
    expect(formToSave({ ...picked, unattended: true, autoPush: true }).start).toEqual({ kind: 'pipeline', pipelineId: 'p1', unattended: true, autoPush: true });
    expect(formProblem(form({ start: 'pipeline', pipelineId: null }))).toBe('Pick a pipeline.');
  });

  it('runs more than one at a time whatever the draft workspace, since each run has its own worktree', () => {
    const inFolder = updateForm(form(), { workspace: 'current' });
    expect(inFolder.maxAtOnce).toBe(1);
    const pipeline = updateForm(inFolder, { start: 'pipeline', pipelineId: 'p1' });
    expect(pipeline.maxAtOnce).toBe(3);
    expect(formToSave({ ...pipeline, maxAtOnce: 4 }).maxAtOnce).toBe(4);
    expect(triggerCounts({ maxAtOnce: 4, draft: { workspace: 'current' }, start: { kind: 'pipeline', pipelineId: 'p1' } } as Trigger, [], () => false).max).toBe(4);
  });

  it('swaps the untouched prompt for a task, and back', () => {
    const pipeline = updateForm(form(), { start: 'pipeline', pipelineId: 'p1' });
    expect(pipeline.prompt).toBe(DEFAULT_TASKS.issues);
    expect(updateForm(pipeline, { kind: 'ci' }).prompt).toBe(DEFAULT_TASKS.ci);
    expect(updateForm(pipeline, { start: 'session' }).prompt).toBe(DEFAULT_PROMPTS.issues);
    expect(updateForm(form({ prompt: 'Mine' }), { start: 'pipeline' }).prompt).toBe('Mine');
  });

  it('finds the pipeline picked among the project’s', () => {
    const pipelines = [{ id: 'p1' }, { id: 'p2' }];
    expect(formPipeline({ start: 'pipeline', pipelineId: 'p2' }, pipelines)).toEqual({ id: 'p2' });
    expect(formPipeline({ start: 'pipeline', pipelineId: 'gone' }, pipelines)).toBeNull();
    expect(formPipeline({ start: 'session', pipelineId: 'p1' }, pipelines)).toBeNull();
  });

  it('reads a stored trigger’s pipeline back', () => {
    const trigger = { ...formToSave(form({ start: 'pipeline', pipelineId: 'p1', unattended: true })), id: 't1', createdAt: 1, updatedAt: 1 } as unknown as Trigger;
    expect(triggerForm(trigger)).toMatchObject({ start: 'pipeline', pipelineId: 'p1', unattended: true, autoPush: false });
  });

  it('says where a run is as its event’s state', () => {
    expect(runEventState('running')).toBe('working');
    expect(runEventState('paused')).toBe('working');
    expect(runEventState('waiting')).toBe('needs-you');
    expect(runEventState('done')).toBe('finished');
    expect(runEventState('stopped')).toBe('finished');
    expect(runEventState(null)).toBe('finished');
  });
});

describe('the Triggers tab', () => {
  const event = (over: Partial<TriggerEvent>): TriggerEvent => ({ id: 'e', triggerId: 't', key: '#214', kind: 'issue', title: 'Archive keeps the scroll position', url: '', fields: { number: '214' }, status: 'waiting', reason: null, sessionId: null, runId: null, itemId: null, label: null, reassignedTo: null, createdAt: 1, startedAt: null, ...over });

  it('says how busy a trigger is', () => {
    expect(statusPill({ paused: false }, { busy: 2, max: 3, waiting: 0 })).toEqual({ text: '2 of 3 busy', tone: 'working' });
    expect(statusPill({ paused: false }, { busy: 0, max: 3, waiting: 1 })).toEqual({ text: '1 waiting', tone: 'muted' });
    expect(statusPill({ paused: true }, { busy: 0, max: 3, waiting: 1 })).toEqual({ text: 'Paused', tone: 'caution' });
    expect(statusPill({ paused: false }, { busy: 0, max: 3, waiting: 0 })).toBeNull();
  });

  it('says why a trigger is paused', () => {
    expect(pausedLine({ paused: true, pausedReason: 'gh is signed out', failures: 5 })).toBe('Paused after 5 failed checks: gh is signed out.');
    expect(pausedLine({ paused: true, pausedReason: 'Folder not found', failures: 0 })).toBe('Paused: Folder not found.');
    expect(pausedLine({ paused: true, pausedReason: 'Imported. Check it, then resume.', failures: 0 })).toBe('Imported. Check it, then resume.');
    expect(pausedLine({ paused: true, pausedReason: null, failures: 0 })).toBe('Paused by you.');
    expect(pausedLine({ paused: false, pausedReason: null, failures: 0 })).toBeNull();
  });

  it('says what Check now found, or why it did not work', () => {
    const issues = { name: 'Issues for you', source: { kind: 'issues' as const, label: 'switchboard', assignee: '@me', collaboratorsOnly: true }, paused: false, pausedReason: null, failures: 0, lastError: null, blockedUntil: null };
    const ci = { ...issues, name: 'CI fails on main', source: { kind: 'ci' as const, branch: 'main', workflows: [] } };
    expect(checkedNowLine(issues, 0, 0)).toEqual({ text: 'Checked Issues for you. Nothing new.', ok: true });
    expect(checkedNowLine(issues, null, 0)).toEqual({ text: 'Checked Issues for you.', ok: true });
    expect(checkedNowLine(issues, 1, 0).text).toBe('Checked Issues for you. 1 new issue.');
    expect(checkedNowLine(issues, 3, 0).text).toBe('Checked Issues for you. 3 new issues.');
    expect(checkedNowLine(ci, 2, 0).text).toBe('Checked CI fails on main. 2 new failed runs.');
    expect(checkedNowLine({ ...issues, failures: 1, lastError: 'gh is signed out' }, 0, 0)).toEqual({ text: "Couldn't check Issues for you: gh is signed out.", ok: false });
    expect(checkedNowLine({ ...issues, lastError: 'rate limited', blockedUntil: 60_000 }, 0, 0).text).toMatch(/^GitHub asked to slow down\. Issues for you checks again after /);
    expect(checkedNowLine({ ...issues, paused: true, pausedReason: 'Folder not found' }, 0, 0).text).toBe('Issues for you: Paused: Folder not found.');
  });

  it('says when it last looked', () => {
    expect(checkedLine(null, 0)).toBe('not checked yet');
    expect(checkedLine(0, 30_000)).toBe('checked now');
    expect(checkedLine(0, 2 * 60_000)).toBe('checked 2m ago');
  });

  it('reads an event out as one line', () => {
    expect(speakEvent(event({}), null, { position: 1, of: 10 })).toBe('Issue 214, Archive keeps the scroll position, waiting for a slot, 1 of 10');
    expect(eventDetail(event({}), 1, { position: 1, of: 10 })).toBe('issue · waiting for a slot · 1 of 10');
    expect(eventDetail(event({ status: 'skipped', reason: "opened by someone outside the repository's collaborators" }), 1)).toBe("skipped: opened by someone outside the repository's collaborators");
  });

  it('shows sessions first, then what waits, then the rest', () => {
    const list = cardEvents([event({ id: 's', status: 'skipped', createdAt: 9 }), event({ id: 'w2', createdAt: 5 }), event({ id: 'w1', createdAt: 2 }), event({ id: 'a', status: 'started', createdAt: 1 })]);
    expect(list.map((e) => e.id)).toEqual(['a', 'w1', 'w2', 's']);
  });
});
