import { describe, expect, it } from 'vitest';
import type { LiveSession } from '@seshboard/protocol/client';
import type { SessionRowData } from '../../state/sessionsStore.ts';
import { buildListRows, buildSessionList } from '../../state/sidebarRows.ts';
import { gotoGroups, gotoWithDrafts, matchProjects, matchSessions, orderSessions } from './gotoItems.ts';
import type { DraftItem } from '../../state/drafts.ts';

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
const live = (status: LiveSession['status']) => ({ status }) as LiveSession;

describe('orderSessions', () => {
  it('lists needs you, then working, then unread, then the most recent', () => {
    const rows = [row('old', 1), row('recent', 50), row('unread', 5, { unread: true }), row('working', 2, { live: live('running') }), row('asking', 3, { live: live('needs-you') })];
    expect(orderSessions(rows).map((r) => r.id)).toEqual(['asking', 'working', 'unread', 'recent', 'old']);
  });
});

describe('matchSessions', () => {
  const rows = [row('Fix the login', 10), row('Release notes', 20, { projectRoot: '/work/site' }), row('Flaky tests', 5, { live: live('needs-you') })];
  const name = (root: string) => root.split('/').pop()!;

  it('keeps the order and a limit with nothing typed', () => {
    expect(matchSessions(rows, '', name, 2).map((m) => m.item.id)).toEqual(['Flaky tests', 'Release notes']);
  });

  it('matches titles (highlighted) and project names', () => {
    const [first] = matchSessions(rows, 'login', name, 10);
    expect(first!.item.id).toBe('Fix the login');
    expect(first!.indices).toEqual([8, 9, 10, 11, 12]);
    expect(matchSessions(rows, 'site', name, 10).map((m) => m.item.id)).toEqual(['Release notes']);
  });
});

describe('matchProjects', () => {
  it('matches by name, then by path', () => {
    const roots = ['/work/switchboard', '/work/demo-time', '/archive/tideline'];
    const name = (root: string) => root.split('/').pop()!;
    expect(matchProjects(roots, '', name).map((m) => m.item)).toEqual(roots);
    expect(matchProjects(roots, 'demo', name)[0]!.item).toBe('/work/demo-time');
    expect(matchProjects(roots, 'archive', name).map((m) => m.item)).toEqual(['/archive/tideline']);
  });
});

describe('gotoGroups', () => {
  const now = new Date(2026, 9, 8, 15, 0).getTime();
  const hour = 60 * 60 * 1000;
  const rows = [
    row('yesterday', now - 20 * hour),
    row('today', now - hour),
    row('asking', now - 3 * hour, { live: { status: 'needs-you', origin: 'app' } as LiveSession }),
    row('working', now - 2 * hour, { live: { status: 'running', origin: 'app' } as LiveSession }),
    row('old', now - 30 * 24 * hour),
  ];

  it('lists the groups and sessions in the sidebar order, without archived ones', () => {
    const groups = gotoGroups(rows, now, 2, 20);
    expect(groups.map((g) => g.group)).toEqual(['needs-you', 'working', 'today', 'yesterday']);
    const { active, archived } = buildSessionList(rows, { search: '', project: null, now, archiveAfterDays: 2 });
    const sidebar = buildListRows(active, archived, { now, archivedOpen: false }).flatMap((r) => (r.kind === 'group' ? [r.group] : []));
    expect(groups.map((g) => g.group)).toEqual(sidebar);
    expect(groups.flatMap((g) => g.rows.map((r) => r.id))).toEqual(['asking', 'working', 'today', 'yesterday']);
  });

  it('cuts the later groups first', () => {
    expect(gotoGroups(rows, now, 2, 3).map((g) => [g.group, g.rows.length])).toEqual([
      ['needs-you', 1],
      ['working', 1],
      ['today', 1],
    ]);
  });
});

describe('gotoWithDrafts', () => {
  const now = new Date(2026, 9, 8, 15, 0).getTime();
  const hour = 60 * 60 * 1000;
  const rows = [
    row('asking', now - 3 * hour, { live: { status: 'needs-you', origin: 'app' } as LiveSession }),
    row('today', now - hour),
    row('other', now - 2 * hour),
  ];
  const drafts: DraftItem[] = [
    { key: 'new:/work/app', kind: 'new', root: '/work/app', preview: 'Add a page', updatedAt: now - 60_000 },
    { key: 'today', kind: 'session', sessionId: 'today', preview: 'also check', updatedAt: now - 120_000 },
    { key: 'asking', kind: 'session', sessionId: 'asking', preview: 'ease-out', updatedAt: now - 180_000 },
  ];

  it('puts unsent messages first and leaves a session that needs you in Needs you', () => {
    const { unsent, groups } = gotoWithDrafts(rows, drafts, now, 2, 20);
    expect(unsent.map((d) => d.key)).toEqual(['new:/work/app', 'today']);
    expect(groups.map((g) => [g.group, g.rows.map((r) => r.id)])).toEqual([
      ['needs-you', ['asking']],
      ['today', ['other']],
    ]);
  });

  it('lists nothing extra without drafts', () => {
    const { unsent, groups } = gotoWithDrafts(rows, [], now, 2, 20);
    expect(unsent).toEqual([]);
    expect(groups).toEqual(gotoGroups(rows, now, 2, 20));
  });
});
