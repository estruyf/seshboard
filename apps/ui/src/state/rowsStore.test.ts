import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveSession, SessionHostInfo, SessionSummary } from '@seshboard/protocol/client';
import { useHosts } from './hostsStore.ts';
import { currentRows, useRows } from './rowsStore.ts';
import { markKept, nextLive, toRows, useSessions, type RowCache } from './sessionsStore.ts';
import { mergeSessionChanges } from './sessionChanges.ts';

const summary = (id: string, over: Partial<SessionSummary> = {}): SessionSummary =>
  ({ id, title: id, firstPrompt: null, customTitle: null, cwd: '/p/a', projectRoot: '/p/a', gitBranch: null, worktree: null, origin: 'cli', createdAt: null, updatedAt: 1_000, fileSize: null, tag: null, pinned: false, archivedAt: null, restoredAt: null, viewedAt: null, unread: false, inApp: false, profileId: 'default', ...over }) as SessionSummary;
const live = (id: string, over: Partial<LiveSession> = {}): LiveSession => ({ sessionId: id, pid: 1, cwd: '/p/a', projectRoot: '/p/a', status: 'idle', rawStatus: 'idle', name: null, origin: 'cli', startedAt: null, updatedAt: null, profileId: 'default', ...over });
const host = (id: string, over: Partial<SessionHostInfo> = {}): SessionHostInfo =>
  ({ sessionId: id, cwd: '/p/a', state: 'running', model: null, permissionMode: 'default', effort: null, costUsd: 0, contextPercent: null, contextTokens: null, contextMax: null, error: null, startedAt: 5, promptedAt: 6, queue: [], queueHold: null, profileId: 'default', backgroundTasks: [], ...over }) as SessionHostInfo;

describe('toRows with a cache', () => {
  afterEach(() => vi.restoreAllMocks());

  it('gives back the same row object while the summary, registry entry and host are the same objects', () => {
    const sessions = new Map([['a', summary('a')], ['b', summary('b')]]);
    const entries = new Map([['a', live('a')]]);
    const hosts = new Map([['b', host('b')]]);
    const cache: RowCache = new Map();
    const first = toRows(sessions, entries, hosts, undefined, cache);
    // New Maps with the same contents (what every store update makes).
    const second = toRows(new Map(sessions), new Map(entries), new Map(hosts), undefined, cache);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);

    // One host changes: that session's row is new, the other is the same.
    const third = toRows(sessions, entries, new Map([['b', host('b', { state: 'needs-you' })]]), undefined, cache);
    expect(third[0]).toBe(first[0]);
    expect(third[1]).not.toBe(first[1]);
    expect(third[1]!.live?.status).toBe('needs-you');
  });

  it('builds what it always built: the same rows with and without a cache', () => {
    const sessions = new Map([['a', summary('a', { updatedAt: 500 })]]);
    const entries = new Map([['a', live('a', { status: 'running', updatedAt: 9_000 })], ['pending', live('pending', { cwd: '/p/b', projectRoot: '/p/b', startedAt: 7_000 })]]);
    const hosts = new Map([['h', host('h')]]);
    const kept = new Set(['a']);
    // A row with no time of its own takes the current one: both builds must see the same clock.
    vi.spyOn(Date, 'now').mockReturnValue(1_795_000_000_000);
    expect(toRows(sessions, entries, hosts, kept, new Map())).toEqual(toRows(sessions, entries, hosts, kept));
  });

  it('makes a new row when it becomes kept, and forgets the rows of sessions that are gone', () => {
    const sessions = new Map([['a', summary('a')]]);
    const cache: RowCache = new Map();
    const plain = toRows(sessions, new Map(), new Map(), new Set(), cache);
    const kept = toRows(sessions, new Map(), new Map(), new Set(['a']), cache);
    expect(kept[0]).not.toBe(plain[0]);
    expect(kept[0]!.kept).toBe(true);
    expect(toRows(new Map(), new Map(), new Map(), new Set(), cache)).toEqual([]);
    expect(cache.size).toBe(0);
  });

  it('keeps the row of a session that has no transcript yet while its host is the same object', () => {
    const hosts = new Map([['p', host('p')]]);
    const cache: RowCache = new Map();
    const first = toRows(new Map(), new Map(), hosts, undefined, cache);
    const second = toRows(new Map(), new Map(), new Map(hosts), undefined, cache);
    expect(first).toHaveLength(1);
    expect(second[0]).toBe(first[0]);
  });
});

describe('markKept', () => {
  it('copies only the rows that need it, once each, and returns the same rows with nothing kept', () => {
    const rows = toRows(new Map([['a', summary('a')], ['b', summary('b')]]), new Map(), new Map());
    expect(markKept(rows, new Set())).toBe(rows);
    const marked = markKept(rows, new Set(['a']));
    expect(marked[0]!.kept).toBe(true);
    expect(marked[1]).toBe(rows[1]);
    expect(markKept(rows, new Set(['a']))[0]).toBe(marked[0]);
  });
});

