import { describe, expect, it } from 'vitest';
import { Trigger, TriggerSave, TriggerSource } from './triggerSchema.ts';
import {
  assignsOnPickUp,
  blockingStateLabel,
  effectiveMaxAtOnce,
  eventKey,
  fillTriggerPrompt,
  issueQuery,
  newEvents,
  nextStateLabel,
  seedSeen,
  slots,
  stateLabelEdit,
  triggerDue,
  triggerProblem,
  triggerSessionTitle,
  TRIGGER_RUNS_REMEMBERED,
  type CiRunItem,
  type IssueItem,
  type SlotEvent,
} from './triggers.ts';

const trigger = (source: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  Trigger.parse({ id: 't1', projectRoot: process.platform === 'win32' ? 'C:\\dev\\app' : '/dev/app', name: 'Issues for you', source, prompt: 'Work on {{event.title}}', createdAt: 1, updatedAt: 1, ...extra });

const issue = (number: number, extra: Partial<IssueItem> = {}): IssueItem => ({
  number,
  title: `Issue ${number}`,
  url: `https://github.com/o/r/issues/${number}`,
  labels: [{ name: 'switchboard' }],
  assignees: [],
  author: { login: 'estruyf' },
  authorAssociation: 'OWNER',
  body: 'The text',
  updatedAt: `2026-10-20T10:0${number % 10}:00Z`,
  ...extra,
});

const run = (id: number, workflow: string, sha: string, extra: Partial<CiRunItem> = {}): CiRunItem => ({
  databaseId: id,
  number: id,
  workflowName: workflow,
  headSha: sha,
  headBranch: 'main',
  url: `https://github.com/o/r/actions/runs/${id}`,
  createdAt: `2026-10-20T10:00:${String(id % 60).padStart(2, '0')}Z`,
  displayTitle: 'fix(ui): something',
  ...extra,
});

describe('issueQuery', () => {
  it('asks for open issues with the label only', () => {
    expect(issueQuery(trigger({ kind: 'issues', label: 'switchboard' }))).toEqual(['issue', 'list', '--state', 'open', '--label', 'switchboard', '--json', 'number,title,url,labels,assignees,author,body,updatedAt', '--limit', '100']);
  });

  it('asks for issues assigned to the gh account only', () => {
    const args = issueQuery(trigger({ kind: 'issues', assignee: '@me' }));
    expect(args).toContain('--assignee');
    expect(args[args.indexOf('--assignee') + 1]).toBe('@me');
    expect(args).not.toContain('--label');
  });

  it('asks for both', () => {
    const args = issueQuery(trigger({ kind: 'issues', label: 'switchboard', assignee: 'a-colleague' }));
    expect(args.slice(4, 8)).toEqual(['--label', 'switchboard', '--assignee', 'a-colleague']);
  });

  it('refuses an issues filter with neither part', () => {
    expect(TriggerSource.safeParse({ kind: 'issues', label: null, assignee: null }).success).toBe(false);
    expect(TriggerSource.safeParse({ kind: 'issues', label: 'switchboard' }).success).toBe(true);
  });
});

describe('eventKey', () => {
  it('is the workflow and head commit for CI, the number for issues', () => {
    expect(eventKey({ kind: 'ci' }, run(1, 'test', 'abc123'))).toBe('test@abc123');
    expect(eventKey({ kind: 'issues' }, issue(212))).toBe('#212');
  });
});

describe('newEvents', () => {
  const labelled = trigger({ kind: 'issues', label: 'switchboard' });

  it('finds what is new since the last answer, oldest first', () => {
    const seen = seedSeen(labelled, [issue(1)]);
    const found = newEvents(labelled, [issue(3), issue(1), issue(2)], seen);
    expect(found.events.map((e) => e.key)).toEqual(['#2', '#3']);
    expect(found.skipped).toEqual([]);
    expect(found.seen).toEqual({ '#1': 'match', '#2': 'match', '#3': 'match' });
  });

  it('marks everything there as seen at the first check', () => {
    const seen = seedSeen(labelled, [issue(1), issue(2)]);
    expect(newEvents(labelled, [issue(1), issue(2)], seen).events).toEqual([]);
  });

  it('fills the fields an issue has', () => {
    const [event] = newEvents(labelled, [issue(212, { title: 'Pinned sessions lose their order', assignees: [{ login: 'estruyf' }] })], {}).events;
    expect(event).toMatchObject({ kind: 'issue', title: 'Pinned sessions lose their order', fields: { number: '212', author: 'estruyf', labels: 'switchboard', assignees: 'estruyf' }, context: 'The text' });
    expect(triggerSessionTitle(event!)).toBe('#212 Pinned sessions lose their order');
  });

  it('takes a collaborator and skips an outsider, with the reason', () => {
    const found = newEvents(labelled, [issue(1, { authorAssociation: 'MEMBER' }), issue(2, { authorAssociation: 'NONE' }), issue(3, { authorAssociation: 'CONTRIBUTOR' })], {});
    expect(found.events.map((e) => e.key)).toEqual(['#1']);
    expect(found.skipped.map((e) => [e.key, e.reason])).toEqual([
      ['#2', "opened by someone outside the repository's collaborators"],
      ['#3', "opened by someone outside the repository's collaborators"],
    ]);
    // Skipped once: it stays seen, so the next check doesn't skip it again.
    expect(newEvents(labelled, [issue(2, { authorAssociation: 'NONE' })], found.seen).skipped).toEqual([]);
  });

  it('takes an outsider when collaborators only is off', () => {
    const anyone = trigger({ kind: 'issues', label: 'switchboard', collaboratorsOnly: false });
    expect(newEvents(anyone, [issue(2, { authorAssociation: 'NONE' })], {}).events).toHaveLength(1);
  });

  it('skips an issue that already has a state label, and takes it once the label is gone', () => {
    const mine = trigger({ kind: 'issues', assignee: '@me' }, { stateLabels: { on: true } });
    const elsewhere = issue(5, { labels: [{ name: 'switchboard: working' }] });
    const first = newEvents(mine, [elsewhere], {});
    expect(first.events).toEqual([]);
    expect(first.skipped.map((e) => e.reason)).toEqual(['already has the switchboard: working label']);
    expect(first.seen).toEqual({ '#5': 'held' });
    // Still labelled: no second skip.
    expect(newEvents(mine, [elsewhere], first.seen).skipped).toEqual([]);
    // The state label taken off (assignee only): it matches again, so it starts again.
    expect(newEvents(mine, [issue(5, { labels: [] })], first.seen).events.map((e) => e.key)).toEqual(['#5']);
  });

  it("doesn't start an issue whose state label Switchboard took off, while it stays in the answer", () => {
    const mine = trigger({ kind: 'issues', assignee: '@me' }, { stateLabels: { on: true } });
    // A read from before still shows the label: it stays released.
    const stale = newEvents(mine, [issue(5, { labels: [{ name: 'switchboard: working' }] })], { '#5': 'released' });
    expect(stale).toMatchObject({ events: [], skipped: [], seen: { '#5': 'released' } });
    const off = newEvents(mine, [issue(5, { labels: [] })], stale.seen);
    expect(off).toMatchObject({ events: [], skipped: [], seen: { '#5': 'match' } });
    // Gone from the answer and back: new.
    expect(newEvents(mine, [issue(5, { labels: [] })], newEvents(mine, [], off.seen).seen).events.map((e) => e.key)).toEqual(['#5']);
  });

  it('starts again when the trigger label is added to an issue whose work ended', () => {
    const withLabels = trigger({ kind: 'issues', label: 'switchboard' }, { stateLabels: { on: true } });
    // Picked up: the label came off, so it left the answer.
    const seen = newEvents(withLabels, [], { '#7': 'match' }).seen;
    expect(seen).toEqual({});
    const again = newEvents(withLabels, [issue(7, { labels: [{ name: 'switchboard' }, { name: 'switchboard: failed' }] })], seen);
    expect(again.events.map((e) => e.key)).toEqual(['#7']);
    // Labelled again while another computer still works on it: held.
    expect(newEvents(withLabels, [issue(8, { labels: [{ name: 'switchboard' }, { name: 'switchboard: needs input' }] })], {}).events).toEqual([]);
  });

  it('uses renamed state labels', () => {
    const renamed = trigger({ kind: 'issues', label: 'bot' }, { stateLabels: { on: true, working: 'bot: busy' } });
    expect(blockingStateLabel(renamed, { labels: [{ name: 'Bot: Busy' }] })).toBe('bot: busy');
    expect(blockingStateLabel(renamed, { labels: [{ name: 'switchboard: working' }] })).toBeNull();
  });

  it('skips an issue that has an assignee when it would assign you', () => {
    const assigning = trigger({ kind: 'issues', label: 'switchboard' }, { assignOnPickUp: true });
    const found = newEvents(assigning, [issue(1, { assignees: [{ login: 'mara-k' }] }), issue(2)], {});
    expect(found.events.map((e) => e.key)).toEqual(['#2']);
    expect(found.skipped[0]?.reason).toBe('already assigned to @mara-k');
  });

  it("doesn't skip assigned issues when the filter has an assignee", () => {
    // Every issue of an assignee filter has one: Assign to me only applies to a label alone.
    for (const source of [{ kind: 'issues', assignee: '@me' }, { kind: 'issues', label: 'switchboard', assignee: '@me' }]) {
      const assigning = trigger(source, { assignOnPickUp: true });
      expect(assignsOnPickUp(assigning)).toBe(false);
      const found = newEvents(assigning, [issue(1, { assignees: [{ login: 'estruyf' }] })], {});
      expect(found.events.map((e) => e.key)).toEqual(['#1']);
      expect(found.skipped).toEqual([]);
    }
    expect(assignsOnPickUp(trigger({ kind: 'issues', label: 'switchboard' }, { assignOnPickUp: true }))).toBe(true);
  });

  it('makes one event of a failed workflow on a commit, and a new one for a new commit', () => {
    const ci = trigger({ kind: 'ci', branch: 'main' });
    const first = newEvents(ci, [run(2, 'test', 'aaa'), run(1, 'test', 'aaa')], {}, 'main');
    expect(first.events.map((e) => e.key)).toEqual(['test@aaa']);
    expect(first.events[0]!.fields).toMatchObject({ workflow: 'test', branch: 'main', commit: 'aaa', run: '2' });
    expect(newEvents(ci, [run(3, 'test', 'aaa'), run(2, 'test', 'aaa')], first.seen, 'main').events).toEqual([]);
    expect(newEvents(ci, [run(4, 'test', 'bbb'), run(2, 'test', 'aaa')], first.seen, 'main').events.map((e) => e.key)).toEqual(['test@bbb']);
    expect(triggerSessionTitle(first.events[0]!)).toBe('Fix test on main');
  });

  it("doesn't start a re-run that fails again on the same commit", () => {
    const ci = trigger({ kind: 'ci', branch: 'main' });
    const first = newEvents(ci, [run(1, 'test', 'aaa')], {}, 'main');
    // Re-running: it isn't a failure for now, so it leaves the answer.
    const rerunning = newEvents(ci, [], first.seen, 'main');
    expect(rerunning.seen).toEqual({ 'test@aaa': 'match' });
    // Failed again: the same event, already seen.
    expect(newEvents(ci, [run(1, 'test', 'aaa')], rerunning.seen, 'main').events).toEqual([]);
  });

  it('remembers a bounded number of failed runs, the latest answer first', () => {
    const ci = trigger({ kind: 'ci', branch: 'main' });
    const old = Object.fromEntries(Array.from({ length: TRIGGER_RUNS_REMEMBERED }, (_, i) => [`test@old${i}`, 'match' as const]));
    const found = newEvents(ci, [run(1, 'test', 'new')], old, 'main');
    expect(Object.keys(found.seen)).toHaveLength(TRIGGER_RUNS_REMEMBERED);
    expect(Object.keys(found.seen)[0]).toBe('test@new');
    expect(found.seen[`test@old${TRIGGER_RUNS_REMEMBERED - 1}`]).toBeUndefined();
  });
});

describe('slots', () => {
  const ev = (id: string, createdAt: number, kind: 'ci' | 'issue' = 'issue', workflow = ''): SlotEvent => ({ id, kind, createdAt, fields: kind === 'ci' ? { workflow, branch: 'main' } : {} });
  const worktree = trigger({ kind: 'issues', label: 'switchboard' }, { maxAtOnce: 2, maxWaiting: 2 });

  it('starts the oldest in free slots, lets the next wait, and skips past maxWaiting', () => {
    const result = slots(worktree, 1, [ev('d', 4), ev('a', 1), ev('c', 3), ev('b', 2)]);
    expect(result.start.map((e) => e.id)).toEqual(['a']);
    expect(result.wait.map((e) => e.id)).toEqual(['b', 'c']);
    expect(result.skip.map((e) => e.id)).toEqual(['d']);
    expect(result.replaced).toEqual([]);
  });

  it('starts nothing while every slot is busy', () => {
    expect(slots(worktree, 2, [ev('a', 1)])).toMatchObject({ start: [], wait: [{ id: 'a' }] });
  });

  it('replaces a waiting CI failure with a newer one of the same workflow', () => {
    const result = slots(worktree, 2, [ev('old', 1, 'ci', 'test'), ev('lint', 2, 'ci', 'lint'), ev('new', 3, 'ci', 'test')]);
    expect(result.replaced.map((e) => e.id)).toEqual(['old']);
    expect(result.wait.map((e) => e.id)).toEqual(['lint', 'new']);
  });

  it('allows one at a time in the project folder', () => {
    const folder = trigger({ kind: 'issues', label: 'switchboard' }, { maxAtOnce: 5, draft: { workspace: 'current' } });
    expect(effectiveMaxAtOnce(folder)).toBe(1);
    expect(slots(folder, 0, [ev('a', 1), ev('b', 2)]).start.map((e) => e.id)).toEqual(['a']);
    expect(slots(folder, 1, [ev('a', 1)]).start).toEqual([]);
  });
});

describe('state labels', () => {
  it('maps where the work is to one label', () => {
    expect(nextStateLabel('waiting')).toBe('working');
    expect(nextStateLabel('working')).toBe('working');
    expect(nextStateLabel('needsYou')).toBe('needsInput');
    expect(nextStateLabel('prOpen')).toBe('prOpen');
    expect(nextStateLabel('error')).toBe('failed');
    expect(nextStateLabel('stopped')).toBe('failed');
    expect(nextStateLabel('gone')).toBe('failed');
    expect(nextStateLabel('idle')).toBeNull();
  });

  it('moves an issue in one edit, taking the trigger label off at pick-up', () => {
    expect(stateLabelEdit(212, 'switchboard: working', null, { removeTrigger: 'switchboard' })).toEqual(['issue', 'edit', '212', '--add-label', 'switchboard: working', '--remove-label', 'switchboard']);
    expect(stateLabelEdit(212, 'switchboard: pr open', 'switchboard: working')).toEqual(['issue', 'edit', '212', '--add-label', 'switchboard: pr open', '--remove-label', 'switchboard: working']);
    expect(stateLabelEdit(212, 'switchboard: working', 'switchboard: working')).toBeNull();
    expect(stateLabelEdit(212, null, null, { assign: true })).toEqual(['issue', 'edit', '212', '--add-assignee', '@me']);
    expect(stateLabelEdit(212, null, 'switchboard: working')).toEqual(['issue', 'edit', '212', '--remove-label', 'switchboard: working']);
  });
});

describe('fillTriggerPrompt', () => {
  const event = { title: 'Archive keeps the scroll position', url: 'https://github.com/o/r/issues/214', fields: { number: '214', workflow: '' } };

  it('fills the title, the link and the fields', () => {
    expect(fillTriggerPrompt('Work on {{event.title}} ({{ event.url }}), #{{event.number}}.', event)).toBe('Work on Archive keeps the scroll position (https://github.com/o/r/issues/214), #214.');
  });

  it('leaves a field the event lacks as written', () => {
    expect(fillTriggerPrompt('Fix {{event.branch}} and {{event.workflow}}{{other}}', event)).toBe('Fix {{event.branch}} and {{other}}');
  });
});

describe('triggerProblem', () => {
  const base = { prompt: 'Fix it', draft: { permissionMode: 'default' } };

  it('wants at least one part of the issues filter', () => {
    expect(triggerProblem({ ...base, source: { kind: 'issues', label: ' ', assignee: null, collaboratorsOnly: true } })).toBe('Pick a label, an assignee, or both.');
    expect(triggerProblem({ ...base, source: { kind: 'issues', label: 'switchboard', assignee: null, collaboratorsOnly: true } })).toBeNull();
  });

  it('never bypasses permissions', () => {
    expect(triggerProblem({ ...base, draft: { permissionMode: 'bypassPermissions' }, source: { kind: 'ci', branch: null, workflows: [] } })).toMatch(/never bypasses/);
    const save = { projectRoot: process.platform === 'win32' ? 'C:\\dev\\app' : '/dev/app', name: 'x', prompt: 'x', source: { kind: 'ci' }, draft: { permissionMode: 'bypassPermissions' } };
    expect(TriggerSave.safeParse(save).success).toBe(false);
    expect(TriggerSave.safeParse({ ...save, draft: { permissionMode: 'acceptEdits' } }).success).toBe(true);
  });
});

describe('triggerDue', () => {
  const t = { paused: false, blockedUntil: null, lastCheckedAt: 1_000, intervalMinutes: 5 };
  it('is due once its interval has passed, and not while paused or rate limited', () => {
    expect(triggerDue({ ...t, lastCheckedAt: null }, 0)).toBe(true);
    expect(triggerDue(t, 1_000 + 4 * 60_000)).toBe(false);
    expect(triggerDue(t, 1_000 + 5 * 60_000)).toBe(true);
    expect(triggerDue({ ...t, paused: true }, 1e12)).toBe(false);
    expect(triggerDue({ ...t, blockedUntil: 1e12 }, 1e11)).toBe(false);
  });
});
