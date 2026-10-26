import { describe, expect, it } from 'vitest';
import type { LiveSession, SessionSummary } from '@seshboard/protocol/client';
import type { SessionRowData } from '../../state/sessionsStore.ts';
import {
  DEFAULT_FILTERS,
  deletePlan,
  dueToday,
  filterRows,
  groupByMonth,
  groupState,
  keptLine,
  lockReason,
  managerRows,
  overviewSummary,
  toggleGroup,
  type Holds,
  type ManagerRow,
} from './sessionManager.ts';

const DAY = 24 * 60 * 60 * 1000;
// Noon on 12 October 2026, local time, so month boundaries don't depend on the time zone.
const NOW = new Date(2026, 9, 12, 12).getTime();
const at = (month: number, day: number) => new Date(2026, month, day, 12).getTime();
const NONE: Holds = { queued: new Set(), drafts: new Set(), elsewhere: new Set() };

function row(id: string, over: Partial<SessionRowData> = {}, summary: Partial<SessionSummary> = {}): SessionRowData {
  const updatedAt = over.updatedAt ?? NOW - DAY;
  return {
    id,
    title: `Session ${id}`,
    projectRoot: '/p/switchboard',
    updatedAt,
    branch: 'main',
    isWorktree: false,
    live: null,
    summary: { id, origin: 'app', fileSize: 1_000_000, ...summary } as SessionSummary,
    pinned: false,
    archivedAt: null,
    restoredAt: null,
    unread: false,
    inApp: true,
    error: false,
    profileId: 'default',
    ...over,
  };
}
const live = (status: LiveSession['status']) => ({ sessionId: 'x', pid: 1, cwd: null, projectRoot: null, status, rawStatus: status, name: null, origin: 'cli', startedAt: null, updatedAt: null, profileId: 'default' }) as LiveSession;
const rowsOf = (data: SessionRowData[], holds: Holds = NONE) => managerRows(data, holds, NOW, 3);
const ids = (rows: readonly ManagerRow[]) => rows.map((r) => r.id);

describe('managerRows', () => {
  it('gives every indexed session a status, whatever the sidebar lists', () => {
    const rows = rowsOf([
      row('listed'),
      row('archived', { updatedAt: NOW - 10 * DAY }),
      row('pinned', { updatedAt: NOW - 10 * DAY, pinned: true }),
      row('working', { live: live('running') }),
      row('asking', { live: live('needs-you') }),
      row('starting', { summary: null }),
    ]);
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      ['listed', 'listed'],
      ['archived', 'archived'],
      ['pinned', 'pinned'],
      ['working', 'working'],
      ['asking', 'needs-you'],
    ]);
  });

  it('locks pinned, working and waiting rows, and keeps rows with a draft, a queued prompt or another window', () => {
    const holds: Holds = { queued: new Set(['q']), drafts: new Set(['d']), elsewhere: new Set(['e']) };
    const rows = rowsOf([row('q'), row('d'), row('e'), row('free'), row('pin', { pinned: true })], holds);
    expect(rows.map((r) => r.keep)).toEqual(['queued', 'draft', 'open-elsewhere', null, 'pinned']);
    expect(rows.map((r) => lockReason(r) !== null)).toEqual([false, false, false, false, true]);
  });
});

describe('filterRows', () => {
  const rows = rowsOf([
    row('recent', { updatedAt: NOW - 2 * DAY, branch: 'feat/updates' }),
    row('month', { updatedAt: NOW - 20 * DAY, projectRoot: '/p/demo-time' }, { origin: 'cli' }),
    row('old', { updatedAt: NOW - 60 * DAY }, { origin: 'ide' }),
    row('pinned', { updatedAt: NOW - 60 * DAY, pinned: true }, { origin: 'desktop' }),
  ]);
  const name = (root: string) => (root === '/p/demo-time' ? 'Demo Time' : 'switchboard');
  const only = (over: Partial<typeof DEFAULT_FILTERS>) => ids(filterRows(rows, { ...DEFAULT_FILTERS, ...over }, NOW, name));

  it('filters by time of last activity', () => {
    expect(only({ time: 'week' })).toEqual(['recent']);
    expect(only({ time: 'month' })).toEqual(['recent', 'month']);
    expect(only({ time: 'older' })).toEqual(['old', 'pinned']);
  });

  it('filters by status, project and app', () => {
    expect(only({ status: 'archived' })).toEqual(['month', 'old']);
    expect(only({ status: 'pinned' })).toEqual(['pinned']);
    expect(only({ status: 'listed' })).toEqual(['recent']);
    expect(only({ project: '/p/demo-time' })).toEqual(['month']);
    expect(only({ app: 'cli' })).toEqual(['month']);
    expect(only({ app: 'desktop' })).toEqual(['pinned']);
  });

  it('finds text in the title, the branch or the project name', () => {
    expect(only({ query: 'FEAT/up' })).toEqual(['recent']);
    expect(only({ query: 'demo time' })).toEqual(['month']);
    expect(only({ query: 'session old' })).toEqual(['old']);
  });

  it('shows exactly the sessions under review', () => {
    expect(only({ review: { ids: new Set(['old', 'month']), label: 'Due' } })).toEqual(['month', 'old']);
  });
});