describe('nextLive', () => {
  it('gives back the registry itself for the same list again, and keeps the objects of entries that did not change', () => {
    const current = new Map([['a', live('a')], ['b', live('b')]]);
    expect(nextLive(current, [live('a'), live('b')])).toBe(current);
    const next = nextLive(current, [live('a'), live('b', { status: 'running' })]);
    expect(next).not.toBe(current);
    expect(next.get('a')).toBe(current.get('a'));
    expect(next.get('b')!.status).toBe('running');
    // An entry gone or added counts too.
    expect(nextLive(current, [live('a')])).not.toBe(current);
    expect(nextLive(current, [live('a'), live('b'), live('c')])).not.toBe(current);
  });

  it('sees a session gone when the list has an id twice and is as long as the registry', () => {
    const current = new Map([['a', live('a')], ['b', live('b')]]);
    const next = nextLive(current, [live('a'), live('a')]);
    expect(next).not.toBe(current);
    expect([...next.keys()]).toEqual(['a']);
  });

  it('leaves the sessions store alone, and its listeners unheard, when nothing in the list moved', () => {
    useSessions.setState({ live: new Map([['a', live('a')]]) });
    const state = useSessions.getState();
    let heard = 0;
    const off = useSessions.subscribe(() => void heard++);
    useSessions.getState().setLive([live('a')]);
    expect(useSessions.getState()).toBe(state);
    expect(heard).toBe(0);
    useSessions.getState().setLive([live('a', { status: 'running' })]);
    expect(heard).toBe(1);
    off();
    useSessions.setState({ live: new Map() });
  });
});

describe('mergeSessionChanges, unchanged summaries', () => {
  it('keeps the summary object a summary that came out the same, and the state when nothing differs', () => {
    const a = summary('a');
    const current = { sessions: new Map([['a', a]]), complete: true };
    const same = mergeSessionChanges(current, [{ upserted: [summary('a')], removed: [], complete: true }]);
    expect(same).toBe(current);
    const renamed = mergeSessionChanges(current, [{ upserted: [summary('a', { title: 'new' })], removed: [], complete: true }]);
    expect(renamed.sessions.get('a')!.title).toBe('new');
    expect(mergeSessionChanges(current, [{ upserted: [], removed: [], complete: false }]).complete).toBe(false);
  });

  it('applies a batch of the same and different summaries: only what differs is new, and what was removed is gone', () => {
    const a = summary('a');
    const b = summary('b');
    const c = summary('c');
    const current = { sessions: new Map([['a', a], ['b', b], ['c', c]]), complete: true };
    const next = mergeSessionChanges(current, [
      { upserted: [summary('a'), summary('b', { title: 'changed' }), summary('d')], removed: ['c'], complete: true },
      { upserted: [summary('b', { title: 'changed' })], removed: [], complete: true },
    ]);
    expect(next).not.toBe(current);
    expect(next.sessions.get('a')).toBe(a);
    expect(next.sessions.get('b')!.title).toBe('changed');
    expect([...next.sessions.keys()].sort()).toEqual(['a', 'b', 'd']);
    // Only removals, or only a new `complete`, count too.
    expect(mergeSessionChanges(current, [{ upserted: [], removed: ['a'], complete: true }]).sessions.has('a')).toBe(false);
    expect(mergeSessionChanges(current, [{ upserted: [], removed: ['nobody'], complete: true }])).toBe(current);
  });
});

describe('the rows store', () => {
  beforeEach(() => {
    useSessions.setState({ sessions: new Map(), live: new Map() });
    useHosts.setState({ hosts: new Map() });
  });

  it('builds the rows once per change, and a host event for one session makes one new row', () => {
    useSessions.setState({ sessions: new Map([['a', summary('a')], ['b', summary('b')], ['c', summary('c')]]) });
    const before = currentRows();
    expect(before.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    useHosts.setState({ hosts: new Map([['b', host('b')]]) });
    const after = currentRows();
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[2]).toBe(before[2]);
    expect(useRows.getState().byId.get('b')).toBe(after[1]);
  });

  it('keeps the same state, so nobody re-renders, when a change leaves every row as it was', () => {
    useSessions.setState({ sessions: new Map([['a', summary('a')]]) });
    const state = useRows.getState();
    // Another Map with the same session, a hosts update with the same hosts, the selected session: nothing the rows are made of.
    useSessions.setState({ sessions: new Map(useSessions.getState().sessions) });
    useHosts.setState({ hosts: useHosts.getState().hosts });
    useSessions.setState({ selectedId: 'a' });
    expect(useRows.getState()).toBe(state);
  });
});
