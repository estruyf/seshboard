import { describe, expect, it } from 'vitest';
import type { LaterItem, LiveSession } from '@seshboard/protocol/client';
import type { QueueEntry } from './queue.ts';
import type { RemoteRowInfo } from './remoteRows.ts';
import type { SessionRowData } from './sessionsStore.ts';
import { buildProjectRows, projectState, projectSummary, projectSummaryText, sortInProject } from './sidebarProjectRows.ts';
import type { SidebarListRow } from './sidebarRows.ts';

const NOW = Date.UTC(2026, 10, 12, 12);
const MIN = 60_000;

const row = (id: string, overrides: Partial<SessionRowData> = {}): SessionRowData => ({
  id,
  title: id,
  projectRoot: '/p/a',
  updatedAt: NOW - 60 * MIN,
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

const live = (status: LiveSession['status'], updatedAt: number | null = null): LiveSession => ({
  sessionId: 'x',
  pid: 1,
  cwd: null,
  projectRoot: '/p/a',
  status,
  rawStatus: status,
  name: null,
  origin: 'cli',
  startedAt: null,
  updatedAt,
  profileId: 'default',
});

const remote = (computerName: string, projectName: string, status: RemoteRowInfo['status'] = null): RemoteRowInfo => ({
  computerId: computerName.toLowerCase(),
  computerName,
  sessionId: 's',
  projectId: projectName,
  projectName,
  status,
  waitingTool: null,
  workingSince: null,
  profile: null,
  offline: false,
  lastSeen: null,
});

const entry = (prompt: string, cwd: string): QueueEntry => ({
  item: { id: prompt, cwd, prompt, attachments: [], typed: null, context: [], model: null, effort: null, permissionMode: 'default', workspace: 'current', baseRef: 'fresh', branch: null, profileId: null, autoStart: false, createdAt: NOW, position: 0, waitFor: { kind: 'project' } } as LaterItem,
  state: 'waiting',
  label: null,
  detail: null,
  blockers: [],
  baseState: 'waiting',
  autoStart: false,
  autoBlocked: null,
  finished: null,
  hold: null,
});

const nameOf = (root: string) => root.split('/').pop()!;

/** The rows as short strings: `[project name count]`, `  id`, `  (summary)`, `  queued:prompt`. */
const shape = (rows: SidebarListRow[]) =>
  rows.map((r) =>
    r.kind === 'project'
      ? `[${r.name} ${r.count}${r.open ? '' : ' folded'}]`
      : r.kind === 'session'
        ? `  ${r.child ? '  ' : ''}${r.data.id}${r.kept ? ' (kept)' : ''}`
        : r.kind === 'project-summary'
          ? `  (${projectSummaryText(r.parts)})`
          : r.kind === 'queue-label'
            ? '  Queued'
            : r.kind === 'queue'
              ? `  queued:${r.entry.item.prompt}`
              : `<${r.kind}>`,
  );

const base = { nameOf, archivedOpen: false };

describe('projectState', () => {
  it('reads needs you, working, to review and open from the row', () => {
    expect(projectState(row('a', { live: live('needs-you') }))).toBe('needs-you');
    expect(projectState(row('a', { live: live('running') }))).toBe('working');
    expect(projectState(row('a', { unread: true }))).toBe('review');
    expect(projectState(row('a', { error: true }))).toBe('review');
    expect(projectState(row('a', { live: live('idle') }))).toBe('open');
    expect(projectState(row('a'))).toBe('open');
  });
});

describe('buildProjectRows', () => {
  it('puts projects with a session that needs you first, then the newest', () => {
    const rows = [
      row('old-a', { projectRoot: '/p/alpha', updatedAt: NOW - 300 * MIN }),
      row('new-b', { projectRoot: '/p/beta', updatedAt: NOW - 5 * MIN }),
      row('ask-c', { projectRoot: '/p/gamma', updatedAt: NOW - 900 * MIN, live: live('needs-you') }),
    ];
    expect(shape(buildProjectRows(rows, [], base))).toEqual(['[gamma 1]', '  ask-c', '[beta 1]', '  new-b', '[alpha 1]', '  old-a']);
  });

  it('orders projects by their quickest session to unblock, then by name', () => {
    const rows = [
      row('slow', { projectRoot: '/p/alpha', unread: true }),
      row('fast', { projectRoot: '/p/beta', unread: true, updatedAt: NOW - 900 * MIN }),
      row('read', { projectRoot: '/p/delta' }),
      row('read-too', { projectRoot: '/p/charlie' }),
    ];
    const quick = new Map([
      ['slow', { reviewMinutes: 6, testsFailed: false }],
      ['fast', { reviewMinutes: 1, testsFailed: false }],
    ]);
    expect(shape(buildProjectRows(rows, [], { ...base, sort: 'quickest', quick })).filter((s) => s.startsWith('['))).toEqual(['[beta 1]', '[alpha 1]', '[charlie 1]', '[delta 1]']);
  });

  it('orders a project by state, pinned first in each, then newest', () => {
    const rows = [
      row('open-old', { updatedAt: NOW - 200 * MIN }),
      row('open-pinned', { updatedAt: NOW - 500 * MIN, pinned: true }),
      row('review', { unread: true }),
      row('working', { live: live('running') }),
      row('asks', { live: live('needs-you'), updatedAt: NOW - 800 * MIN }),
      row('open-new', { updatedAt: NOW - 2 * MIN }),
    ];
    expect(sortInProject(rows, 'recent', new Map()).map((r) => r.id)).toEqual(['asks', 'working', 'review', 'open-pinned', 'open-new', 'open-old']);
  });

  it('keeps a pipeline’s sub-sessions under their parent', () => {
    const parent = row('parent', { live: live('running') });
    const children = new Map([['parent', [row('step-1'), row('step-2')]]]);
    expect(shape(buildProjectRows([parent, row('other')], [], { ...base, children, openParents: new Set(['parent']) }))).toEqual(['[a 2]', '  parent', '    step-1', '    step-2', '  other']);
  });

  it('folds a project to one line that says what is in it, and never hides that something needs you', () => {
    const rows = [row('asks', { live: live('needs-you') }), row('w1', { live: live('running') }), row('w2', { live: live('running') }), row('other', { projectRoot: '/p/b' })];
    expect(shape(buildProjectRows(rows, [], { ...base, folded: new Set(['/p/a']) }))).toEqual(['[a 3 folded]', '  (1 needs you · 2 working)', '[b 1]', '  other']);
    expect(projectSummaryText(projectSummary([row('r1', { unread: true }), row('r2', { unread: true }), row('r3', { unread: true })]))).toBe('3 to review');
    expect(projectSummaryText(projectSummary([row('o1'), row('o2')]))).toBe('2 open');
  });

  it('keeps the open session in sight under a folded project', () => {
    const rows = [row('one'), row('two', { unread: true })];
    expect(shape(buildProjectRows(rows, [], { ...base, folded: new Set(['/p/a']), selectedId: 'one' }))).toEqual(['[a 2 folded]', '  (1 to review · 1 open)', '  one (kept)']);
    // A sub-session that is open keeps its parent's row.
    const children = new Map([['two', [row('step')]]]);
    expect(shape(buildProjectRows(rows, [], { ...base, folded: new Set(['/p/a']), selectedId: 'step', children }))).toContain('  two (kept)');
  });

  it('unfolds every project while searching, and leaves out projects with no match', () => {
    const rows = [row('match', { projectRoot: '/p/b' })];
    expect(shape(buildProjectRows(rows, [], { ...base, folded: new Set(['/p/b']), searching: true }))).toEqual(['[b 1]', '  match']);
  });

  it('puts queued prompts in their project, after what needs you and what is working', () => {
    const rows = [row('review', { unread: true }), row('working', { live: live('running') })];
    const queue = [entry('Monthly export', '/p/a'), entry('Notes', '/p/z')];
    expect(shape(buildProjectRows(rows, [], { ...base, queue }))).toEqual(['[a 2]', '  working', '  Queued', '  queued:Monthly export', '  review', '[z 0]', '  Queued', '  queued:Notes']);
  });

  it('lists another computer’s sessions under their project, and names a project on two computers apart', () => {
    const rows = [
      row('here', { projectRoot: '/p/intranet' }),
      row('there', { projectRoot: 'remote:mystic:intranet', remote: remote('Mystic', 'intranet'), updatedAt: NOW - 120 * MIN }),
      row('only-there', { projectRoot: 'remote:mystic:docs', remote: remote('Mystic', 'docs'), updatedAt: NOW - 200 * MIN }),
    ];
    const list = buildProjectRows(rows, [], base);
    expect(shape(list)).toEqual(['[intranet 1]', '  here', '[intranet · Mystic 1]', '  there', '[docs 1]', '  only-there']);
    expect(list.find((r) => r.kind === 'project' && r.key === 'remote:mystic:docs')).toMatchObject({ remote: { computerName: 'Mystic' } });
  });

  it('marks session rows with their project and lists Done after the projects', () => {
    const list = buildProjectRows([row('a')], [row('done')], { ...base, archivedOpen: true });
    expect(shape(list)).toEqual(['[a 1]', '  a', '<archived>', '  done']);
    expect(list[1]).toMatchObject({ kind: 'session', project: '/p/a' });
    expect(list[3]).not.toHaveProperty('project');
  });
});
