import { describe, expect, it } from 'vitest';
import type { LaterItem, LiveSession, SessionHostInfo } from '@switchboard/protocol/client';
import { toRows, useSessions, type SessionRowData } from './sessionsStore.ts';
import { useTilingArea } from './tilingArea.ts';
import type { QueueEntry } from './queue.ts';
import { archivedPlacement, archivedRevealTop, archivesOnMiddleClick, buildListRows, buildSessionList, groupSessions, headerSummary, inScope, isActive, quickestGroups, rowStatus, sectionOfSession, sessionGroup, sessionsByHeader, startOfDay, startupSession, waitingLabel } from './sidebarRows.ts';
import { closedSections, DEFAULT_SECTIONS, parseSections, toggleAllSections } from './sidebarSections.ts';

const NOW = Date.UTC(2026, 9, 5, 12);
const HOUR = 3_600_000;

const row = (id: string, overrides: Partial<SessionRowData> = {}): SessionRowData => ({
  id,
  title: id,
  projectRoot: '/p/a',
  updatedAt: NOW - HOUR,
  branch: null,
  isWorktree: false,
  live: null,
  summary: null,
  pinned: false,
  archivedAt: null,
  restoredAt: null,
  unread: false,
  inApp: false,
  error: false,
  profileId: 'default',
  ...overrides,
});

const live = (status: LiveSession['status']): LiveSession => ({
  sessionId: 'x',
  pid: 1,
  cwd: null,
  projectRoot: '/p/a',
  status,
  rawStatus: status,
  name: null,
  origin: 'cli',
  startedAt: null,
  updatedAt: null,
  profileId: 'default',
});

/** The archive days these tests use: two, the 48 hours sessions were archived after before it was a setting. */
const DAYS = 2;
const old = NOW - DAYS * 24 * HOUR - HOUR;
const ids = (rows: SessionRowData[]) => rows.map((r) => r.id);

describe('rowStatus', () => {
  it('shows the most urgent state', () => {
    expect(rowStatus(row('a', { live: live('needs-you'), unread: true }))).toBe('needs-you');
    expect(rowStatus(row('a', { live: live('running') }))).toBe('running');
    expect(rowStatus(row('a', { error: true, unread: true }))).toBe('error');
    expect(rowStatus(row('a', { unread: true, live: live('idle') }))).toBe('unread');
    expect(rowStatus(row('a', { live: { ...live('idle'), background: ['npm run test:links'] } }))).toBe('background');
    expect(rowStatus(row('a', { live: { ...live('idle'), background: [] } }))).toBe('idle');
    expect(rowStatus(row('a', { live: live('idle') }))).toBe('idle');
    expect(rowStatus(row('a'))).toBeNull();
  });
});

describe('isActive', () => {
  it('keeps recent, open, unread, pinned and failing sessions in the main list', () => {
    expect(isActive(row('a'), NOW, DAYS)).toBe(true);
    expect(isActive(row('a', { updatedAt: old }), NOW, DAYS)).toBe(false);
    expect(isActive(row('a', { updatedAt: old, unread: true }), NOW, DAYS)).toBe(true);
    expect(isActive(row('a', { updatedAt: old, pinned: true }), NOW, DAYS)).toBe(true);
    expect(isActive(row('a', { updatedAt: old, live: { ...live('idle'), origin: 'app' } }), NOW, DAYS)).toBe(true);
    // Idle in another Claude Code window (e.g. Claude desktop reopening it at launch) isn't news.
    expect(isActive(row('a', { updatedAt: old, live: live('idle') }), NOW, DAYS)).toBe(false);
    expect(isActive(row('a', { updatedAt: old, error: true }), NOW, DAYS)).toBe(true);
  });

  it('honours archiving by hand until there is new activity, but never hides work in progress', () => {
    expect(isActive(row('a', { archivedAt: NOW - HOUR / 2 }), NOW, DAYS)).toBe(false);
    expect(isActive(row('a', { archivedAt: NOW - 2 * HOUR }), NOW, DAYS)).toBe(true);
    expect(isActive(row('a', { archivedAt: NOW, live: live('idle') }), NOW, DAYS)).toBe(false);
    expect(isActive(row('a', { archivedAt: NOW, live: live('needs-you') }), NOW, DAYS)).toBe(true);
    // Archiving a session that's working hides it until it finishes, despite its updates.
    expect(isActive(row('a', { archivedAt: NOW - HOUR, updatedAt: NOW, live: live('running') }), NOW, DAYS)).toBe(false);
    expect(isActive(row('a', { archivedAt: NOW - HOUR, updatedAt: NOW, live: live('idle') }), NOW, DAYS)).toBe(true);
  });

  it('keeps a session unarchived by hand in the main list until it has new activity', () => {
    expect(isActive(row('a', { updatedAt: old, restoredAt: old + HOUR }), NOW, DAYS)).toBe(true);
    expect(isActive(row('a', { updatedAt: old - 30 * 24 * HOUR, restoredAt: old }), NOW, DAYS)).toBe(true);
    // Activity since then: archived again after 48 quiet hours, like any session.
    expect(isActive(row('a', { updatedAt: old, restoredAt: old - HOUR }), NOW, DAYS)).toBe(false);
  });

  it('archives after the days set in Settings › Sessions', () => {
    const day = 24 * HOUR;
    const quiet = row('a', { updatedAt: NOW - 4 * day });
    expect(isActive(quiet, NOW, 3)).toBe(false);
    expect(isActive(quiet, NOW, 5)).toBe(true);
    expect(isActive(row('a', { updatedAt: NOW - 2 * day }), NOW, 1)).toBe(false);
    expect(isActive(row('a', { updatedAt: NOW - 300 * day }), NOW, 365)).toBe(true);
  });
});

