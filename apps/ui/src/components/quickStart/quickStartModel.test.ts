import { describe, expect, it } from 'vitest';
import type { ProjectInfo } from '@seshboard/protocol/client';
import type { MenuBarRow } from '../menuBar/menuBarModel.ts';
import type { ProjectActivity } from '../newSession/projectTiles.ts';
import {
  backspaceAtStart,
  changedOptions,
  EMPTY_FIELD,
  firstLine,
  moveActive,
  optionsSource,
  pickProject,
  quickStartProjects,
  quickStartSections,
  quickActions,
  lastSession,
  quickListSection,
  firstActive,
  startProblem,
  tokenLabel,
  whereLabel,
  type QuickOptions,
} from './quickStartModel.ts';

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

function project(root: string, name: string, extra: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    root,
    name,
    nameSource: 'folder',
    icon: null,
    iconSource: null,
    added: true,
    exists: true,
    order: null,
    defaults: { model: null, effort: null, permissionMode: null, workspace: null, baseRef: null, branch: null, defaultBranch: null },
    profileId: null,
    sessionCount: 1,
    lastActivity: null,
    ...extra,
  } as ProjectInfo;
}

const projects = new Map<string, ProjectInfo>([
  ['/p/seshboard', project('/p/seshboard', 'seshboard', { lastActivity: NOW - HOUR, order: 2 })],
  ['/p/demo-time', project('/p/demo-time', 'vscode-demo-time', { lastActivity: NOW - 3 * HOUR, order: 0 })],
  ['/p/worklog', project('/p/worklog', 'worklog-web', { lastActivity: NOW - 2 * HOUR, order: 1 })],
  ['/p/gone', project('/p/gone', 'gone', { exists: false, lastActivity: NOW })],
  ['/p/known', project('/p/known', 'known only', { added: false, lastActivity: NOW })],
]);
const activity = new Map<string, ProjectActivity>([['/p/demo-time', { needsYou: 0, working: 1, open: 1, lastActivity: NOW - 3 * HOUR }]]);
const branches = new Map<string, string | null>([
  ['/p/seshboard', 'dev'],
  ['/p/demo-time', 'main'],
]);
const list = (order: 'recent' | 'yours', filter = '') => quickStartProjects({ projects, activity, branches, order, filter, home: null, now: NOW });

describe('the project list', () => {
  it('lists your projects that are there, in New session’s order', () => {
    expect(list('recent').map((p) => p.name)).toEqual(['seshboard', 'worklog-web', 'vscode-demo-time']);
    expect(list('yours').map((p) => p.name)).toEqual(['vscode-demo-time', 'worklog-web', 'seshboard']);
  });

  it('says the branch and what is going on', () => {
    const [seshboard, , demo] = list('recent');
    expect(seshboard!.meta).toBe('dev · Idle · 1h');
    expect(demo).toMatchObject({ meta: 'main · 1 working', tone: 'working' });
  });

  it('filters by what was typed, best match first', () => {
    expect(list('recent', 'wl').map((p) => p.name)).toEqual(['worklog-web']);
    expect(list('recent', 'zzz')).toEqual([]);
  });
});

