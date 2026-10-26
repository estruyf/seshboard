import { describe, expect, it } from 'vitest';
import type { LiveSession } from '@seshboard/protocol/client';
import type { SessionRowData } from './sessionsStore.ts';
import { buildListRows, buildSessionList } from './sidebarRows.ts';
import { needsYouPill, nextNeedsYou, sidebarGroups, sidebarOrder, statusLine, stepSession, waitingDetail } from './sidebarOrder.ts';

const NOW = new Date(2026, 9, 8, 15, 0).getTime();
const HOUR = 60 * 60 * 1000;

const row = (id: string, updatedAt: number, over: Partial<SessionRowData> = {}): SessionRowData => ({
  id,
  title: id,
  projectRoot: '/work/app',
  updatedAt,
  branch: null,
  isWorktree: false,
  live: null,
  summary: null,
  pinned: false,
  archivedAt: null,
  restoredAt: null,
  unread: false,
  inApp: true,
  error: false,
  profileId: 'default',
  ...over,
});
const live = (status: LiveSession['status']) => ({ status, origin: 'app' }) as LiveSession;

const rows = [
  row('today-old', NOW - 3 * HOUR),
  row('asking', NOW - 2 * HOUR, { live: live('needs-you') }),
  row('yesterday', NOW - 20 * HOUR),
  row('working', NOW - HOUR, { live: live('running') }),
  row('today-new', NOW - 10 * 60_000),
  row('archived', NOW - 10 * 24 * HOUR),
  row('asking-too', NOW - 5 * HOUR, { live: live('needs-you') }),
];

describe('sidebarGroups', () => {
  it('lists the same sessions in the same order as the open sidebar, without archived ones', () => {
    const { active, archived } = buildSessionList(rows, { search: '', project: null, now: NOW, archiveAfterDays: 2 });
    const sidebar = buildListRows(active, archived, { now: NOW, archivedOpen: false }).flatMap((r) => (r.kind === 'session' ? [r.data.id] : []));
    const order = sidebarOrder(sidebarGroups(rows, { now: NOW, archiveAfterDays: 2 })).map((r) => r.id);
    expect(order).toEqual(sidebar);
    expect(order).not.toContain('archived');
  });

  it('puts the groups in the sidebar order', () => {
    expect(sidebarGroups(rows, { now: NOW, archiveAfterDays: 2 }).map((g) => g.group)).toEqual(['needs-you', 'working', 'today', 'yesterday']);
  });
});

describe('stepSession', () => {
  const order = ['a', 'b', 'c'];

  it('moves to the next and previous session', () => {
    expect(stepSession(order, 'a', 1)).toBe('b');
    expect(stepSession(order, 'b', -1)).toBe('a');
  });

  it('wraps at the ends', () => {
    expect(stepSession(order, 'c', 1)).toBe('a');
    expect(stepSession(order, 'a', -1)).toBe('c');
  });

  it('starts at an end without a current session in the list (an archived one, say)', () => {
    expect(stepSession(order, null, 1)).toBe('a');
    expect(stepSession(order, 'archived', -1)).toBe('c');
    expect(stepSession([], 'a', 1)).toBeNull();
  });

  it('skips archived sessions because the order leaves them out', () => {
    const ids = sidebarOrder(sidebarGroups(rows, { now: NOW, archiveAfterDays: 2 })).map((r) => r.id);
    const seen = new Set<string>();
    let id: string | null = ids[0]!;
    for (let i = 0; i < ids.length; i++) {
      seen.add(id!);
      id = stepSession(ids, id, 1);
    }
    expect(seen.has('archived')).toBe(false);
    expect(seen.size).toBe(ids.length);
  });
});

describe('nextNeedsYou', () => {
  const order = sidebarOrder(sidebarGroups(rows, { now: NOW, archiveAfterDays: 2 }));

  it('goes to the next waiting session, wrapping', () => {
    expect(nextNeedsYou(order, 'working')).toBe('asking');
    expect(nextNeedsYou(order, 'asking')).toBe('asking-too');
    expect(nextNeedsYou(order, 'asking-too')).toBe('asking');
    expect(nextNeedsYou(order, null)).toBe('asking');
  });

  it('does nothing when nothing waits', () => {
    expect(nextNeedsYou([row('a', NOW), row('b', NOW, { live: live('running') })], 'a')).toBeNull();
  });

  it('stays on the only waiting session', () => {
    expect(nextNeedsYou([row('a', NOW, { live: live('needs-you') }), row('b', NOW)], 'a')).toBe('a');
  });

  it('walks what needs you quickest to unblock first, finished and unread after waiting, whatever the sidebar shows', () => {
    const list = [
      row('long-review', NOW - HOUR, { unread: true }),
      row('waiting', NOW - 3 * HOUR, { live: live('needs-you') }),
      row('read', NOW),
      row('quick-review', NOW - 2 * HOUR, { unread: true }),
    ];
    const quick = new Map([
      ['long-review', { reviewMinutes: 9, testsFailed: false }],
      ['quick-review', { reviewMinutes: 2, testsFailed: false }],
    ]);
    expect(nextNeedsYou(list, null, quick)).toBe('waiting');
    expect(nextNeedsYou(list, 'waiting', quick)).toBe('quick-review');
    expect(nextNeedsYou(list, 'quick-review', quick)).toBe('long-review');
    expect(nextNeedsYou(list, 'long-review', quick)).toBe('waiting');
    // From a session that needs nothing, the quickest first.
    expect(nextNeedsYou(list, 'read', quick)).toBe('waiting');
  });
});

describe('needsYouPill', () => {
  it('counts the waiting sessions and opens the one waiting longest', () => {
    const pill = needsYouPill(rows, [
      { sessionId: 'asking', toolName: 'Bash', input: {}, createdAt: NOW - 30 * 60_000 },
      { sessionId: 'asking-too', toolName: 'Bash', input: {}, createdAt: NOW - 5 * 60_000 },
    ]);
    expect(pill).toEqual({ count: 2, label: '2 need you', targetId: 'asking' });
  });

  it('falls back to when a session last changed without a request (waiting in another app)', () => {
    expect(needsYouPill(rows, [])?.targetId).toBe('asking-too');
  });

  it('says "needs" for one and is gone when nothing waits', () => {
    expect(needsYouPill([row('a', NOW, { live: live('needs-you') })], [])?.label).toBe('1 needs you');
    expect(needsYouPill([row('a', NOW)], [])).toBeNull();
  });
});

describe('waitingDetail and statusLine', () => {
  it('quotes the question, names a plan or the tool', () => {
    expect(waitingDetail({ toolName: 'AskUserQuestion', input: { questions: [{ question: 'Which easing should scenes use?' }] } })).toBe('Which easing should scenes use?');
    expect(waitingDetail({ toolName: 'ExitPlanMode', input: {} })).toBe('a plan to review');
    expect(waitingDetail({ toolName: 'Bash', input: {} })).toBe('allow Bash');
    expect(waitingDetail(null)).toBeNull();
  });

  it('says the state in its colour', () => {
    expect(statusLine('needs-you', 'allow Bash')).toEqual({ text: 'Needs you: allow Bash', tone: 'warn' });
    expect(statusLine('running')).toEqual({ text: 'Working', tone: 'accent' });
    expect(statusLine('unread')).toEqual({ text: 'Done, not read yet', tone: 'unread' });
    expect(statusLine(null)).toBeNull();
  });
});
