import { describe, expect, it } from 'vitest';
import { findComputer, matchProject, readProjects, writeComputerList } from './remoteStart.ts';

describe('findComputer', () => {
  const computers = [
    { id: 'c1', name: 'mystic', connected: true },
    { id: 'c2', name: 'Windows  Box', connected: false },
  ];
  it('finds one by its name in any case and spacing, or by its id', () => {
    expect(findComputer(computers, ' MYSTIC ')?.id).toBe('c1');
    expect(findComputer(computers, 'windows box')?.id).toBe('c2');
    expect(findComputer(computers, 'c2')?.id).toBe('c2');
    expect(findComputer(computers, 'nowhere')).toBeNull();
  });
});

describe('matchProject', () => {
  it('matches by the GitHub repository, whatever the name there', () => {
    const projects = [
      { id: 'a', name: 'app', repo: 'someone/app' },
      { id: 'b', name: 'my-app-clone', repo: 'me/app' },
    ];
    expect(matchProject(projects, { name: 'app', repos: ['me/app'] })).toEqual({ project: projects[1], by: 'repo' });
  });

  it('never matches a project there with another repository by its name', () => {
    expect(matchProject([{ id: 'a', name: 'app', repo: 'someone/app' }], { name: 'app', repos: ['me/app'] })).toBeNull();
    expect(matchProject([{ id: 'a', name: 'app', repo: null }], { name: 'app', repos: ['me/app'] })).toBeNull();
  });

  it('matches by name where there is nothing to compare: no GitHub remote here, or an older Seshboard there', () => {
    expect(matchProject([{ id: 'a', name: 'Notes', repo: null }], { name: 'notes', repos: [] })?.by).toBe('name');
    expect(matchProject([{ id: 'a', name: 'app' }], { name: 'app', repos: ['me/app'] })).toEqual({ project: { id: 'a', name: 'app' }, by: 'name' });
  });
});

describe('readProjects', () => {
  it('reads what another computer sends, and nothing from an answer it can’t read', () => {
    const id = '0123456789abcdef';
    expect(readProjects({ projects: [{ id, name: 'app', repo: 'me/app' }] })).toEqual([{ id, name: 'app', repo: 'me/app' }]);
    expect(readProjects({ projects: [{ id, name: 'app' }] })[0]!.repo).toBeUndefined();
    expect(readProjects({ nope: true })).toEqual([]);
  });
});

describe('writeComputerList', () => {
  it('says how to pair one when there are none', () => {
    expect(writeComputerList([])).toContain('Settings › Remote › Other computers');
  });
});
