import { describe, expect, it } from 'vitest';
import type { LiveSession } from '@seshboard/protocol/client';
import type { SessionRowData } from '../../state/sessionsStore.ts';
import type { QueueEntry } from '@seshboard/protocol/client';
import { greeting, homeSessions, homeSummary, profileActivity, profileActivityLine, profileIsBusy, quietNumbers, reviewSessions, runWhen, startTarget, upNext } from './homeModel.ts';

const live = (status: LiveSession['status']): LiveSession => ({
  sessionId: 'x',
  pid: 1,
  cwd: null,
  projectRoot: '/p',
  status,
  rawStatus: status,
  name: null,
  origin: 'app',
  startedAt: null,
  updatedAt: null,
  profileId: 'default',
});

const row = (id: string, updatedAt: number, status: LiveSession['status'] | null): SessionRowData => ({
  id,
  title: id,
  projectRoot: '/p',
  updatedAt,
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
});

describe('home', () => {
  it('lists waiting sessions longest wait first, and working ones newest first', () => {
    const { needs, working } = homeSessions([row('w1', 1, 'running'), row('n1', 5, 'needs-you'), row('w2', 9, 'running'), row('n2', 2, 'needs-you'), row('idle', 3, 'idle'), row('off', 4, null)]);
    expect(needs.map((r) => r.id)).toEqual(['n2', 'n1']);
    expect(working.map((r) => r.id)).toEqual(['w2', 'w1']);
  });

  it('sums up in plain words, always saying whether something needs you', () => {
    expect(homeSummary(0, 2, 2)).toBe('2 sessions are working. Nothing needs you. 2 to review.');
    expect(homeSummary(2, 2)).toBe('2 sessions need you. 2 are working.');
    expect(homeSummary(1, 1, 1)).toBe('1 session needs you. 1 is working. 1 to review.');
    expect(homeSummary(1, 0)).toBe('1 session needs you.');
    expect(homeSummary(0, 3)).toBe('3 sessions are working. Nothing needs you.');
    expect(homeSummary(0, 0, 4)).toBe('Nothing needs you. 4 to review.');
    expect(homeSummary(0, 0)).toBe('Nothing needs you. Start a session, or pick one in the sidebar.');
  });

  it('greets by the local time of day', () => {
    const at = (hour: number) => new Date(2026, 10, 4, hour, 30).getTime();
    expect(greeting(at(8))).toBe('Good morning');
    expect(greeting(at(13))).toBe('Good afternoon');
    expect(greeting(at(19))).toBe('Good evening');
    expect(greeting(at(2))).toBe('Good evening');
  });

  it('lists unread finished sessions to review, newest first, up to the limit', () => {
    const unread = (id: string, updatedAt: number, extra: Partial<SessionRowData> = {}) => ({ ...row(id, updatedAt, 'idle'), unread: true, ...extra });
    const now = 100;
    const rows = [
      unread('old', 10),
      unread('new', 50),
      unread('failed', 30, { error: true }),
      unread('working', 60, { live: live('running') }),
      unread('waiting', 70, { live: live('needs-you') }),
      row('read', 80, 'idle'),
      unread('done', 40, { archivedAt: 45 }),
      unread('closed', 20, { live: null }),
    ];
    const { shown, total } = reviewSessions(rows, { now, archiveAfterDays: 30 });
    expect(shown.map((r) => r.id)).toEqual(['new', 'failed', 'closed', 'old']);
    expect(total).toBe(4);
    const capped = reviewSessions(rows, { now, archiveAfterDays: 30, limit: 2 });
    expect(capped.shown.map((r) => r.id)).toEqual(['new', 'failed']);
    expect(capped.total).toBe(4);
  });

  it('reads a project name at the start of the start box, and the rest as the prompt', () => {
    const projects = [
      { root: '/a', name: 'Switchboard' },
      { root: '/b', name: 'docs' },
      { root: '/c', name: 'docs site' },
    ];
    expect(startTarget('switchboard fix the tests', projects)).toEqual({ root: '/a', prompt: 'fix the tests' });
    expect(startTarget('Switchboard: fix the tests', projects)).toEqual({ root: '/a', prompt: 'fix the tests' });
    expect(startTarget('docs site add a page', projects)).toEqual({ root: '/c', prompt: 'add a page' });
    expect(startTarget('docs', projects)).toEqual({ root: '/b', prompt: '' });
    expect(startTarget('docsify the readme', projects)).toEqual({ root: null, prompt: 'docsify the readme' });
    expect(startTarget('  fix the tests ', projects)).toEqual({ root: null, prompt: 'fix the tests' });
  });

  it('folds a quiet profile into one line, and keeps a busy one as a card', () => {
    const stats = (today: number, open = 0) => ({ open, working: 0, needs: 0, today });
    expect(profileIsBusy(stats(3), [2, 0])).toBe(true);
    expect(profileIsBusy(stats(0, 1), [])).toBe(true);
    expect(profileIsBusy(stats(0), [10, 51])).toBe(true);
    expect(profileIsBusy(stats(0), [1, 8])).toBe(false);
    expect(profileIsBusy(undefined, [50])).toBe(false);
    expect(quietNumbers([{ label: '5h', percent: 1.2 }, { label: 'Week', percent: 8 }])).toBe('5h 1% · Week 8%');
    expect(quietNumbers([{ label: 'Premium requests', percent: 12 }])).toBe('Premium requests 12%');
  });

  it("says what matters most of a profile's sessions", () => {
    expect(profileActivityLine({ open: 2, working: 2, needs: 0, today: 3 })).toBe('2 working');
    expect(profileActivityLine({ open: 1, working: 1, needs: 1, today: 3 })).toBe('1 needs you');
    expect(profileActivityLine({ open: 0, working: 0, needs: 0, today: 3 })).toBe('3 today');
    expect(profileActivityLine(undefined)).toBe('No sessions today');
  });

  it('picks what is up next: a ready prompt, the next run, a held event, then what waits', () => {
    const now = new Date(2026, 10, 4, 9, 0).getTime();
    const entry = (id: string, state: QueueEntry['state'], detail: string | null = null) => ({ item: { id, prompt: `Prompt ${id}\nmore`, cwd: '/q' }, state, detail }) as unknown as QueueEntry;
    const schedule = { id: 's1', name: 'Review PRs', rule: { kind: 'daily', time: '14:00' }, paused: false, skippedRuns: [], draft: { cwd: '/s' } } as never;
    const event = { id: 'e1', triggerId: 't1', title: 'CI failed on main', status: 'waiting' as const, createdAt: 1 };
    const roots = new Map([['t1', '/t']]);
    const base = { queue: [] as QueueEntry[], schedules: [] as never[], events: [] as (typeof event)[], triggerRoots: roots, now };
    expect(upNext(base)).toBeNull();
    expect(upNext({ ...base, queue: [entry('w', 'waiting', 'Waits for “Fix it”')] })).toEqual({ kind: 'queue', id: 'w', title: 'Prompt w', cwd: '/q', when: 'Waits for “Fix it”' });
    expect(upNext({ ...base, queue: [entry('w', 'waiting')], events: [event] })).toMatchObject({ kind: 'trigger', title: 'CI failed on main', cwd: '/t', when: 'Waits for a slot' });
    expect(upNext({ ...base, queue: [entry('w', 'waiting')], events: [event], schedules: [schedule] })).toMatchObject({ kind: 'schedule', title: 'Review PRs', cwd: '/s', when: 'Today 14:00' });
    expect(upNext({ ...base, queue: [entry('w', 'waiting'), entry('r', 'ready')], schedules: [schedule] })).toMatchObject({ kind: 'queue', id: 'r', when: 'Ready' });
    expect(upNext({ ...base, schedules: [{ ...(schedule as object), paused: true } as never] })).toBeNull();
  });

  it('says when a run is, from today on', () => {
    const now = new Date(2026, 10, 4, 9, 0).getTime();
    expect(runWhen(new Date(2026, 10, 4, 14, 0).getTime(), now)).toBe('Today 14:00');
    expect(runWhen(new Date(2026, 10, 5, 8, 0).getTime(), now)).toBe('Tomorrow 08:00');
    expect(runWhen(new Date(2026, 10, 7, 8, 0).getTime(), now)).toBe('Sat 08:00');
  });
});

describe('profileActivity', () => {
  const now = new Date(2026, 9, 6, 15, 0).getTime();
  const yesterday = new Date(2026, 9, 5, 22, 0).getTime();
  const work = (id: string, profileId: string, updatedAt: number, status: LiveSession['status'] | null) => ({ ...row(id, updatedAt, status), profileId });

  it('counts open, working, waiting and today per profile', () => {
    const stats = profileActivity([work('a', 'default', now, 'running'), work('b', 'default', now, 'needs-you'), work('c', 'work', yesterday, 'idle'), work('d', 'work', now, null)], now);
    expect(stats.get('default')).toEqual({ open: 2, working: 1, needs: 1, today: 2 });
    expect(stats.get('work')).toEqual({ open: 1, working: 0, needs: 0, today: 1 });
  });

  it('says nothing is going on when all are zero', () => {
    expect(profileActivityLine({ open: 0, working: 0, needs: 0, today: 0 })).toBe('No sessions today');
  });
});
