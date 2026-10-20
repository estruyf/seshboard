import { describe, expect, it } from 'vitest';
import type { HostState, LiveSession, PermissionRequest, SessionHostInfo, SessionSummary } from '@switchboard/protocol/client';
import { focusLevel, focusSessions, focusVerdict, ordinal, savedAgo, waitedFor, type FocusInput, type FocusPrefs } from './focus.ts';

const NOW = Date.UTC(2026, 9, 7, 12);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const host = (sessionId: string, state: HostState, startedAt = NOW - HOUR): SessionHostInfo => ({
  sessionId,
  cwd: `/work/${sessionId}`,
  state,
  model: null,
  permissionMode: 'default',
  effort: null,
  costUsd: 0,
  contextPercent: null,
  contextTokens: null,
  contextMax: null,
  error: null,
  startedAt,
  promptedAt: null,
  queue: [], queueHold: null,
  profileId: 'default',
  backgroundTasks: [],
});

const summary = (id: string, overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  id,
  title: `Title ${id}`,
  firstPrompt: null,
  customTitle: null,
  cwd: `/work/${id}`,
  projectRoot: `/work/${id}`,
  gitBranch: null,
  worktree: null,
  origin: 'app',
  createdAt: NOW - 2 * HOUR,
  updatedAt: NOW - 10 * MINUTE,
  fileSize: null,
  tag: null,
  pinned: false,
  archivedAt: null,
  restoredAt: null,
  viewedAt: null,
  unread: false,
  inApp: true,
  profileId: 'default',
  ...overrides,
});

const live = (sessionId: string, status: LiveSession['status'], origin: LiveSession['origin'] = 'cli'): LiveSession => ({
  sessionId,
  pid: 1,
  cwd: `/work/${sessionId}`,
  projectRoot: `/work/${sessionId}`,
  status,
  rawStatus: status,
  name: null,
  origin,
  startedAt: NOW - HOUR,
  updatedAt: NOW - 5 * MINUTE,
  profileId: 'default',
});

const permission = (sessionId: string, createdAt: number): PermissionRequest => ({
  requestId: `${sessionId}-${createdAt}`,
  sessionId,
  toolName: 'Bash',
  toolUseId: null,
  input: {},
  title: null,
  description: null,
  decisionReason: null,
  blockedPath: null,
  alwaysLabel: null,
  agentId: null,
  createdAt,
});

const input = (parts: { hosts?: SessionHostInfo[]; live?: LiveSession[]; sessions?: SessionSummary[]; permissions?: PermissionRequest[]; countExternal?: boolean; remote?: FocusInput['remote']; countRemote?: boolean }): FocusInput => ({
  hosts: new Map((parts.hosts ?? []).map((h) => [h.sessionId, h])),
  live: new Map((parts.live ?? []).map((l) => [l.sessionId, l])),
  sessions: new Map((parts.sessions ?? []).map((s) => [s.id, s])),
  permissions: parts.permissions ?? [],
  countExternal: parts.countExternal ?? false,
  remote: parts.remote,
  countRemote: parts.countRemote,
});

const ids = (i: FocusInput) => focusSessions(i).map((s) => `${s.id}:${s.state}`);

