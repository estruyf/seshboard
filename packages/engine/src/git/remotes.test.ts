import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { git } from './gitChanges.ts';
import { findCheckout, githubPage, githubRepoFromUrl, githubRepos } from './remotes.ts';

describe('githubRepoFromUrl', () => {
  it('reads the forms git accepts for GitHub', () => {
    expect(githubRepoFromUrl('git@github.com:acme/payments.git')).toBe('acme/payments');
    expect(githubRepoFromUrl('https://github.com/Acme/Payments')).toBe('acme/payments');
    expect(githubRepoFromUrl('https://user@github.com/acme/payments.git')).toBe('acme/payments');
    expect(githubRepoFromUrl('ssh://git@github.com/acme/pay.ments.git')).toBe('acme/pay.ments');
    expect(githubRepoFromUrl('git://github.com/acme/payments/')).toBe('acme/payments');
  });

  it('ignores other hosts and paths that are not owner/name', () => {
    expect(githubRepoFromUrl('git@gitlab.com:acme/payments.git')).toBeNull();
    expect(githubRepoFromUrl('https://github.com.evil.example/acme/payments')).toBeNull();
    expect(githubRepoFromUrl('https://github.com/acme/payments/tree/main')).toBeNull();
    expect(githubRepoFromUrl('/srv/git/payments.git')).toBeNull();
  });
});

describe('findCheckout', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const repoWith = async (...remotes: string[]) => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-remotes-')));
    dirs.push(dir);
    await git(dir, ['init', '-q']);
    for (const [i, url] of remotes.entries()) await git(dir, ['remote', 'add', i === 0 ? 'origin' : `r${i}`, url]);
    return dir;
  };

  it('reads every remote of a real checkout', async () => {
    const dir = await repoWith('git@github.com:me/fork.git', 'https://github.com/acme/payments.git', 'git@gitlab.com:x/y.git');
    expect(await githubRepos(dir)).toEqual(['me/fork', 'acme/payments']);
    expect(await githubRepos(tmpdir())).toEqual([]);
  });

  it('returns the first matching folder in the order given, ignoring case and .git', async () => {
    const plain = await repoWith();
    const fork = await repoWith('git@github.com:me/payments.git', 'git@github.com:acme/payments.git');
    const clone = await repoWith('https://github.com/acme/payments');
    expect(await findCheckout([plain, fork, clone], 'Acme/Payments.git', githubRepos, 1)).toBe(fork);
    expect(await findCheckout([plain, clone, fork], 'acme/payments')).toBe(clone);
    expect(await findCheckout([plain, '/no/such/folder'], 'acme/payments')).toBeNull();
  });

  it('links the GitHub page of a checkout, at the branch only when it tracks one there', async () => {
    const dir = await repoWith('git@github.com:Acme/Payments.git', 'https://github.com/me/fork.git');
    await git(dir, ['switch', '-q', '-c', 'feature/løgin']);
    await git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'first']);
    // Not pushed: the repository itself, on origin, keeping the case the remote was written in.
    expect(await githubPage(dir)).toEqual({ repo: 'Acme/Payments', url: 'https://github.com/Acme/Payments' });
    // Tracking a branch on the fork: that remote, at that branch.
    await git(dir, ['config', 'branch.feature/løgin.remote', 'r1']);
    await git(dir, ['config', 'branch.feature/løgin.merge', 'refs/heads/feature/løgin']);
    expect(await githubPage(dir)).toEqual({ repo: 'me/fork', url: 'https://github.com/me/fork/tree/feature/l%C3%B8gin' });
    expect(await githubPage(await repoWith('git@gitlab.com:x/y.git'))).toBeNull();
    expect(await githubPage(tmpdir())).toBeNull();
  });
});
