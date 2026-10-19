import { describe, expect, it } from 'vitest';
import type { LaterItem, LiveSession, QueueWaitFor } from '@switchboard/protocol/client';
import type { SessionRowData } from './sessionsStore.ts';
import { busyInProject, dropIndex, moveTarget, projectOf, queueInList, queueStates, queueToast, readyTransitions, sameDraft, sameWait, startsAfter, type QueueEntry } from './queue.ts';

const NOW = Date.UTC(2026, 9, 9, 12);

const item = (id: string, overrides: Partial<LaterItem> = {}): LaterItem => ({
  id,
  cwd: '/work/switchboard',
  prompt: `Prompt ${id}`,
  model: null,
  effort: null,
  permissionMode: 'default',
  workspace: 'current',
  baseRef: 'fresh',
  branch: null,
  profileId: null,
  autoStart: false,
  attachments: [],
  typed: null,
  context: [],
  createdAt: NOW,
  position: 0,
  waitFor: { kind: 'project' },
  ...overrides,
});

const live = (status: LiveSession['status']): LiveSession => ({
  sessionId: 'x',
  pid: 0,
  cwd: null,
  projectRoot: null,
  status,
  rawStatus: status,
  name: null,
  origin: 'app',
  startedAt: null,
  updatedAt: null,
  profileId: 'default',
});

const session = (id: string, status: LiveSession['status'] | null, overrides: Partial<SessionRowData> = {}): SessionRowData => ({
  id,
  title: `Session ${id}`,
  projectRoot: '/work/switchboard',
  updatedAt: NOW,
  branch: null,
  isWorktree: false,
  live: status ? live(status) : null,
  summary: null,
  pinned: false,
  archivedAt: null,
  restoredAt: null,
  unread: false,
  inApp: true,
  error: false,
  profileId: 'default',
  ...overrides,
});

const projectName = (root: string) => root.split('/').pop()!;
const states = (items: LaterItem[], rows: SessionRowData[], started: Array<{ itemId: string; sessionId: string }> = []) => queueStates({ items, rows, started, projectName });
const brief = (entries: QueueEntry[]) => entries.map((e) => [e.item.id, e.state, e.label]);