describe('archivesOnMiddleClick', () => {
  // Only indexed sessions have flags; the summary's fields don't matter here.
  const indexed = (id: string, overrides: Partial<SessionRowData> = {}) => row(id, { summary: { id } as SessionRowData['summary'], ...overrides });

  it('archives finished sessions in the main list only', () => {
    expect(archivesOnMiddleClick(indexed('a'), NOW, DAYS)).toBe(true);
    expect(archivesOnMiddleClick(indexed('a', { unread: true }), NOW, DAYS)).toBe(true);
    expect(archivesOnMiddleClick(indexed('a', { live: live('idle') }), NOW, DAYS)).toBe(true);
    expect(archivesOnMiddleClick(indexed('a', { pinned: true }), NOW, DAYS)).toBe(true);
    expect(archivesOnMiddleClick(indexed('a', { live: live('running') }), NOW, DAYS)).toBe(false);
    expect(archivesOnMiddleClick(indexed('a', { live: live('needs-you') }), NOW, DAYS)).toBe(false);
    expect(archivesOnMiddleClick(indexed('a', { live: { ...live('idle'), background: ['npm run dev'] } }), NOW, DAYS)).toBe(false);
    expect(archivesOnMiddleClick(indexed('a', { error: true }), NOW, DAYS)).toBe(false);
    expect(archivesOnMiddleClick(indexed('a', { archivedAt: NOW }), NOW, DAYS)).toBe(false);
    expect(archivesOnMiddleClick(row('a'), NOW, DAYS)).toBe(false);
  });
});

describe('buildSessionList', () => {
  const rows = [
    row('recent', { updatedAt: NOW - HOUR }),
    row('newest', { updatedAt: NOW - 60_000, projectRoot: '/p/b' }),
    row('pinned-old', { updatedAt: old, pinned: true }),
    row('old', { updatedAt: old, title: 'Fix login' }),
    row('older', { updatedAt: old - HOUR, projectRoot: '/p/b' }),
  ];

  it('puts pinned first, then newest, and the rest in Archived', () => {
    const list = buildSessionList(rows, { search: '', project: null, now: NOW, archiveAfterDays: DAYS });
    expect(ids(list.active)).toEqual(['pinned-old', 'newest', 'recent']);
    expect(ids(list.archived)).toEqual(['old', 'older']);
  });

  it('lists sessions archived by hand with the quiet ones, newest first', () => {
    const list = buildSessionList([...rows, row('gone-recent', { archivedAt: NOW })], { search: '', project: null, now: NOW, archiveAfterDays: DAYS });
    expect(ids(list.active)).toEqual(['pinned-old', 'newest', 'recent']);
    expect(ids(list.archived)).toEqual(['gone-recent', 'old', 'older']);
  });

  it('lists only Switchboard sessions in that scope', () => {
    const mixed = [row('mine', { inApp: true }), row('cli')];
    expect(ids(buildSessionList(mixed, { search: '', project: null, now: NOW, archiveAfterDays: DAYS, scope: 'switchboard' }).active)).toEqual(['mine']);
    expect(ids(buildSessionList(mixed, { search: '', project: null, now: NOW, archiveAfterDays: DAYS, scope: 'all' }).active)).toEqual(['mine', 'cli']);
    expect(inScope(row('cli'), 'switchboard')).toBe(false);
  });

  it('filters by project and by search', () => {
    expect(ids(buildSessionList(rows, { search: '', project: '/p/b', now: NOW, archiveAfterDays: DAYS }).active)).toEqual(['newest']);
    const found = buildSessionList(rows, { search: 'LOGIN', project: null, now: NOW, archiveAfterDays: DAYS });
    expect([...ids(found.active), ...ids(found.archived)]).toEqual(['old']);
  });
});

