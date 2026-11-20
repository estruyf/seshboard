import { describe, expect, it } from 'vitest';
import { remoteOnlyBranches } from './remoteOnlyBranches.ts';

describe('remoteOnlyBranches', () => {
  it('lists the branches only a remote has, by their local name, most recent first', () => {
    expect(remoteOnlyBranches(['main'], ['origin/era2', 'origin/main', 'origin/feat/login'])).toEqual([
      { name: 'era2', remote: 'origin', ref: 'origin/era2' },
      { name: 'feat/login', remote: 'origin', ref: 'origin/feat/login' },
    ]);
  });

  it('takes a name on two remotes from origin, where it keeps its place', () => {
    expect(remoteOnlyBranches([], ['upstream/dev', 'fork/x', 'origin/dev'])).toEqual([
      { name: 'dev', remote: 'origin', ref: 'origin/dev' },
      { name: 'x', remote: 'fork', ref: 'fork/x' },
    ]);
    expect(remoteOnlyBranches([], ['upstream/dev', 'fork/dev']).map((b) => b.ref)).toEqual(['upstream/dev']);
  });

  it('leaves out a remote HEAD and refs without a branch', () => {
    expect(remoteOnlyBranches([], ['origin/HEAD', 'origin', 'origin/'])).toEqual([]);
  });
});
