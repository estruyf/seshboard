import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openCacheDatabase, type CacheDatabase } from '../db/database.ts';
import { git } from './gitChanges.ts';
import { GithubOriginStore } from './githubOrigins.ts';
import { checkoutPullRequest, PrCheckoutError } from './prCheckout.ts';
import type { GhCommand } from './pullRequest.ts';
import { makeWorktreeFrom, worktreePath, WorktreeFromError } from './worktreeFrom.ts';

/** Commits as a fixed author, so the tests don't depend on the machine's git identity. */
const commit = (cwd: string, message: string) => git(cwd, ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', message]);

describe('worktrees from a branch and from a pull request', () => {
  let scratch: string;
  let origin: string;
  let repo: string;
  /** The commit pull request #151's head is at, on the remote (as GitHub keeps it under refs/pull). */
  let prHead: string;

  beforeEach(async () => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-wt-from-')));
    // The remote: a repository with main, a branch only it has, and a pull request's head.
    origin = join(scratch, 'origin');
    mkdirSync(origin);
    await git(origin, ['init', '-q', '-b', 'main']);
    await commit(origin, 'first');
    await git(origin, ['switch', '-q', '-c', 'feat/issue-start']);
    await commit(origin, 'start sessions from issues');
    prHead = (await git(origin, ['rev-parse', 'HEAD'])).trim();
    await git(origin, ['update-ref', 'refs/pull/151/head', prHead]);
    await git(origin, ['switch', '-q', 'main']);
    await git(origin, ['switch', '-q', '-c', 'remote-only']);
    await commit(origin, 'remote work');
    await git(origin, ['switch', '-q', 'main']);
    repo = join(scratch, 'repo');
    await git(scratch, ['clone', '-q', '--no-checkout', origin, repo]);
    await git(repo, ['checkout', '-q', 'main']);
    await git(repo, ['branch', 'local-branch', 'main']);
  });
  afterEach(() => rmSync(scratch, { recursive: true, force: true }));

  it('works on a pull request’s branch, at its latest commit, tracking the remote', async () => {
    const made = await makeWorktreeFrom(repo, 'pr-151', { branch: 'feat/issue-start', pullRequest: 151 });
    expect(made).toEqual({ path: worktreePath(repo, 'pr-151'), branch: 'feat/issue-start' });
    expect((await git(made.path, ['rev-parse', 'HEAD'])).trim()).toBe(prHead);
    expect((await git(made.path, ['branch', '--show-current'])).trim()).toBe('feat/issue-start');
    expect((await git(made.path, ['rev-parse', '--abbrev-ref', '@{upstream}'])).trim()).toBe('origin/feat/issue-start');
  });

  it('takes a fork’s pull request into a branch of its own, tracking nothing', async () => {
    const made = await makeWorktreeFrom(repo, 'pr-149', { branch: 'someone/patch-1', pullRequest: 151, fork: true });
    expect((await git(made.path, ['rev-parse', 'HEAD'])).trim()).toBe(prHead);
    expect(await git(made.path, ['rev-parse', '--abbrev-ref', '@{upstream}'], { allowExitCodes: [128] }).catch(() => '')).toBe('');
  });

  it('refuses a pull request whose branch is checked out somewhere else', async () => {
    await git(repo, ['switch', '-q', '-c', 'feat/issue-start']);
    await expect(makeWorktreeFrom(repo, 'pr-151', { branch: 'feat/issue-start', pullRequest: 151 })).rejects.toThrow(/feat\/issue-start is checked out in/);
    expect(existsSync(worktreePath(repo, 'pr-151'))).toBe(false);
  });

  it('starts a worktree branch from a local branch, or one only the remote has', async () => {
    const local = await makeWorktreeFrom(repo, 'from-local', { branch: 'local-branch' });
    expect(local.branch).toBe('worktree-from-local');
    expect((await git(local.path, ['rev-parse', 'HEAD'])).trim()).toBe((await git(repo, ['rev-parse', 'local-branch'])).trim());
    const remote = await makeWorktreeFrom(repo, 'from-remote', { branch: 'remote-only' });
    expect((await git(remote.path, ['log', '-1', '--format=%s'])).trim()).toBe('remote work');
  });

  it('refuses a taken name and a missing branch, with one line', async () => {
    await makeWorktreeFrom(repo, 'taken', { branch: 'local-branch' });
    await expect(makeWorktreeFrom(repo, 'taken', { branch: 'local-branch' })).rejects.toThrow('There is a worktree named taken already. Give this one another name.');
    await expect(makeWorktreeFrom(repo, 'nope', { branch: 'no-such-branch' })).rejects.toThrow(WorktreeFromError);
    await expect(makeWorktreeFrom(repo, 'nope', { branch: 'no-such-branch' })).rejects.toThrow('There is no branch no-such-branch here or on origin.');
  });
});