describe('groupSessions', () => {
  // Relative to local midnight, so the tests hold in any time zone.
  const midnight = startOfDay(NOW);
  const rows = [
    row('pinned-yesterday', { updatedAt: midnight - HOUR, pinned: true }),
    row('today', { updatedAt: midnight + HOUR }),
    row('waiting', { updatedAt: midnight - 3 * 24 * HOUR, live: live('needs-you') }),
    row('busy', { updatedAt: NOW, live: live('running') }),
    row('yesterday', { updatedAt: midnight - 2 * HOUR }),
    row('earlier', { updatedAt: midnight - 30 * HOUR }),
    row('failed-today', { updatedAt: NOW - 60_000, error: true }),
  ];

  it('puts needs-you and working first, then the rest by the day of their last activity', () => {
    expect(sessionGroup(rows[2]!, NOW)).toBe('needs-you');
    expect(sessionGroup(rows[3]!, NOW)).toBe('working');
    expect(sessionGroup(rows[1]!, NOW)).toBe('today');
    expect(sessionGroup(row('x', { updatedAt: midnight }), NOW)).toBe('today');
    expect(sessionGroup(row('x', { updatedAt: midnight - 1 }), NOW)).toBe('yesterday');
    expect(sessionGroup(rows[5]!, NOW)).toBe('earlier');
    // A failed run is news, but not a section of its own: its badge shows it.
    expect(sessionGroup(rows[6]!, NOW)).toBe('today');
    // Idle with a background task isn't "Working": nothing for you to watch in the conversation.
    expect(sessionGroup(row('x', { live: { ...live('idle'), background: ['npm test'] } }), NOW)).toBe('today');
  });

  it('puts pinned sessions in Pinned, unless they wait on you or are working', () => {
    expect(sessionGroup(rows[0]!, NOW)).toBe('pinned');
    expect(sessionGroup(row('x', { pinned: true, live: live('needs-you') }), NOW)).toBe('needs-you');
    expect(sessionGroup(row('x', { pinned: true, live: live('running') }), NOW)).toBe('working');
    expect(sessionGroup(row('x', { pinned: true, unread: true }), NOW)).toBe('pinned');
  });

  it('keeps the given order inside a section and skips empty sections', () => {
    const groups = groupSessions(rows, NOW);
    expect(groups.map((g) => [g.group, ids(g.rows)])).toEqual([
      ['needs-you', ['waiting']],
      ['working', ['busy']],
      ['pinned', ['pinned-yesterday']],
      ['today', ['today', 'failed-today']],
      ['yesterday', ['yesterday']],
      ['earlier', ['earlier']],
    ]);
    expect(groupSessions([rows[1]!], NOW).map((g) => g.group)).toEqual(['today']);
    expect(groupSessions([], NOW)).toEqual([]);
  });

  it('orders Working by when you set each session going, not by its last write', () => {
    const working = (id: string, since: number, updatedAt: number, pinned = false) => row(id, { updatedAt, pinned, live: { ...live('running'), updatedAt: since } });
    // 'first' was started before 'second' but wrote more recently: it stays below.
    const rows = [working('first', NOW - 10 * 60_000, NOW), working('second', NOW - 5 * 60_000, NOW - 60_000), working('pin', NOW - HOUR, NOW - HOUR, true)];
    const list = buildSessionList(rows, { search: '', project: null, now: NOW, archiveAfterDays: DAYS });
    expect(groupSessions(list.active, NOW).map((g) => ids(g.rows))).toEqual([['pin', 'second', 'first']]);
  });

  it('lists pinned sessions above the days, newest first', () => {
    const list = buildSessionList(
      [row('new', { updatedAt: NOW - 60_000 }), row('pin', { updatedAt: midnight + 1, pinned: true }), row('old-pin', { updatedAt: old, pinned: true })],
      { search: '', project: null, now: NOW, archiveAfterDays: DAYS },
    );
    expect(groupSessions(list.active, NOW).map((g) => [g.group, ids(g.rows)])).toEqual([
      ['pinned', ['pin', 'old-pin']],
      ['today', ['new']],
    ]);
  });

  it('keeps pinned sessions at the top of Needs you', () => {
    const list = buildSessionList([row('ask', { updatedAt: NOW, live: live('needs-you') }), row('pin', { updatedAt: old, pinned: true, live: live('needs-you') })], { search: '', project: null, now: NOW, archiveAfterDays: DAYS });
    expect(groupSessions(list.active, NOW).map((g) => ids(g.rows))).toEqual([['pin', 'ask']]);
  });
});