describe('what counts as going', () => {
  it('counts working and waiting sessions, and finished ones only while unread', () => {
    const counted = input({
      hosts: [host('starting', 'starting'), host('running', 'running'), host('waiting', 'needs-you'), host('read', 'idle'), host('unread', 'idle')],
      sessions: [summary('read'), summary('unread', { unread: true })],
    });
    expect(ids(counted)).toEqual(['waiting:needs-you', 'starting:working', 'running:working', 'unread:unread']);
  });

  it('never counts closed or failed sessions, even unread ones', () => {
    const counted = input({ hosts: [host('closed', 'closed'), host('failed', 'error')], sessions: [summary('closed', { unread: true }), summary('failed', { unread: true })] });
    expect(ids(counted)).toEqual([]);
  });

  it('stops counting a session once it is settled, until it has something new', () => {
    const archivedAfter = summary('settled', { unread: true, archivedAt: NOW - MINUTE });
    const newerSince = summary('back', { unread: true, archivedAt: NOW - HOUR, updatedAt: NOW - MINUTE });
    expect(ids(input({ hosts: [host('settled', 'idle'), host('back', 'idle')], sessions: [archivedAfter, newerSince] }))).toEqual(['back:unread']);
  });

  it('frees the place of a working session that is settled, but never of one that needs you', () => {
    const sessions = [summary('working', { archivedAt: NOW - HOUR }), summary('waiting', { archivedAt: NOW })];
    expect(ids(input({ hosts: [host('working', 'running'), host('waiting', 'needs-you')], sessions }))).toEqual(['waiting:needs-you']);
  });

  it('counts a session that has not written a transcript yet, from its host', () => {
    const [session] = focusSessions(input({ hosts: [host('fresh', 'starting', NOW - MINUTE)] }));
    expect(session).toMatchObject({ id: 'fresh', title: 'New session', projectRoot: '/work/fresh', state: 'working', external: false });
  });

  it('folds a worktree into its project', () => {
    const worktree = { ...host('wt', 'running'), cwd: '/work/app/.claude/worktrees/fix-scroll' };
    expect(focusSessions(input({ hosts: [worktree] }))[0]!.projectRoot).toBe('/work/app');
  });

  it('counts terminal and IDE sessions only when asked to', () => {
    const outside = { live: [live('cli', 'running'), live('ide', 'needs-you', 'ide'), live('quiet', 'idle'), live('done', 'idle')], sessions: [summary('done', { unread: true })] };
    expect(ids(input(outside))).toEqual([]);
    const counted = focusSessions(input({ ...outside, countExternal: true }));
    expect(counted.map((s) => `${s.id}:${s.state}`)).toEqual(['ide:needs-you', 'cli:working', 'done:unread']);
    expect(counted.every((s) => s.external)).toBe(true);
  });

  it("counts Switchboard's own sessions once, from the host, and never its helper processes", () => {
    const counted = input({
      hosts: [host('mine', 'running')],
      live: [live('mine', 'idle', 'sdk'), live('helper', 'running', 'sdk'), live('app', 'running', 'app')],
      countExternal: true,
    });
    expect(focusSessions(counted).map((s) => `${s.id}:${s.state}:${s.external}`)).toEqual(['mine:working:false']);
  });

  it('lists the longest waiting first, by its oldest open request', () => {
    const counted = focusSessions(
      input({
        hosts: [host('a', 'needs-you'), host('b', 'needs-you'), host('c', 'running')],
        sessions: [summary('a', { updatedAt: NOW - 5 * MINUTE }), summary('b', { updatedAt: NOW - MINUTE })],
        permissions: [permission('a', NOW - 10 * MINUTE), permission('b', NOW - 72 * MINUTE), permission('b', NOW - 2 * MINUTE)],
      }),
    );
    expect(counted.map((s) => s.id)).toEqual(['b', 'a', 'c']);
    expect(counted[0]!.since).toBe(NOW - 72 * MINUTE);
  });
});

