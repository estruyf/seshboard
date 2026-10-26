import { describe, expect, it } from 'vitest';
import type { ProjectInfo } from '@seshboard/protocol/client';
import { baseOrder, moveRoot, projectByName } from './projectList.ts';

const project = (root: string, name: string, added: boolean, order: number | null = null): ProjectInfo => ({
  root,
  name,
  icon: null,
  nameSource: 'folder',
  iconSource: null,
  added,
  exists: true,
  order,
  defaults: { model: null, effort: null, permissionMode: null, workspace: null, baseRef: null, branch: null, defaultBranch: null },
  profileId: null,
  sessionCount: 0,
  lastActivity: null,
});
const map = (...list: ProjectInfo[]) => new Map(list.map((p) => [p.root, p]));

describe('projectByName', () => {
  const projects = map(
    project('/work/payments-api', 'Payments', true, 1),
    project('/old/payments', 'payments', true, 2),
    project('/work/web', 'Website', true, 0),
    project('/tmp/scratch', 'scratch', false),
  );

  it('matches a project name, ignoring case, first in your order', () => {
    expect(projectByName(projects, 'PAYMENTS')?.root).toBe('/work/payments-api');
    expect(projectByName(projects, ' website ')?.root).toBe('/work/web');
  });

  it('falls back to the folder name, and never matches folders you have not added', () => {
    expect(projectByName(projects, 'payments-api')?.root).toBe('/work/payments-api');
    expect(projectByName(projects, 'scratch')).toBeNull();
    expect(projectByName(projects, 'nope')).toBeNull();
  });
});

describe('baseOrder', () => {
  it('builds a quick second move on the first one still being saved', () => {
    const shown = ['/a', '/b', '/c'];
    const first = moveRoot(shown, '/c', -1);
    expect(first).toEqual(['/a', '/c', '/b']);
    expect(moveRoot(baseOrder(first, shown), '/c', -1)).toEqual(['/c', '/a', '/b']);
  });
  it('uses the list as shown when nothing is pending or the projects changed', () => {
    expect(baseOrder(null, ['/a', '/b'])).toEqual(['/a', '/b']);
    expect(baseOrder(['/b', '/a'], ['/a', '/b', '/c'])).toEqual(['/a', '/b', '/c']);
    expect(baseOrder(['/b', '/x'], ['/a', '/b'])).toEqual(['/a', '/b']);
  });
});