describe('buildListRows', () => {
  const midnight = startOfDay(NOW);
  const active = [row('busy', { live: live('running') }), row('a', { updatedAt: midnight + HOUR }), row('b', { updatedAt: midnight + 2 * HOUR })];
  const archived = [row('old', { updatedAt: old })];
  const shape = (rows: ReturnType<typeof buildListRows>) =>
    rows.map((r) =>
      r.kind === 'session'
        ? `${r.data.id}${r.kept ? ' (kept)' : ''}`
        : r.kind === 'group'
          ? `[${r.group} ${r.count}${r.first ? ' first' : ''}${r.open ? '' : ' closed'}]`
          : r.kind === 'queue'
            ? `queue:${r.entry.item.prompt}`
            : r.kind === 'hidden'
              ? `+${r.count} hidden`
              : `[${r.kind === 'queue-header' ? 'queue' : 'archived'} ${r.count} ${r.open ? 'open' : 'closed'}${r.kind === 'queue-header' && r.first ? ' first' : ''}]`,
    );
  const saved = (prompt: string, cwd = '/p/a'): LaterItem => ({
    id: prompt,
    cwd,
    prompt,
    attachments: [],
    typed: null,
    context: [],
    model: null,
    effort: null,
    permissionMode: 'default',
    workspace: 'current',
    baseRef: 'fresh',
    branch: null,
    profileId: null,
    createdAt: NOW,
    position: 0,
    waitFor: { kind: 'project' },
  });
  const entry = (prompt: string, state: QueueEntry['state'] = 'waiting'): QueueEntry => ({ item: saved(prompt), state, label: null, detail: null, blockers: [] });
  const queueOf = (...prompts: string[]) => ({ entries: prompts.map((p) => entry(p)), ready: 0 });

  it('puts a header above each section and an open Archived last', () => {
    // Closed, its header is docked under the list rather than in it.
    expect(shape(buildListRows(active, archived, { now: NOW, archivedOpen: false }))).toEqual(['[working 1 first]', 'busy', '[today 2]', 'a', 'b']);
    const open = buildListRows(active, archived, { now: NOW, archivedOpen: true });
    expect(shape(open)).toEqual(['[working 1 first]', 'busy', '[today 2]', 'a', 'b', '[archived 1 open]', 'old']);
    expect(open.at(-1)).toMatchObject({ kind: 'session', archived: true });
  });

  it('shows no Archived toggle without archived sessions, and no headers for an empty list', () => {
    expect(shape(buildListRows([], [], { now: NOW, archivedOpen: true }))).toEqual([]);
    expect(shape(buildListRows([], archived, { now: NOW, archivedOpen: true }))).toEqual(['[archived 1 open]', 'old']);
  });

  it('puts the Queue right under Working, above Pinned, and only when it has items', () => {
    const pinned = row('pin', { pinned: true, updatedAt: midnight + 3 * HOUR });
    const queue = queueOf('Monthly export', 'Speaker notes');
    expect(shape(buildListRows([...active, pinned], archived, { now: NOW, archivedOpen: false, queue }))).toEqual([
      '[working 1 first]',
      'busy',
      '[queue 2 open]',
      'queue:Monthly export',
      'queue:Speaker notes',
      '[pinned 1]',
      'pin',
      '[today 2]',
      'a',
      'b',
    ]);
    // Without Working, it takes Working's place: after Needs you, before the rest.
    const waiting = row('ask', { live: live('needs-you') });
    expect(shape(buildListRows([waiting, active[1]!], [], { now: NOW, archivedOpen: false, queue }))).toEqual(['[needs-you 1 first]', 'ask', '[queue 2 open]', 'queue:Monthly export', 'queue:Speaker notes', '[today 1]', 'a']);
    expect(shape(buildListRows([], [], { now: NOW, archivedOpen: false, queue }))).toEqual(['[queue 2 open first]', 'queue:Monthly export', 'queue:Speaker notes']);
    expect(shape(buildListRows(active, [], { now: NOW, archivedOpen: false, queue: { entries: [], ready: 0 } }))).toEqual(['[working 1 first]', 'busy', '[today 2]', 'a', 'b']);
  });

  it('in Quickest to unblock, ranks what needs you, then what you read, then what still works, without the Queue or Pinned', () => {
    const quick = new Map([
      ['slow', { reviewMinutes: 5, testsFailed: false }],
      ['fast', { reviewMinutes: 2, testsFailed: false }],
      ['fast-failing', { reviewMinutes: 2, testsFailed: true }],
      ['ask', { reviewMinutes: 1, testsFailed: false }],
    ]);
    const list = [
      row('read-old', { updatedAt: NOW - 3 * HOUR }),
      row('slow', { unread: true }),
      row('fast-failing', { unread: true, updatedAt: NOW - 10 * 60_000 }),
      row('pin', { pinned: true }),
      row('no-card', { unread: true }),
      row('busy', { live: live('running') }),
      row('fast', { unread: true }),
      row('ask', { live: live('needs-you') }),
      row('failed', { error: true }),
    ];
    expect(quickestGroups(list, quick).map((g) => [g.group, g.rows.map((r) => r.id)])).toEqual([
      // Waiting for you first; then by review time, failing tests last among equals, and sessions without a card after.
      ['review', ['ask', 'fast', 'fast-failing', 'slow', 'no-card', 'failed']],
      ['read', ['pin', 'read-old']],
      ['still-working', ['busy']],
    ]);
    expect(shape(buildListRows(list, [], { now: NOW, archivedOpen: false, queue: queueOf('Idea'), sort: 'quickest', quick }))).toEqual([
      '[review 6 first]',
      'ask',
      'fast',
      'fast-failing',
      'slow',
      'no-card',
      'failed',
      '[read 2]',
      'pin',
      'read-old',
      '[still-working 1]',
      'busy',
    ]);
  });

  it('never closes Needs review, and says nothing on Still working’s closed header', () => {
    const list = [row('a', { unread: true }), row('b', { live: live('running') })];
    const rows = buildListRows(list, [], { now: NOW, archivedOpen: false, sort: 'quickest', closed: new Set(['still-working']) });
    expect(shape(rows)).toEqual(['[review 1 first]', 'a', '[still-working 1 closed]']);
  });

  it('never offers queued prompts to Select all', () => {
    const rows = buildListRows(active, archived, { now: NOW, archivedOpen: true, queue: queueOf('Idea') });
    expect([...sessionsByHeader(rows)]).toEqual([['working', ['busy']], ['today', ['a', 'b']], ['archived', ['old']]]);
  });

  it('skips the rows of closed sections and keeps their headers and counts', () => {
    const closed = new Set(['working', 'today', 'queue'] as const);
    expect(shape(buildListRows(active, [], { now: NOW, archivedOpen: false, queue: queueOf('Idea'), closed }))).toEqual(['[working 1 first closed]', '[queue 1 closed]', '[today 2 closed]']);
    // Needs you never closes.
    const waiting = row('ask', { live: live('needs-you') });
    expect(shape(buildListRows([waiting], [], { now: NOW, archivedOpen: false, closed: new Set(['working']) }))).toEqual(['[needs-you 1 first]', 'ask']);
  });

  it('keeps the open session under its closed header, with how many are hidden', () => {
    const closed = new Set(['today'] as const);
    expect(shape(buildListRows(active, [], { now: NOW, archivedOpen: false, closed, selectedId: 'b' }))).toEqual(['[working 1 first]', 'busy', '[today 2 closed]', 'b (kept)', '+1 hidden']);
    // The only session in it: nothing else is hidden.
    expect(shape(buildListRows(active, [], { now: NOW, archivedOpen: false, closed: new Set(['working']), selectedId: 'busy' }))).toEqual(['[working 1 first closed]', 'busy (kept)', '[today 2]', 'a', 'b']);
  });

  it('sums up a header: ready items on the Queue, unread sessions on a closed section', () => {
    const unread = [row('u1', { unread: true, updatedAt: midnight + HOUR }), row('u2', { unread: true, updatedAt: midnight + 2 * HOUR }), row('r', { updatedAt: midnight + 3 * HOUR })];
    const rows = buildListRows(unread, [], { now: NOW, archivedOpen: false, queue: { entries: [entry('Idea', 'ready')], ready: 1 }, closed: new Set(['today']) });
    const headers = rows.filter((r) => r.kind === 'group' || r.kind === 'queue-header');
    expect(headers.map((h) => headerSummary(h))).toEqual([
      { text: '1 ready', tone: 'ok' },
      { text: '2 unread', tone: 'unread' },
    ]);
    // Open, a section says nothing more than its count; the Queue says nothing with none ready.
    const open = buildListRows(unread, [], { now: NOW, archivedOpen: false, queue: queueOf('Idea') });
    expect(open.filter((r) => r.kind === 'group' || r.kind === 'queue-header').map((h) => headerSummary(h))).toEqual([null, null]);
  });

  it('finds the section a session sits in', () => {
    const all = [...active, ...archived];
    expect(sectionOfSession(all, 'busy', NOW, DAYS)).toBe('working');
    expect(sectionOfSession(all, 'a', NOW, DAYS)).toBe('today');
    expect(sectionOfSession(all, 'old', NOW, DAYS)).toBeNull();
    expect(sectionOfSession(all, 'missing', NOW, DAYS)).toBeNull();
  });

  it('lists the sessions under each header, for Select all', () => {
    const open = sessionsByHeader(buildListRows(active, archived, { now: NOW, archivedOpen: true }));
    expect([...open]).toEqual([['working', ['busy']], ['today', ['a', 'b']], ['archived', ['old']]]);
    expect(sessionsByHeader(buildListRows(active, archived, { now: NOW, archivedOpen: false })).has('archived')).toBe(false);
  });

  it('docks Archived while it is closed, and lists it while it is open or a search shows its matches', () => {
    expect(archivedPlacement(3, { open: false, searching: false })).toBe('dock');
    expect(archivedPlacement(3, { open: true, searching: false })).toBe('list');
    expect(archivedPlacement(3, { open: false, searching: true })).toBe('list');
    expect(archivedPlacement(0, { open: true, searching: true })).toBeNull();
  });

  it('scrolls an opened Archived to the top only when its header landed below the middle', () => {
    const view = { scrollTop: 0, height: 400, maxScroll: 1000 };
    // High enough already: left alone.
    expect(archivedRevealTop(150, view)).toBeNull();
    expect(archivedRevealTop(200, view)).toBeNull();
    // Below the middle: the header goes 8px from the top.
    expect(archivedRevealTop(320, view)).toBe(312);
    // Measured from where the list is scrolled to, and never past the end.
    expect(archivedRevealTop(550, { ...view, scrollTop: 400 })).toBeNull();
    expect(archivedRevealTop(700, { ...view, scrollTop: 400 })).toBe(692);
    expect(archivedRevealTop(900, { ...view, maxScroll: 500 })).toBe(500);
  });
});

