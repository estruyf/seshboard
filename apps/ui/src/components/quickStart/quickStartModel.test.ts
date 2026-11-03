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