describe('the sections', () => {
  const waiting = { id: 's1', section: 'needs-you', title: 'Fix scroll', detail: 'Wants to run npm test' } as MenuBarRow;
  const working = { id: 's2', section: 'working', title: 'Busy', detail: '' } as MenuBarRow;
  const projectsShown = list('recent');

  it('shows Needs you, Projects with ⌘1–⌘9, and More', () => {
    const sections = quickStartSections({ needsYou: [waiting, working], showNeedsYou: true, projects: projectsShown, filter: '', questions: true });
    expect(sections.map((s) => s.id)).toEqual(['needs-you', 'projects', 'more']);
    expect(sections[0]!.rows).toHaveLength(1);
    expect(sections[1]!.rows.map((r) => (r.kind === 'project' ? r.number : null))).toEqual([1, 2, 3]);
  });

  it('numbers only the first nine', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ ...projectsShown[0]!, root: `/p/${i}` }));
    const rows = quickStartSections({ needsYou: [], showNeedsYou: true, projects: many, filter: '', questions: false })[0]!.rows;
    expect(rows.map((r) => (r.kind === 'project' ? r.number : 'x'))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, null, null]);
  });

  it('leaves out Needs you when it is off, or while typing; Quick question only when it matches', () => {
    expect(quickStartSections({ needsYou: [waiting], showNeedsYou: false, projects: projectsShown, filter: '', questions: true }).map((s) => s.id)).toEqual(['projects', 'more']);
    expect(quickStartSections({ needsYou: [waiting], showNeedsYou: true, projects: [], filter: 'qq', questions: true }).map((s) => s.id)).toEqual(['more']);
    expect(quickStartSections({ needsYou: [waiting], showNeedsYou: true, projects: [], filter: 'seshb', questions: true })).toEqual([]);
  });

  it('lists Open Seshboard, the last session, and Working and To review when they have sessions', () => {
    expect(quickActions({ canShoot: true, attached: 0 }).map((a) => a.id)).toEqual(['screenshot', 'open-app']);
    const all = quickActions({ canShoot: false, attached: 0, last: { id: 's1', title: 'Fix the build', project: 'seshboard' }, working: 2, review: 1 });
    expect(all.map((a) => [a.id, a.detail])).toEqual([
      ['open-app', 'Bring its window to the front'],
      ['last-session', 'Fix the build · seshboard'],
      ['working', '2 working'],
      ['review', '1 to review'],
    ]);
    expect(all[1]!.sessionId).toBe('s1');
  });

  it('picks the last session on this computer that is not done', () => {
    const row = (id: string, updatedAt: number, extra: object = {}) => ({ id, title: id, projectRoot: '/p', updatedAt, archivedAt: null, ...extra });
    expect(lastSession([row('a', 1), row('b', 3), row('c', 2)])?.id).toBe('b');
    expect(lastSession([row('a', 1), row('b', 3, { archivedAt: 5 }), row('c', 4, { remote: { computer: 'x' } })])?.id).toBe('a');
    expect(lastSession([])).toBeNull();
  });

  it('lists the sessions of Working or To review, filtered by what was typed', () => {
    const session = (id: string, title: string) => ({ ...waiting, id, title, section: 'working' as const });
    const sessions = [session('a', 'Tidy the changelog'), session('b', 'Fix the smoke test')];
    expect(quickListSection('working', sessions, '')[0]!.rows.map((r) => r.id)).toEqual(['session:a', 'session:b']);
    expect(quickListSection('working', sessions, 'smoke')[0]!.rows.map((r) => r.id)).toEqual(['session:b']);
    expect(quickListSection('review', sessions, 'zzqx')).toEqual([]);
  });

  it('offers another screenshot and Remove all images once images are attached', () => {
    expect(quickActions({ canShoot: true, attached: 2 }).map((a) => [a.label, a.detail])).toEqual([
      ['Take another screenshot', 'Add it to the others'],
      ['Remove all images', '2 attached'],
    ]);
    expect(quickActions({ canShoot: false, attached: 1 }).map((a) => a.id)).toEqual(['clear-images']);
    expect(quickActions({ canShoot: false, attached: 0 }).map((a) => a.id)).toEqual(['open-app']);
  });

  it('puts Actions first, and keeps only the ones that match what was typed', () => {
    const QUICK_ACTIONS = quickActions({ canShoot: true, attached: 0 });
    const all = quickStartSections({ actions: QUICK_ACTIONS, needsYou: [waiting], showNeedsYou: true, projects: projectsShown, filter: '', questions: true });
    expect(all.map((s) => s.id)).toEqual(['actions', 'needs-you', 'projects', 'more']);
    expect(quickStartSections({ actions: QUICK_ACTIONS, needsYou: [], showNeedsYou: true, projects: [], filter: 'screen', questions: false }).map((s) => s.id)).toEqual(['actions']);
    expect(quickStartSections({ actions: QUICK_ACTIONS, needsYou: [], showNeedsYou: true, projects: [], filter: 'xyzq', questions: false })).toEqual([]);
  });

  it('starts on the first row, or on the first project while typing or once something is attached', () => {
    const QUICK_ACTIONS = quickActions({ canShoot: true, attached: 0 });
    const rows = quickStartSections({ actions: QUICK_ACTIONS, needsYou: [], showNeedsYou: true, projects: projectsShown, filter: '', questions: true }).flatMap((s) => s.rows);
    expect(firstActive(rows, { typed: false, attached: false })).toBe(0);
    expect(rows[firstActive(rows, { typed: false, attached: true })]!.kind).toBe('project');
    expect(rows[firstActive(rows, { typed: true, attached: false })]!.kind).toBe('project');
    expect(firstActive(rows.filter((r) => r.kind !== 'project'), { typed: true, attached: false })).toBe(0);
  });

  it('moves with ↑ and ↓, staying at the ends', () => {
    expect(moveActive(3, 0, 'ArrowDown')).toBe(1);
    expect(moveActive(3, 2, 'ArrowDown')).toBe(2);
    expect(moveActive(3, 0, 'ArrowUp')).toBe(0);
    expect(moveActive(3, 1, 'End')).toBe(2);
    expect(moveActive(0, 0, 'ArrowDown')).toBe(-1);
  });
});

