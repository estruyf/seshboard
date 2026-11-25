import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeDir } from '../util/removeDir.ts';
import { git } from './gitChanges.ts';
import { releaseBranch } from './releaseBranch.ts';

const commit = (cwd: string, message: string) => git(cwd, ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', message]);

describe('letting a worktree\'s branch go', () => {
  let scratch: string;
  let repo: string;
  let tree: string;

  beforeEach(async () => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-release-')));
    repo = join(scratch, 'repo');
    await git(scratch, ['init', '-q', '-b', 'main', repo]);
    await commit(repo, 'first');
    tree = join(scratch, 'review');
    await git(repo, ['worktree', 'add', '-q', '-b', 'feat/review', tree]);
    await commit(tree, 'review work');
  });

  afterEach(() => removeDir(scratch));

  it('detaches the worktree, keeps its commit and changes, and frees the branch for another worktree', async () => {
    const head = (await git(tree, ['rev-parse', 'HEAD'])).trim();
    writeFileSync(join(tree, 'notes.md'), 'not committed');
    expect(await releaseBranch(join(tree), [])).toEqual({ released: 'feat/review' });
    expect((await git(tree, ['rev-parse', 'HEAD'])).trim()).toBe(head);
    expect((await git(tree, ['branch', '--show-current'])).trim()).toBe('');
    expect(readFileSync(join(tree, 'notes.md'), 'utf8')).toBe('not committed');
    // The branch is free: another worktree takes it, at the same commit.
    await git(repo, ['worktree', 'add', '-q', join(scratch, 'again'), 'feat/review']);
    expect((await git(join(scratch, 'again'), ['rev-parse', 'HEAD'])).trim()).toBe(head);
  });

  it('never touches the main checkout, a detached worktree or one where a session works', async () => {
    expect(await releaseBranch(repo, [])).toMatchObject({ skipped: 'MAIN' });
    expect((await git(repo, ['branch', '--show-current'])).trim()).toBe('main');
    expect(await releaseBranch(tree, [{ sessionId: 's', cwd: tree, busy: true, hosted: true }])).toMatchObject({ skipped: 'SESSION_BUSY' });
    expect(await releaseBranch(tree, [{ sessionId: 's', cwd: tree, busy: false, hosted: false }])).toMatchObject({ skipped: 'SESSION_BUSY' });
    expect((await git(tree, ['branch', '--show-current'])).trim()).toBe('feat/review');
    // An idle session of Seshboard's own (the one that finished) doesn't hold it.
    expect(await releaseBranch(tree, [{ sessionId: 's', cwd: tree, busy: false, hosted: true }])).toEqual({ released: 'feat/review' });
    expect(await releaseBranch(tree, [])).toMatchObject({ skipped: 'DETACHED' });
  });

  it('says so for a folder that is not in a repository', async () => {
    expect(await releaseBranch(scratch, [])).toMatchObject({ skipped: 'NOT_A_WORKTREE' });
  });
});