describe('queue states', () => {
  it('waits for the project until no session there is busy', () => {
    expect(brief(states([item('a')], [session('s1', 'running')]).entries)).toEqual([['a', 'waiting', 'switchboard has a session working']]);
    expect(states([item('a')], [session('s1', 'running')]).entries[0]!.detail).toBe('Waits for “Session s1”');
    expect(brief(states([item('a')], [session('s1', 'running'), session('s2', 'running')]).entries)).toEqual([['a', 'waiting', 'switchboard has 2 sessions working']]);
    expect(brief(states([item('a')], [session('s1', 'idle'), session('s2', null)]).entries)).toEqual([['a', 'ready', 'switchboard is free']]);
    // Another project's sessions don't count.
    expect(brief(states([item('a')], [session('s1', 'running', { projectRoot: '/work/other' })]).entries)).toEqual([['a', 'ready', 'switchboard is free']]);
  });

  it('counts a session in a worktree of the project, and one that needs you, as busy', () => {
    const worktree = session('w', 'running', { projectRoot: '/work/switchboard/.claude/worktrees/fix-parser', isWorktree: true });
    expect(states([item('a')], [worktree]).entries[0]!.state).toBe('waiting');
    expect(states([item('a')], [session('q', 'needs-you')]).entries[0]).toMatchObject({ state: 'waiting', blockers: ['q'] });
    // An error or a background task alone isn't busy.
    expect(states([item('a')], [session('e', null, { error: true }), session('b', 'idle', { live: { ...live('idle'), background: ['npm test'] } })]).entries[0]!.state).toBe('ready');
    expect(projectOf('/work/switchboard/.claude/worktrees/fix-parser/src')).toBe('/work/switchboard');
    expect(projectOf('C:\\work\\app\\.claude\\worktrees\\fix\\src')).toBe('C:\\work\\app');
    expect(projectOf('C:\\work\\app\\')).toBe('C:\\work\\app');
    // A drive's root stays one: `C:` alone is the current folder on that drive.
    expect(projectOf('C:\\')).toBe('C:\\');
    expect(projectOf('/')).toBe('/');
  });

  it('waits for one session until it is no longer busy, or is closed', () => {
    const waitFor: QueueWaitFor = { kind: 'session', sessionId: 's1' };
    expect(brief(states([item('a', { waitFor })], [session('s1', 'running', { title: 'Slide transitions for scenes' })]).entries)).toEqual([['a', 'waiting', 'after “Slide transitions for scenes”']]);
    expect(brief(states([item('a', { waitFor })], [session('s1', 'needs-you')]).entries)).toEqual([['a', 'waiting', 'after “Session s1”']]);
    expect(brief(states([item('a', { waitFor })], [session('s1', 'idle')]).entries)).toEqual([['a', 'ready', '“Session s1” finished']]);
    // Closed (no live state) or gone from the list.
    expect(states([item('a', { waitFor })], [session('s1', null)]).entries[0]!.state).toBe('ready');
    expect(brief(states([item('a', { waitFor })], []).entries)).toEqual([['a', 'ready', 'switchboard is free']]);
    // Another busy session in the project doesn't matter to it.
    expect(states([item('a', { waitFor })], [session('s2', 'running')]).entries[0]!.state).toBe('ready');
  });

  it('follows the chain: waits while the item it follows is queued, then for that item’s session', () => {
    const items = [item('a', { waitFor: { kind: 'none' } }), item('b', { waitFor: { kind: 'item', itemId: 'a' } }), item('c', { waitFor: { kind: 'item', itemId: 'a' } })];
    expect(brief(states(items, []).entries)).toEqual([
      ['a', 'queued', null],
      ['b', 'waiting', 'after the item above'],
      ['c', 'waiting', 'after “Prompt a”'],
    ]);
    // a started as s1: b follows s1 while it works, and is ready once it finishes.
    const rest = items.slice(1);
    expect(brief(states(rest, [session('s1', 'running')], [{ itemId: 'a', sessionId: 's1' }]).entries)[0]).toEqual(['b', 'waiting', 'after “Session s1”']);
    expect(brief(states(rest, [session('s1', 'idle')], [{ itemId: 'a', sessionId: 's1' }]).entries)[0]).toEqual(['b', 'ready', '“Session s1” finished']);
    // a was removed without starting: nothing left to wait for.
    expect(brief(states(rest, []).entries)[0]).toEqual(['b', 'ready', 'nothing to wait for']);
  });

  it('never marks an item that waits for nothing ready', () => {
    const summary = states([item('a', { waitFor: { kind: 'none' } })], []);
    expect(summary.entries[0]).toMatchObject({ state: 'queued', label: null });
    expect(summary.readyCount).toBe(0);
    expect(summary.firstReady).toBeNull();
  });

  it('counts the ready items and finds the first in queue order', () => {
    const items = [
      item('a', { cwd: '/work/busy' }),
      item('b', { cwd: '/work/free' }),
      item('c', { cwd: '/work/also-free' }),
      item('d', { cwd: '/work/free', waitFor: { kind: 'none' } }),
    ];
    const summary = states(items, [session('s', 'running', { projectRoot: '/work/busy' })]);
    expect(summary.readyCount).toBe(2);
    expect(summary.firstReady?.item.id).toBe('b');
  });
});

describe('queue states at a usage limit', () => {
  const limit = { profileId: 'work', kind: 'five_hour', resetsAt: new Date(2026, 9, 9, 15, 16).getTime(), since: NOW, message: null, sessionIds: [] };
  const limitOf = (i: LaterItem) => (i.profileId === 'work' ? limit : null);
  const at = (now: number) => queueStates({ items: [item('a', { profileId: 'work' }), item('b')], rows: [], started: [], projectName, limitOf, now });

  it('keeps an item of a profile at its limit waiting, with the reset time, and leaves other profiles alone', () => {
    const { entries } = at(new Date(2026, 9, 9, 12).getTime());
    expect(entries[0]).toMatchObject({ state: 'waiting', blockers: [] });
    expect(entries[0]!.detail).toMatch(/^Waits for the usage limit to reset at /);
    expect(entries[1]!.state).toBe('ready');
  });

  it('lets it go once the reset time has passed', () => {
    expect(at(new Date(2026, 9, 9, 16).getTime()).entries[0]!.state).toBe('ready');
  });
});

