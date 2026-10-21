import { describe, expect, it } from 'vitest';
import { baseChoices, type BaseMenuInput } from './worktreeBases.ts';

const input = (patch: Partial<BaseMenuInput>): BaseMenuInput => ({
  remote: 'origin',
  baseBranch: 'main',
  current: 'feature/login',
  branches: ['feature/login', 'dev', 'main'],
  remoteBranches: ['origin/dev', 'origin/main', 'origin/release/2'],
  selected: 'fresh',
  ...patch,
});

describe('baseChoices', () => {
  it("offers Claude Code's two starting points, then the other local and remote branches", () => {
    const choices = baseChoices(input({}));
    expect(choices.map((c) => [c.value, c.label])).toEqual([
      ['fresh', 'origin/main'],
      ['head', 'feature/login'],
      ['refs/heads/dev', 'dev'],
      ['refs/heads/main', 'main'],
      ['refs/remotes/origin/dev', 'origin/dev'],
      ['refs/remotes/origin/release/2', 'origin/release/2'],
    ]);
    expect(choices[1]!.separatorAfter).toBe(true);
  });

  it('keeps a chosen branch git no longer lists, and needs no line without other branches', () => {
    expect(baseChoices(input({ selected: 'refs/heads/gone' })).map((c) => c.value)).toContain('refs/heads/gone');
    const bare = baseChoices(input({ branches: ['feature/login'], remoteBranches: ['origin/main'] }));
    expect(bare.map((c) => c.value)).toEqual(['fresh', 'head']);
    expect(bare[1]!.separatorAfter).toBe(false);
  });

  it('lists the current branch as a base only while it is the chosen one', () => {
    expect(baseChoices(input({ selected: 'refs/heads/feature/login' })).map((c) => c.value)).toContain('refs/heads/feature/login');
    expect(baseChoices(input({})).map((c) => c.value)).not.toContain('refs/heads/feature/login');
  });
});