describe('the gate', () => {
  const nudge: FocusPrefs = { focusLimit: 3, focusMode: 'nudge', focusCountExternal: false, focusCountRemote: true };
  const strict: FocusPrefs = { ...nudge, focusMode: 'strict' };
  const going = (n: number) => focusSessions(input({ hosts: Array.from({ length: n }, (_, i) => host(`s${i}`, 'running')) }));

  it('lets everything through while the limit is off', () => {
    expect(focusVerdict(going(9), { ...nudge, focusLimit: null })).toEqual({ kind: 'allowed' });
    expect(focusVerdict(going(9), { ...strict, focusLimit: null })).toEqual({ kind: 'allowed' });
  });

  it('allows a new session under the limit', () => {
    expect(focusVerdict(going(2), nudge).kind).toBe('allowed');
    expect(focusVerdict(going(2), strict).kind).toBe('allowed');
  });

  it('asks at the limit in Nudge mode and blocks in Strict mode', () => {
    expect(focusVerdict(going(3), nudge)).toMatchObject({ kind: 'ask', count: 3, limit: 3, mode: 'nudge' });
    expect(focusVerdict(going(3), strict)).toMatchObject({ kind: 'blocked', count: 3, limit: 3, mode: 'strict' });
    // Over it (Start anyway, or sessions from outside): still asks, still blocks.
    expect(focusVerdict(going(5), nudge)).toMatchObject({ kind: 'ask', count: 5 });
    expect(focusVerdict(going(5), strict)).toMatchObject({ kind: 'blocked', count: 5 });
  });

  it('always allows answering a session that already counts', () => {
    expect(focusVerdict(going(3), strict, 's1')).toEqual({ kind: 'allowed' });
    expect(focusVerdict(going(4), nudge, 's0')).toEqual({ kind: 'allowed' });
  });

  it('gates a message to a session that does not count yet, which brings it back', () => {
    expect(focusVerdict(going(3), strict, 'old').kind).toBe('blocked');
    expect(focusVerdict(going(3), nudge, 'old').kind).toBe('ask');
    expect(focusVerdict(going(2), strict, 'old').kind).toBe('allowed');
  });

  it('frees a place once a result is read', () => {
    const unread = input({ hosts: [host('a', 'running'), host('b', 'running'), host('c', 'idle')], sessions: [summary('c', { unread: true })] });
    expect(focusVerdict(focusSessions(unread), strict).kind).toBe('blocked');
    const read = { ...unread, sessions: new Map([['c', summary('c')]]) };
    expect(focusVerdict(focusSessions(read), strict).kind).toBe('allowed');
  });

  it('counts sessions from outside toward the limit when asked to', () => {
    const parts = { hosts: [host('a', 'running'), host('b', 'running')], live: [live('term', 'running')] };
    expect(focusVerdict(focusSessions(input(parts)), strict).kind).toBe('allowed');
    expect(focusVerdict(focusSessions(input({ ...parts, countExternal: true })), { ...strict, focusCountExternal: true }).kind).toBe('blocked');
  });
});

describe('sessions on other computers', () => {
  const row = (id: string, status: 'running' | 'needs-you' | 'unread' | 'idle', offline = false) =>
    ({ id: `remote:c1:${id}`, title: id, updatedAt: NOW, remote: { computerId: 'c1', computerName: 'studio', sessionId: id, projectId: 'p', projectName: 'site', status, waitingTool: null, workingSince: null, offline, lastSeen: null } });
  const rows = [row('a', 'running'), row('b', 'needs-you'), row('c', 'unread'), row('d', 'idle'), row('e', 'running', true)];

  it('counts what is going on a paired computer, unless turned off', () => {
    const counted = focusSessions(input({ remote: rows, countRemote: true }));
    expect(counted.map((s) => s.id)).toEqual(['remote:c1:b', 'remote:c1:a', 'remote:c1:c']);
    expect(counted[0]!.remote).toEqual({ computerName: 'studio' });
    expect(focusSessions(input({ remote: rows, countRemote: false }))).toEqual([]);
  });
});

describe('labels', () => {
  it('colours the counter by where it stands', () => {
    expect([focusLevel(1, 3), focusLevel(3, 3), focusLevel(4, 3)]).toEqual(['under', 'at', 'over']);
  });

  it('names the next session', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd']);
  });

  it('says how long a session has waited', () => {
    expect(waitedFor(NOW - 20_000, NOW)).toBe('now');
    expect(waitedFor(NOW - 12 * MINUTE, NOW)).toBe('12m');
    expect(waitedFor(NOW - 72 * MINUTE, NOW)).toBe('1h 12m');
    expect(waitedFor(NOW - 2 * HOUR, NOW)).toBe('2h');
    expect(waitedFor(NOW - 51 * HOUR, NOW)).toBe('2d 3h');
  });

  it('says when a prompt was saved', () => {
    const noon = new Date(2026, 9, 7, 12).getTime();
    expect(savedAgo(noon - 10_000, noon)).toBe('just now');
    expect(savedAgo(noon - 5 * MINUTE, noon)).toBe('5m ago');
    expect(savedAgo(noon - 3 * HOUR, noon)).toBe('3h ago');
    expect(savedAgo(new Date(2026, 9, 6, 20).getTime(), noon)).toBe('yesterday');
    expect(savedAgo(new Date(2026, 9, 4, 12).getTime(), noon)).toBe('3d ago');
  });
});