describe('sidebar sections', () => {
  it('starts with Earlier closed and reads the saved state leniently', () => {
    expect(parseSections(null)).toEqual(DEFAULT_SECTIONS);
    expect(DEFAULT_SECTIONS.earlier).toBe(false);
    expect(parseSections({ open: { today: false, earlier: true, 'needs-you': false, queue: 'no' } })).toEqual({ ...DEFAULT_SECTIONS, today: false, earlier: true });
    expect(parseSections('garbage')).toEqual(DEFAULT_SECTIONS);
  });

  it('shows every section while searching or filtering by project, then the saved state again', () => {
    const open = { ...DEFAULT_SECTIONS, today: false };
    expect([...closedSections(open, { search: '', project: null })].sort()).toEqual(['earlier', 'today']);
    expect([...closedSections(open, { search: 'export', project: null })]).toEqual([]);
    expect([...closedSections(open, { search: '', project: '/p/a' })]).toEqual([]);
    expect([...closedSections(open, { search: '  ', project: null })].sort()).toEqual(['earlier', 'today']);
  });

  it('opens or closes every section at once from one header', () => {
    expect(Object.values(toggleAllSections(DEFAULT_SECTIONS, 'today')).every((on) => !on)).toBe(true);
    expect(Object.values(toggleAllSections(DEFAULT_SECTIONS, 'earlier')).every((on) => on)).toBe(true);
  });
});