describe('Current checkout for a pull request', () => {
  let repo: string;
  let scratch: string;
  let gh: GhCommand;
  const log = () => join(scratch, 'calls.log');

  beforeEach(async () => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-pr-checkout-')));
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-pr-checkout-gh-')));
    const script = join(scratch, 'gh.cjs');
    writeFileSync(script, `require('node:fs').appendFileSync(${JSON.stringify(log())}, process.argv.slice(2).join(' ') + '\\n');\nif (process.argv[4] === '404') { process.stderr.write('GraphQL: Could not resolve to a PullRequest with the number of 404.\\n'); process.exit(1); }\n`);
    gh = { file: process.execPath, args: [script] };
    await git(repo, ['init', '-q', '-b', 'main']);
    await commit(repo, 'first');
  });
  afterEach(() => [repo, scratch].forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it('runs gh pr checkout in a clean folder', async () => {
    await checkoutPullRequest(repo, { number: 151, repo: 'o/r' }, { gh, env: {} });
    expect(existsSync(log())).toBe(true);
    expect((await import('node:fs')).readFileSync(log(), 'utf8').trim()).toBe('pr checkout 151 --repo o/r');
  });

  it('is refused while the folder has changes, before gh runs', async () => {
    writeFileSync(join(repo, 'a.txt'), 'a');
    writeFileSync(join(repo, 'b.txt'), 'b');
    const refused = await checkoutPullRequest(repo, { number: 151, repo: 'o/r' }, { gh, env: {} }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(PrCheckoutError);
    expect(refused).toMatchObject({ code: 'DIRTY', message: '2 changed files. Commit or stash them first.' });
    expect(existsSync(log())).toBe(false);
  });

  it('says why gh could not check it out', async () => {
    await expect(checkoutPullRequest(repo, { number: 404, repo: 'o/r' }, { gh, env: {} })).rejects.toMatchObject({ code: 'GH_FAILED', message: expect.stringContaining("Couldn't check out #404") });
  });
});

describe('GithubOriginStore', () => {
  let dir: string;
  let cache: CacheDatabase;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'switchboard-origins-'));
    cache = openCacheDatabase(join(dir, 'cache.sqlite'));
  });
  afterEach(() => {
    cache.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps where a session started, and which fork checkouts Switchboard must not push from', () => {
    const store = new GithubOriginStore(cache.db);
    store.save('a', { type: 'pr', repo: 'o/r', number: 149, readOnly: true }, { cwd: '/repo/.claude/worktrees/pr-149', branch: 'someone/patch-1' });
    store.save('b', { type: 'issue', repo: 'o/r', number: 32, readOnly: false }, { cwd: '/repo/.claude/worktrees/issue-32', branch: 'worktree-issue-32' });
    expect(store.get('a')).toEqual({ type: 'pr', repo: 'o/r', number: 149, readOnly: true });
    expect(store.get('b')).toEqual({ type: 'issue', repo: 'o/r', number: 32, readOnly: false });
    expect(store.get('c')).toBeNull();
    expect(store.readOnlyAt('/repo/.claude/worktrees/pr-149', 'someone/patch-1')).toBe(true);
    // Once that folder is on another branch, it is yours again.
    expect(store.readOnlyAt('/repo/.claude/worktrees/pr-149', 'main')).toBe(false);
    expect(store.readOnlyAt('/repo/.claude/worktrees/issue-32', 'worktree-issue-32')).toBe(false);
  });
});
