import { describe, expect, it } from 'vitest';
import type { ProjectInfo } from '@seshboard/protocol/client';
import { baseOrder } from './projectList.ts';
import {
  canReorder,
  filterProjects,
  initialProject,
  isNarrowProjects,
  keyboardMove,
  moveAnnouncement,
  moveProject,
  neighbourProject,
  pageAfterOpen,
  PROJECTS_NARROW_PX,
  projectActivity,
  worktreeHint,
} from './projectsNav.ts';
import type { SessionRowData } from './sessionsStore.ts';

const project = (root: string, name: string): ProjectInfo =>
  ({ root, name, nameSource: 'folder', icon: null, iconSource: null, added: true, exists: true, order: null, defaults: {}, profileId: null, sessionCount: 0, lastActivity: null }) as unknown as ProjectInfo;

const HOME = '/Users/me';
const LIST = [project('/Users/me/dev/intranet', 'intranet'), project('/Users/me/dev/vscode-demo-time', 'vscode-demo-time'), project('/Users/me/dev/claude-code-manager', 'Seshboard'), project('/Users/me/dev/vscode-front-matter', 'vscode-front-matter'), project('/Users/me/work/ai', 'ai')];
const roots = (list: readonly { root: string }[]) => list.map((p) => p.root);

describe('the search', () => {
  it('keeps everything, in the saved order, without a query', () => {
    expect(roots(filterProjects(LIST, '  ', HOME))).toEqual(roots(LIST));
  });

  it('matches the name or the folder, ignoring case', () => {
    expect(filterProjects(LIST, 'VS', HOME).map((p) => p.name)).toEqual(['vscode-demo-time', 'vscode-front-matter']);
    // Seshboard's folder is claude-code-manager.
    expect(filterProjects(LIST, 'code-manager', HOME).map((p) => p.name)).toEqual(['Seshboard']);
    expect(filterProjects(LIST, '~/work', HOME).map((p) => p.name)).toEqual(['ai']);
  });

  it('turns dragging off while it filters', () => {
    expect(canReorder('')).toBe(true);
    expect(canReorder(' ')).toBe(true);
    expect(canReorder('vs')).toBe(false);
  });
});

describe('previous and next project', () => {
  it('follows the list order and stops at either end', () => {
    expect(neighbourProject(LIST, LIST[2]!.root, 1)?.name).toBe('vscode-front-matter');
    expect(neighbourProject(LIST, LIST[2]!.root, -1)?.name).toBe('vscode-demo-time');
    expect(neighbourProject(LIST, LIST[0]!.root, -1)).toBeNull();
    expect(neighbourProject(LIST, LIST[4]!.root, 1)).toBeNull();
  });

  it('with a filter on, moves within what the search shows', () => {
    const shown = filterProjects(LIST, 'vs', HOME);
    expect(neighbourProject(shown, shown[0]!.root, 1)?.name).toBe('vscode-front-matter');
    // The open project is hidden by the search: next is the first shown, previous the last.
    expect(neighbourProject(shown, LIST[2]!.root, 1)?.name).toBe('vscode-demo-time');
    expect(neighbourProject(shown, LIST[2]!.root, -1)?.name).toBe('vscode-front-matter');
    expect(neighbourProject([], LIST[2]!.root, 1)).toBeNull();
  });
});

describe('the tab', () => {
  it('a click opens the tab the project was left on, Overview the first time', () => {
    const lastTab = new Map([['/a', 'memory' as const]]);
    expect(pageAfterOpen(lastTab, '/a').tab).toBe('memory');
    expect(pageAfterOpen(lastTab, '/b').tab).toBe('overview');
  });

  it('switching keeps the tab on screen, and the project remembers it', () => {
    const state = pageAfterOpen(new Map([['/b', 'sessions' as const]]), '/b', 'settings');
    expect(state).toMatchObject({ root: '/b', tab: 'settings' });
    expect(state.lastTab.get('/b')).toBe('settings');
  });

  it('the view opens on the project last open, else the first', () => {
    expect(initialProject(LIST, LIST[3]!.root)).toBe(LIST[3]!.root);
    expect(initialProject(LIST, '/gone')).toBe(LIST[0]!.root);
    expect(initialProject(LIST, null)).toBe(LIST[0]!.root);
    expect(initialProject([], null)).toBeNull();
  });
});

describe('the narrow breakpoint', () => {
  it('folds the list away under the breakpoint, and not before the view is measured', () => {
    expect(isNarrowProjects(null)).toBe(false);
    expect(isNarrowProjects(PROJECTS_NARROW_PX - 1)).toBe(true);
    expect(isNarrowProjects(PROJECTS_NARROW_PX)).toBe(false);
    expect(isNarrowProjects(1400)).toBe(false);
  });
});

describe('reordering', () => {
  it('moves an item to its new place', () => {
    expect(moveProject(['a', 'b', 'c', 'd'], 2, 0)).toEqual(['c', 'a', 'b', 'd']);
    expect(moveProject(['a', 'b', 'c', 'd'], 0, 3)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveProject(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
    expect(moveProject(['a', 'b', 'c'], 5, 0)).toEqual(['a', 'b', 'c']);
  });

  it('a drag saves the same order the ↑ ↓ buttons saved', () => {
    // Two clicks on ↑ took the third project to the top; one drag does the same.
    const order = ['a', 'b', 'c', 'd'];
    const clicks = keyboardMove(keyboardMove(order, 'c', -1)!.order, 'c', -1)!.order;
    expect(moveProject(order, 2, 0)).toEqual(clicks);
    // A drag builds on one still on its way to the engine, as the buttons did.
    expect(moveProject(baseOrder(['b', 'a', 'c', 'd'], order), 3, 0)).toEqual(['d', 'b', 'a', 'c']);
  });

  it('⌥⇧↑ ⌥⇧↓ move one place and say where it landed', () => {
    expect(keyboardMove(['a', 'b', 'c'], 'b', 1)).toEqual({ order: ['a', 'c', 'b'], to: 2 });
    expect(keyboardMove(['a', 'b', 'c'], 'a', -1)).toBeNull();
    expect(keyboardMove(['a', 'b', 'c'], 'c', 1)).toBeNull();
    expect(keyboardMove(['a', 'b', 'c'], 'x', 1)).toBeNull();
    expect(moveAnnouncement('Seshboard', 2, 11)).toBe('Seshboard moved to position 3 of 11');
  });
});

describe('the row', () => {
  it('needs you wins over working', () => {
    const row = (projectRoot: string, status: string) => ({ projectRoot, status }) as unknown as SessionRowData;
    const rows = [row('/a', 'running'), row('/a', 'needs-you'), row('/b', 'running'), row('/c', 'idle'), row('/a', 'running')];
    const activity = projectActivity(rows, (r) => (r as unknown as { status: string }).status);
    expect(activity.get('/a')).toBe('needs-you');
    expect(activity.get('/b')).toBe('working');
    expect(activity.has('/c')).toBe(false);
  });

  it('says how many worktrees can go, else how many there are', () => {
    expect(worktreeHint(6, 4)).toBe('4 can go');
    expect(worktreeHint(2, 0)).toBe('2 worktrees');
    expect(worktreeHint(1, 0)).toBe('1 worktree');
    expect(worktreeHint(0, 0)).toBeNull();
  });
});