describe('waitingLabel', () => {
  it('says what a waiting session asks for', () => {
    expect(waitingLabel('Bash')).toBe('Permission: Bash');
    expect(waitingLabel('AskUserQuestion')).toBe('Question');
    expect(waitingLabel('ExitPlanMode')).toBe('Plan to review');
    expect(waitingLabel(null)).toBe('Waiting for you');
  });
});

describe('toRows', () => {
  it('merges live state and adds rows for live sessions without a transcript yet', () => {
    const l = { ...live('running'), sessionId: 'new', cwd: '/p/a/sub', startedAt: 7 };
    expect(toRows(new Map(), new Map([['new', l]]))).toMatchObject([{ id: 'new', title: 'New session', projectRoot: '/p/a', updatedAt: 7, live: l, inApp: false }]);
  });

  it('does not let an idle process move a session up', () => {
    const summary = { id: 's', title: 's', firstPrompt: null, customTitle: null, cwd: '/p/a', projectRoot: '/p/a', gitBranch: null, worktree: null, origin: 'cli', createdAt: null, updatedAt: 1_000, fileSize: null, tag: null, pinned: false, archivedAt: null, restoredAt: null, viewedAt: null, unread: false, inApp: false, profileId: 'default' } as const;
    const sessions = new Map([['s', summary]]);
    expect(toRows(sessions, new Map([['s', { ...live('idle'), sessionId: 's', updatedAt: 9_000 }]]))[0]!.updatedAt).toBe(1_000);
    expect(toRows(sessions, new Map([['s', { ...live('running'), sessionId: 's', updatedAt: 9_000 }]]))[0]!.updatedAt).toBe(9_000);
  });

  it('prefers the state of sessions running in this app and flags failed runs', () => {
    const host: SessionHostInfo = { sessionId: 'mine', cwd: '/p/a/.claude/worktrees/wt', state: 'needs-you', model: null, permissionMode: 'default', effort: null, costUsd: 0, contextPercent: null, contextTokens: null, contextMax: null, error: null, startedAt: 5, promptedAt: null, queue: [], queueHold: null, profileId: 'default', backgroundTasks: [] };
    const closed: SessionHostInfo = { ...host, sessionId: 'old', state: 'closed' };
    const rows = toRows(new Map(), new Map(), new Map([['mine', host], ['old', closed]]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'mine', projectRoot: '/p/a', live: { status: 'needs-you', origin: 'app' }, inApp: true });
  });

  it('puts a session started in this app above one already working', () => {
    const summary = { id: 'busy', title: 'busy', firstPrompt: null, customTitle: null, cwd: '/p/a', projectRoot: '/p/a', gitBranch: null, worktree: null, origin: 'cli', createdAt: null, updatedAt: NOW - HOUR, fileSize: null, tag: null, pinned: false, archivedAt: null, restoredAt: null, viewedAt: null, unread: false, inApp: true, profileId: 'default' } as const;
    const busy: SessionHostInfo = { sessionId: 'busy', cwd: '/p/a', state: 'running', model: null, permissionMode: 'default', effort: null, costUsd: 0, contextPercent: null, contextTokens: null, contextMax: null, error: null, startedAt: NOW - 2 * HOUR, promptedAt: null, queue: [], queueHold: null, profileId: 'default', backgroundTasks: [] };
    const fresh: SessionHostInfo = { ...busy, sessionId: 'fresh', state: 'starting', startedAt: NOW };
    const rows = toRows(new Map([['busy', summary]]), new Map(), new Map([['busy', busy], ['fresh', fresh]]));
    expect(ids(buildSessionList(rows, { search: '', project: null, now: NOW, archiveAfterDays: DAYS }).active)).toEqual(['fresh', 'busy']);
  });

  it('dates a session from this app by the last message you sent it', () => {
    const host: SessionHostInfo = { sessionId: 'mine', cwd: '/p/a', state: 'running', model: null, permissionMode: 'default', effort: null, costUsd: 0, contextPercent: null, contextTokens: null, contextMax: null, error: null, startedAt: 5, promptedAt: 50, queue: [], queueHold: null, profileId: 'default', backgroundTasks: [] };
    expect(toRows(new Map(), new Map(), new Map([['mine', host]]))[0]!.live).toMatchObject({ startedAt: 5, updatedAt: 50 });
  });
});