describe('the "project is free" toast', () => {
  const byId = (entries: QueueEntry[]) => new Map(entries.map((e) => [e.item.id, e]));

  it('fires once per item when a session it waited on finishes', () => {
    const items = [item('a')];
    const working = [session('s1', 'running')];
    const done = [session('s1', 'idle')];
    const before = states(items, working).entries;
    const after = states(items, done).entries;
    const transitions = readyTransitions(byId(before), after, done);
    expect(transitions.map((t) => [t.entry.item.id, t.finishedId])).toEqual([['a', 's1']]);
    // Still ready on the next update: no second toast.
    expect(readyTransitions(byId(after), states(items, done).entries, done)).toEqual([]);
    // Busy again, then free again: a new transition.
    const again = states(items, working).entries;
    expect(readyTransitions(byId(again), after, done)).toHaveLength(1);
  });

  it('ignores the first load, new items, items that wait for nothing, and waits changed by hand', () => {
    const done = [session('s1', 'idle'), session('s2', 'running')];
    expect(readyTransitions(null, states([item('a')], done).entries, done)).toEqual([]);
    expect(readyTransitions(new Map(), states([item('a')], done).entries, done)).toEqual([]);
    const queued = [item('a', { waitFor: { kind: 'none' } })];
    expect(readyTransitions(byId(states(queued, [session('s1', 'running')]).entries), states(queued, done).entries, done)).toEqual([]);
    // Waiting on s2 (still busy), then changed to wait for nothing in particular: not because something finished.
    const before = states([item('a', { waitFor: { kind: 'session', sessionId: 's2' } })], done).entries;
    const after = states([item('a', { waitFor: { kind: 'session', sessionId: 's1' } })], done).entries;
    expect(readyTransitions(byId(before), after, done)).toEqual([]);
  });

  it('says what finished and what is next, or groups several items', () => {
    const rows = [session('s1', 'idle', { title: 'Fix transcript scroll jump' })];
    const one = queueToast([{ entry: states([item('a', { prompt: 'Add a Queue section to the sidebar' })], rows).entries[0]!, finishedId: 's1' }], { rows, projectName });
    expect(one).toEqual({
      kind: 'one',
      title: 'switchboard is free',
      body: '“Fix transcript scroll jump” finished. Next in the queue: Add a Queue section to the sidebar',
      itemId: 'a',
      finishedId: 's1',
    });
    const entries = states([item('a'), item('b', { cwd: '/work/demo-time' })], rows).entries;
    expect(queueToast(entries.map((entry) => ({ entry, finishedId: 's1' })), { rows, projectName })).toEqual({
      kind: 'many',
      title: '2 queued items are ready',
      body: 'switchboard and demo-time are free.',
      itemIds: ['a', 'b'],
    });
    expect(queueToast([], { rows, projectName })).toBeNull();
  });
});