describe('the token', () => {
  it('takes the place of the query, and the field takes the task', () => {
    const picked = pickProject({ ...EMPTY_FIELD, query: 'sesh' }, '/p/seshboard');
    expect(picked).toEqual({ project: '/p/seshboard', query: '', task: '' });
  });

  it('goes with ⌫ at the start, keeping the task for when a project is picked again', () => {
    const field = { project: '/p/seshboard', query: '', task: 'Fix it' };
    expect(backspaceAtStart(field, { start: 0, end: 0 })).toEqual({ project: null, query: '', task: 'Fix it' });
    expect(pickProject(backspaceAtStart(field, { start: 0, end: 0 })!, '/p/worklog').task).toBe('Fix it');
  });

  it('stays when the caret is not at the start, or text is selected', () => {
    const field = { project: '/p/seshboard', query: '', task: 'Fix it' };
    expect(backspaceAtStart(field, { start: 3, end: 3 })).toBeNull();
    expect(backspaceAtStart(field, { start: 0, end: 3 })).toBeNull();
    expect(backspaceAtStart(EMPTY_FIELD, { start: 0, end: 0 })).toBeNull();
  });

  it('is announced with how to change it', () => {
    expect(tokenLabel('seshboard')).toBe('Project: seshboard. Backspace to change.');
  });
});

describe('the options', () => {
  const defaults: QuickOptions = { profileId: 'personal', model: 'opus', effort: 'high', permissionMode: 'default', workspace: 'current' };

  it('count as changed only where they differ from the project’s defaults', () => {
    expect(changedOptions(defaults, { ...defaults })).toEqual([]);
    expect(changedOptions(defaults, { ...defaults, model: 'sonnet', workspace: 'worktree' })).toEqual(['model', 'workspace']);
    expect(changedOptions(defaults, { ...defaults, profileId: 'work' })).toEqual(['profileId']);
  });

  it('say where they come from', () => {
    expect(optionsSource(false, 'seshboard')).toBe('From seshboard’s defaults');
    expect(optionsSource(true, 'seshboard')).toBe('Changed for this session');
  });

  it('name where it runs', () => {
    expect(whereLabel('current', 'dev')).toBe('dev, this folder');
    expect(whereLabel('current', null)).toBe('This folder');
    expect(whereLabel('worktree', 'dev')).toBe('New worktree');
  });
});

describe('after a start', () => {
  it('shows the task’s first line, cut short', () => {
    expect(firstLine('  Make it wider\nand more')).toBe('Make it wider');
    expect(firstLine('x'.repeat(80), 20)).toBe(`${'x'.repeat(19)}…`);
  });

  it('says why it failed, with the fix', () => {
    const ok = { folderExists: true, projectName: 'seshboard', signedIn: true, profileName: 'Personal' };
    expect(startProblem(ok)).toBeNull();
    expect(startProblem({ ...ok, folderExists: false })).toEqual({ message: 'seshboard’s folder is gone.', fix: 'pick-project' });
    expect(startProblem({ ...ok, signedIn: false })).toEqual({ message: 'Personal isn’t signed in to Claude Code.', fix: 'sign-in' });
    expect(startProblem({ ...ok, error: 'boom' })).toEqual({ message: 'Couldn’t start: boom', fix: null });
  });
});