describe('panes', () => {
  const reset = () => useSessions.setState({ selectedId: null, layout: null, paneIds: [], view: 'session' });
  const state = () => {
    const s = useSessions.getState();
    return { panes: s.paneIds, selected: s.selectedId };
  };

  it('opens sessions beside, selects into the active pane, and closes back to one', () => {
    reset();
    const s = useSessions.getState();
    s.select('a');
    expect(state()).toEqual({ panes: ['a'], selected: 'a' });
    s.openBeside('b');
    expect(state()).toEqual({ panes: ['a', 'b'], selected: 'b' });
    s.select('c');
    expect(state()).toEqual({ panes: ['a', 'c'], selected: 'c' });
    // Selecting what another pane shows just focuses it.
    s.select('a');
    expect(state()).toEqual({ panes: ['a', 'c'], selected: 'a' });
    s.openBeside('d');
    expect(state()).toEqual({ panes: ['a', 'd', 'c'], selected: 'd' });
    s.closePane('a');
    expect(state()).toEqual({ panes: ['d', 'c'], selected: 'd' });
    s.closeOtherPanes();
    expect(state()).toEqual({ panes: ['d'], selected: 'd' });
  });

  it('keeps the selected session in the active pane through every change', () => {
    reset();
    const s = useSessions.getState();
    s.select('a');
    s.openBeside('b');
    s.openBeside('c');
    s.focusPane('a');
    expect(useSessions.getState().selectedId).toBe('a');
    s.swapPanes();
    expect(useSessions.getState().selectedId).toBe('a');
    s.flipSplit();
    expect(useSessions.getState().selectedId).toBe('a');
    s.focusNext();
    expect(useSessions.getState().selectedId).not.toBe('a');
    expect(useSessions.getState().paneIds).toContain(useSessions.getState().selectedId);
  });

  it('closes the panes showing archived sessions', () => {
    reset();
    const s = useSessions.getState();
    s.select('a');
    s.openBeside('b');
    s.closeSessions(['x']);
    expect(state()).toEqual({ panes: ['a', 'b'], selected: 'b' });
    s.closeSessions(['a']);
    expect(state()).toEqual({ panes: ['b'], selected: 'b' });
    s.openBeside('c');
    s.closeSessions(['c']);
    expect(state()).toEqual({ panes: ['b'], selected: 'b' });
    s.openBeside('c');
    s.closeSessions(['b', 'c']);
    expect(state()).toEqual({ panes: [], selected: null });
    s.select('d');
    s.closeSessions(['d']);
    expect(state()).toEqual({ panes: [], selected: null });
  });

  it('keeps the same sessions array while only sizes change, so the sidebar does not redraw', () => {
    reset();
    const s = useSessions.getState();
    s.select('a');
    s.openBeside('b');
    const before = useSessions.getState().paneIds;
    s.resizePanes({ direction: 'row', children: [{ id: 'a' }, { id: 'b' }], sizes: [0.3, 0.7] });
    expect(useSessions.getState().paneIds).toBe(before);
    expect(useSessions.getState().layout).toMatchObject({ sizes: [0.3, 0.7] });
  });

  it('says so, and opens nothing, when the window has no room for another pane', () => {
    reset();
    useTilingArea.getState().set({ width: 700, height: 360 });
    const s = useSessions.getState();
    s.select('a');
    s.openBeside('b');
    s.openBeside('c');
    expect(state()).toEqual({ panes: ['a', 'b'], selected: 'b' });
    s.dropOn('c', { kind: 'pane', id: 'a', zone: 'top' });
    expect(state()).toEqual({ panes: ['a', 'b'], selected: 'b' });
    useTilingArea.getState().set(null);
    s.openBeside('c');
    expect(state()).toEqual({ panes: ['a', 'b', 'c'], selected: 'c' });
  });

  it('turns a split only when the result fits the window', () => {
    reset();
    const s = useSessions.getState();
    s.select('a');
    s.openBeside('b');
    s.openBeside('c');
    const before = useSessions.getState().layout;
    useTilingArea.getState().set({ width: 1100, height: 700 });
    s.flipSplit();
    expect(useSessions.getState().layout).toBe(before);
    useTilingArea.getState().set(null);
    s.flipSplit();
    expect(useSessions.getState().layout).not.toBe(before);
  });

  it('drops a pane or a new session onto a part of a pane', () => {
    reset();
    const s = useSessions.getState();
    s.select('a');
    s.openBeside('b');
    s.dropOn('a', { kind: 'pane', id: 'b', zone: 'right' });
    expect(state()).toEqual({ panes: ['b', 'a'], selected: 'a' });
    s.dropOn('n', { kind: 'pane', id: 'b', zone: 'bottom' });
    expect(state()).toEqual({ panes: ['b', 'n', 'a'], selected: 'n' });
    s.dropOn('x', { kind: 'pane', id: 'n', zone: 'center' });
    expect(state()).toEqual({ panes: ['b', 'x', 'a'], selected: 'x' });
  });

  it('docks along a window edge, and a session already open moves instead of opening twice', () => {
    reset();
    const s = useSessions.getState();
    s.select('a');
    s.openBeside('b');
    s.openBeside('c');
    useTilingArea.getState().set({ width: 2400, height: 1200 });
    s.dropOn('c', { kind: 'edge', side: 'right' });
    expect(state().panes).toHaveLength(3);
    expect(useSessions.getState().layout).toMatchObject({ direction: 'row' });
    s.dropOn('n', { kind: 'edge', side: 'left' });
    expect(state()).toEqual({ panes: ['n', 'a', 'b', 'c'], selected: 'n' });
    // The sidebar row of a session that is open moves its pane: still four panes, none duplicated.
    s.dropOn('a', { kind: 'edge', side: 'bottom' });
    expect([...useSessions.getState().paneIds].sort()).toEqual(['a', 'b', 'c', 'n']);
    useTilingArea.getState().set(null);
  });
});

describe('startupSession', () => {
  const rows = [row('mine', { inApp: true }), row('terminal')];

  it('reopens the last session the sidebar lists', () => {
    expect(startupSession(rows, 'mine', 'last', 'switchboard')).toBe('mine');
    expect(startupSession(rows, 'terminal', 'last', 'all')).toBe('terminal');
  });

  it('opens New session for a hidden, missing or unknown session, or when asked to', () => {
    expect(startupSession(rows, 'terminal', 'last', 'switchboard')).toBeNull();
    expect(startupSession(rows, 'gone', 'last', 'all')).toBeNull();
    expect(startupSession(rows, null, 'last', 'all')).toBeNull();
    expect(startupSession(rows, 'mine', 'new', 'all')).toBeNull();
    expect(startupSession(rows, 'mine', 'home', 'all')).toBeNull();
  });
});