describe('queue helpers', () => {
  it('moves items up, down and to the top, and not past the ends', () => {
    const ids = ['a', 'b', 'c'];
    expect(moveTarget(ids, 'b', -1)).toBe(0);
    expect(moveTarget(ids, 'b', 1)).toBe(2);
    expect(moveTarget(ids, 'c', 'top')).toBe(0);
    expect(moveTarget(ids, 'a', -1)).toBeNull();
    expect(moveTarget(ids, 'c', 1)).toBeNull();
    expect(moveTarget(ids, 'a', 'top')).toBeNull();
    expect(moveTarget(ids, 'missing', 1)).toBeNull();
  });

  it('turns a drop before or after an item into the index it moves to', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(dropIndex(ids, 'a', 'c', false)).toBe(1);
    expect(dropIndex(ids, 'a', 'c', true)).toBe(2);
    expect(dropIndex(ids, 'd', 'a', false)).toBe(0);
    expect(dropIndex(ids, 'd', 'b', true)).toBe(2);
    // Dropped where it already is.
    expect(dropIndex(ids, 'b', 'c', false)).toBeNull();
    expect(dropIndex(ids, 'b', 'a', true)).toBeNull();
    expect(dropIndex(ids, 'b', 'b', true)).toBeNull();
  });

  it('lists the busy sessions of a project, worktrees included', () => {
    const rows = [session('a', 'running'), session('b', 'idle'), session('c', 'needs-you', { projectRoot: '/work/switchboard/.claude/worktrees/x' }), session('d', 'running', { projectRoot: '/work/other' })];
    expect(busyInProject(rows, '/work/switchboard').map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('compares waits', () => {
    expect(sameWait({ kind: 'project' }, { kind: 'project' })).toBe(true);
    expect(sameWait({ kind: 'session', sessionId: 'a' }, { kind: 'session', sessionId: 'b' })).toBe(false);
    expect(sameWait({ kind: 'item', itemId: 'a' }, { kind: 'item', itemId: 'a' })).toBe(true);
    expect(sameWait({ kind: 'none' }, { kind: 'project' })).toBe(false);
  });

  it('tells whether an item already holds a draft', () => {
    const queued = item('a', { prompt: 'Fix the parser', model: 'opus' });
    const draft = { cwd: queued.cwd, prompt: 'Fix the parser ', model: 'opus', effort: null, permissionMode: 'default' as const, workspace: 'current' as const, baseRef: 'fresh' as const, branch: null, profileId: null };
    expect(sameDraft(queued, draft)).toBe(true);
    expect(sameDraft(queued, { ...draft, prompt: 'Fix the lexer' })).toBe(false);
    expect(sameDraft(queued, { ...draft, workspace: 'worktree' })).toBe(false);
    expect(sameDraft(queued, { ...draft, cwd: '/work/other' })).toBe(false);
    const image = { type: 'image' as const, mediaType: 'image/png' as const, data: 'aGVsbG8=' };
    expect(sameDraft(queued, { ...draft, attachments: [image] })).toBe(false);
    expect(sameDraft({ ...queued, attachments: [image] }, { ...draft, attachments: [{ ...image }] })).toBe(true);
  });

  it('filters by project and search, keeping the order', () => {
    const entries = [item('a', { prompt: 'Speaker notes' }), item('b', { cwd: '/work/other', prompt: 'Speaker view' }), item('c', { prompt: 'Export' })].map((i) => ({ item: i }));
    expect(queueInList(entries, { search: 'speaker', project: null }).map((e) => e.item.id)).toEqual(['a', 'b']);
    expect(queueInList(entries, { search: '', project: '/work/switchboard' }).map((e) => e.item.id)).toEqual(['a', 'c']);
  });
});

describe('queued context', () => {
  it('treats changed context chips as an edit', () => {
    const queued = item('a');
    const draft = { ...queued, attachments: [] };
    const file = { kind: 'file' as const, path: '/work/switchboard/notes.json', directory: false };
    expect(sameDraft({ ...queued, typed: 'hi', context: [file] }, { ...draft, typed: 'hi', context: [file] })).toBe(true);
    expect(sameDraft({ ...queued, typed: 'hi', context: [file] }, { ...draft, typed: 'hi', context: [] })).toBe(false);
  });
});

describe('what starts after a session (its band)', () => {
  const auto = (id: string, waitFor: QueueWaitFor) => item(id, { autoStart: true, waitFor });
  it('names the first item that starts by itself after it, and counts the chain behind it', () => {
    const rows = [session('fix', 'running', { title: 'Fix login' })];
    const items = [auto('a', { kind: 'session', sessionId: 'fix' }), auto('b', { kind: 'item', itemId: 'a' }), item('c', { waitFor: { kind: 'item', itemId: 'b' } }), auto('d', { kind: 'item', itemId: 'b' })];
    const after = startsAfter(states(items, rows).entries, 'fix');
    expect(after?.first.item.id).toBe('a');
    // b and d follow; c is one you start yourself.
    expect(after?.more).toBe(2);
  });

  it('says nothing for items you start yourself, or for another session', () => {
    const rows = [session('fix', 'running'), session('other', 'running')];
    expect(startsAfter(states([item('a', { waitFor: { kind: 'session', sessionId: 'fix' } })], rows).entries, 'fix')).toBeNull();
    expect(startsAfter(states([auto('a', { kind: 'session', sessionId: 'other' })], rows).entries, 'fix')).toBeNull();
  });
});
