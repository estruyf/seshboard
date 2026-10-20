import { describe, expect, it } from 'vitest';
import type { Trigger, TriggerEvent } from '@switchboard/protocol/client';
import { cardEvents, checkedLine, checkedNowLine, DEFAULT_PROMPTS, eventDetail, formProblem, formSource, formToSave, newTriggerForm, pausedLine, sharedRepoWarning, speakEvent, statusPill, triggerForm, updateForm } from './triggers.ts';

const ROOT = '/dev/switchboard';
const form = (over = {}) => ({ ...newTriggerForm(ROOT, null), ...over });

describe('the trigger editor', () => {
  it('starts on issues for you, with the project defaults and a worktree', () => {
    const f = newTriggerForm(ROOT, { model: 'sonnet', effort: null, permissionMode: 'acceptEdits', workspace: null, baseRef: null, branch: null });
    expect(f).toMatchObject({ kind: 'issues', which: 'both', label: 'switchboard', assignee: '@me', collaboratorsOnly: true, model: 'sonnet', permissionMode: 'acceptEdits', workspace: 'worktree', maxAtOnce: 3, maxWaiting: 10, name: 'Issues for you', prompt: DEFAULT_PROMPTS.issues });
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
    expect(sharedRepoWarning({ kind: 'issues', which: 'label', label: 'switchboard' }, 'estruyf/switchboard', 6)).toBe(
      "estruyf/switchboard has 6 collaborators. Everyone's switchboard issues will start here. Use Assigned to me, turn on state labels, or Assign to me when picked up.",
    );
    expect(sharedRepoWarning({ kind: 'issues', which: 'both', label: 'switchboard' }, 'estruyf/switchboard', 6)).toBeNull();
    expect(sharedRepoWarning({ kind: 'issues', which: 'label', label: 'switchboard' }, 'me/solo', 1)).toBeNull();
    expect(sharedRepoWarning({ kind: 'issues', which: 'label', label: 'switchboard' }, 'o/r', null)).toBeNull();
  });

  it('reads a stored trigger back as the form it came from', () => {
    const trigger = { id: 't1', projectRoot: ROOT, name: 'Mine', source: { kind: 'issues', label: null, assignee: 'mara-k', collaboratorsOnly: false }, prompt: 'Do it', draft: { profileId: null, model: null, effort: null, permissionMode: 'plan', workspace: 'current', baseRef: 'fresh' }, maxAtOnce: 1, maxWaiting: 4, intervalMinutes: 5, stateLabels: { on: false, working: 'a', needsInput: 'b', prOpen: 'c', failed: 'd' }, assignOnPickUp: false, paused: true } as unknown as Trigger;
    expect(triggerForm(trigger)).toMatchObject({ which: 'assignee', assignee: 'mara-k', collaboratorsOnly: false, workspace: 'current', paused: true, nameTouched: true });
  });
});

describe('the Triggers tab', () => {
  const event = (over: Partial<TriggerEvent>): TriggerEvent => ({ id: 'e', triggerId: 't', key: '#214', kind: 'issue', title: 'Archive keeps the scroll position', url: '', fields: { number: '214' }, status: 'waiting', reason: null, sessionId: null, itemId: null, label: null, reassignedTo: null, createdAt: 1, startedAt: null, ...over });

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
