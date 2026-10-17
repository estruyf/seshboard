import { describe, expect, it } from 'vitest';
import { cloneFolderProblem, isBranchName, NOT_A_REPO, ONLY_GITHUB, parseGithubRepo, repoLabel } from './githubRepo.ts';

const repo = (owner: string, name: string, branch: string | null = null) => ({ ok: true, repo: { owner, name, branch } });

describe('parseGithubRepo', () => {
  it('reads every form of a repository URL', () => {
    expect(parseGithubRepo('https://github.com/estruyf/switchboard')).toEqual(repo('estruyf', 'switchboard'));
    expect(parseGithubRepo('https://github.com/estruyf/switchboard.git')).toEqual(repo('estruyf', 'switchboard'));
    expect(parseGithubRepo('  https://github.com/estruyf/switchboard/  ')).toEqual(repo('estruyf', 'switchboard'));
    expect(parseGithubRepo('http://www.github.com/estruyf/switchboard')).toEqual(repo('estruyf', 'switchboard'));
    expect(parseGithubRepo('github.com/estruyf/switchboard')).toEqual(repo('estruyf', 'switchboard'));
    expect(parseGithubRepo('git@github.com:estruyf/switchboard.git')).toEqual(repo('estruyf', 'switchboard'));
    expect(parseGithubRepo('ssh://git@github.com/estruyf/switchboard.git')).toEqual(repo('estruyf', 'switchboard'));
    expect(parseGithubRepo('estruyf/switchboard')).toEqual(repo('estruyf', 'switchboard'));
    expect(parseGithubRepo('vercel/next.js')).toEqual(repo('vercel', 'next.js'));
  });

  it('takes the branch of a /tree/ URL, slashes and all', () => {
    expect(parseGithubRepo('https://github.com/estruyf/switchboard/tree/main')).toEqual(repo('estruyf', 'switchboard', 'main'));
    expect(parseGithubRepo('https://github.com/estruyf/switchboard/tree/feat/clone-from-github')).toEqual(repo('estruyf', 'switchboard', 'feat/clone-from-github'));
    expect(parseGithubRepo('https://github.com/estruyf/switchboard/tree/feat%2Fx?tab=readme#top')).toEqual(repo('estruyf', 'switchboard', 'feat/x'));
  });

  it('takes the repository from its other pages', () => {
    expect(parseGithubRepo('https://github.com/estruyf/switchboard/issues/136')).toEqual(repo('estruyf', 'switchboard'));
    expect(parseGithubRepo('https://github.com/estruyf/switchboard/blob/main/README.md')).toEqual(repo('estruyf', 'switchboard'));
  });

  it('refuses other hosts', () => {
    expect(parseGithubRepo('https://gitlab.com/group/project')).toEqual({ ok: false, error: ONLY_GITHUB });
    expect(parseGithubRepo('git@bitbucket.org:team/repo.git')).toEqual({ ok: false, error: ONLY_GITHUB });
    expect(parseGithubRepo('https://github.example.com/team/app')).toEqual({ ok: false, error: ONLY_GITHUB });
    expect(parseGithubRepo('file:///tmp/repo.git')).toEqual({ ok: false, error: ONLY_GITHUB });
  });

  it('refuses junk', () => {
    expect(parseGithubRepo('https://github.com/estruyf')).toEqual({ ok: false, error: NOT_A_REPO });
    expect(parseGithubRepo('https://github.com/')).toEqual({ ok: false, error: NOT_A_REPO });
    expect(parseGithubRepo('not a url')).toEqual({ ok: false, error: NOT_A_REPO });
    expect(parseGithubRepo('-owner/name')).toEqual({ ok: false, error: NOT_A_REPO });
    expect(parseGithubRepo('owner/..')).toEqual({ ok: false, error: NOT_A_REPO });
    expect(parseGithubRepo('owner/na me')).toEqual({ ok: false, error: NOT_A_REPO });
    expect(parseGithubRepo('git@github.com:owner/name/extra')).toEqual({ ok: false, error: NOT_A_REPO });
    expect(parseGithubRepo('https://github.com/o/n/tree/bad..branch')).toMatchObject({ ok: false });
    expect(parseGithubRepo('')).toBeNull();
  });

  it('without shorthand, leaves names and paths alone', () => {
    expect(parseGithubRepo('estruyf/switchboard', { shorthand: false })).toBeNull();
    expect(parseGithubRepo('~/Developer/app', { shorthand: false })).toBeNull();
    expect(parseGithubRepo('/Users/me/app', { shorthand: false })).toBeNull();
    expect(parseGithubRepo('C:\\Users\\me\\app', { shorthand: false })).toBeNull();
    expect(parseGithubRepo('my.project', { shorthand: false })).toBeNull();
    expect(parseGithubRepo('https://github.com/estruyf/switchboard', { shorthand: false })).toEqual(repo('estruyf', 'switchboard'));
  });

  it('labels a repository as owner/name', () => {
    expect(repoLabel({ owner: 'estruyf', name: 'switchboard' })).toBe('estruyf/switchboard');
  });
});

describe('isBranchName', () => {
  it('takes what git takes', () => {
    expect(isBranchName('main')).toBe(true);
    expect(isBranchName('release/0.1')).toBe(true);
    for (const bad of ['', '-x', 'a..b', 'a b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[', 'a\\b', 'x.lock', 'x/', '/x', 'a//b', 'a@{1}', 'x.']) expect(isBranchName(bad)).toBe(false);
  });
});

describe('cloneFolderProblem', () => {
  it('takes one plain folder name', () => {
    expect(cloneFolderProblem('switchboard', 'darwin')).toBeNull();
    expect(cloneFolderProblem('next.js', 'win32')).toBeNull();
  });

  it('refuses separators, dots and empty names', () => {
    expect(cloneFolderProblem('', 'darwin')).not.toBeNull();
    expect(cloneFolderProblem(' app', 'darwin')).not.toBeNull();
    expect(cloneFolderProblem('..', 'darwin')).not.toBeNull();
    expect(cloneFolderProblem('a/b', 'darwin')).not.toBeNull();
    expect(cloneFolderProblem('a\\b', 'darwin')).not.toBeNull();
  });

  it('refuses what Windows refuses, only on Windows', () => {
    expect(cloneFolderProblem('a:b', 'win32')).not.toBeNull();
    expect(cloneFolderProblem('a:b', 'darwin')).toBeNull();
    expect(cloneFolderProblem('app.', 'win32')).not.toBeNull();
    expect(cloneFolderProblem('con', 'win32')).not.toBeNull();
    expect(cloneFolderProblem('con', 'darwin')).toBeNull();
  });
});