describe('groupByMonth', () => {
  it('groups by the month of the last activity, newest first, with counts and sizes', () => {
    const rows = rowsOf([
      row('aug-29', { updatedAt: at(7, 29) }, { fileSize: 4_000_000 }),
      row('jul-30', { updatedAt: at(6, 30) }, { fileSize: 3_000_000 }),
      row('aug-18', { updatedAt: at(7, 18) }, { fileSize: 6_000_000 }),
      row('last-year', { updatedAt: new Date(2025, 11, 3, 12).getTime() }, { fileSize: null }),
    ]);
    const groups = groupByMonth(filterRows(rows, DEFAULT_FILTERS, NOW, () => ''), NOW);
    expect(groups.map((g) => [g.key, ids(g.rows), g.bytes])).toEqual([
      ['2026-08', ['aug-29', 'aug-18'], 10_000_000],
      ['2026-07', ['jul-30'], 3_000_000],
      ['2025-12', ['last-year'], 0],
    ]);
    expect(groups[2]!.label).toMatch(/2025/);
    expect(groups[0]!.label).not.toMatch(/2026/);
  });
});

describe('the month checkbox', () => {
  const rows = rowsOf([row('a', { updatedAt: at(7, 29) }), row('b', { updatedAt: at(7, 22) }), row('pin', { updatedAt: at(7, 20), pinned: true })]);
  const [august] = groupByMonth(rows, NOW);

  it('is off, mixed or on by the pickable rows; a locked row never counts', () => {
    expect(groupState(august!, new Set())).toBe(false);
    expect(groupState(august!, new Set(['a']))).toBe('mixed');
    expect(groupState(august!, new Set(['a', 'b']))).toBe(true);
  });

  it('picks every pickable row, leaving locked ones out, and takes them away again', () => {
    const picked = toggleGroup(august!, new Set(['elsewhere']));
    expect([...picked].sort()).toEqual(['a', 'b', 'elsewhere']);
    expect([...toggleGroup(august!, picked)]).toEqual(['elsewhere']);
    // Mixed picks the rest.
    expect([...toggleGroup(august!, new Set(['a']))].sort()).toEqual(['a', 'b']);
  });

  it('only picks the rows the filters show', () => {
    const [shown] = groupByMonth(filterRows(rows, { ...DEFAULT_FILTERS, query: 'session a' }, NOW, () => ''), NOW);
    expect([...toggleGroup(shown!, new Set())]).toEqual(['a']);
  });
});

describe('overviewSummary and deletePlan', () => {
  it('counts sessions, their size and how long they have been archived', () => {
    const rows = rowsOf([row('new'), row('archived', { updatedAt: NOW - 10 * DAY }), row('long', { updatedAt: NOW - 40 * DAY })]);
    expect(overviewSummary(rows, NOW)).toEqual({ count: 3, bytes: 3_000_000, archived: 2, archivedLong: 1 });
  });

  it('splits picks into what goes, by project, and what stays with the reason', () => {
    const holds: Holds = { queued: new Set(), drafts: new Set(['d']), elsewhere: new Set() };
    const rows = rowsOf([row('a'), row('b', { projectRoot: '/p/demo' }), row('c'), row('d', { title: 'Release checklist' })], holds);
    const plan = deletePlan(rows);
    expect(ids(plan.going)).toEqual(['a', 'b', 'c']);
    expect(plan.bytes).toBe(3_000_000);
    expect(plan.byProject).toEqual([
      { root: '/p/switchboard', count: 2, bytes: 2_000_000 },
      { root: '/p/demo', count: 1, bytes: 1_000_000 },
    ]);
    expect(keptLine(plan.kept)).toBe('Release checklist has an unsent message.');
  });

  it('says what is due today with the delete settings', () => {
    const rows = rowsOf([row('due', { updatedAt: NOW - 40 * DAY }), row('young', { updatedAt: NOW - 20 * DAY }), row('kept', { updatedAt: NOW - 40 * DAY })], { ...NONE, drafts: new Set(['kept']) });
    expect(ids(dueToday(rows, NOW, 3, 30))).toEqual(['due']);
    expect(ids(dueToday(rows, NOW, 3, 10))).toEqual(['due', 'young']);
  });
});
