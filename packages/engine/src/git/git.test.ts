import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { baseBranch, countNewLines, fileDiff, git, insideRepo, listBranches, listChanges, removeWorktree, revert, stage, stageForCommit, switchBranch, syncCommand, updateCheckout, worktreeStatus } from './gitChanges.ts';

let repo: string;
const write = (path: string, text: string) => writeFileSync(join(repo, path), text);
const run = (...args: string[]) => git(repo, args);

beforeEach(async () => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-git-')));
  await run('init', '-q', '-b', 'main');
  await run('config', 'user.email', 'test@example.com');
  await run('config', 'user.name', 'Test');
  // Files come back as written, whatever the user's global config says (Git for Windows turns this on).
  await run('config', 'core.autocrlf', 'false');
  write('a.txt', 'one\ntwo\n');
  write('b.txt', 'keep\n');
  await run('add', '.');
  await run('commit', '-qm', 'initial');
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('listChanges', () => {
  // Git for Windows leaves these out without a word unless core.longpaths is on.
  it('lists a new file whose path is longer than Windows\' 260 characters', async () => {
    const deep = Array.from({ length: 12 }, (_, i) => `folder-with-a-long-name-${i}`).join('/');
    mkdirSync(join(repo, deep), { recursive: true });
    write(`${deep}/file.txt`, 'x\n');
    expect(join(repo, deep, 'file.txt').length).toBeGreaterThan(260);
    expect((await listChanges(repo, 'uncommitted')).files.map((f) => f.path)).toEqual([`${deep}/file.txt`]);
  });

  it('lists uncommitted changes with line counts, staging and new files', async () => {
    write('a.txt', 'one\nTWO\nthree\n');
    write('new.txt', 'hello\nworld\n');
    rmSync(join(repo, 'b.txt'));
    await run('add', 'a.txt');
    const changes = await listChanges(repo, 'uncommitted');
    expect(changes.branch).toBe('main');
    expect(changes.files).toEqual([
      { path: 'a.txt', status: 'modified', additions: 2, deletions: 1, staged: true },
      { path: 'b.txt', status: 'deleted', additions: 0, deletions: 1, staged: false },
      { path: 'new.txt', status: 'untracked', additions: 2, deletions: 0, staged: false },
    ]);
  });

  it('compares a branch with where it left main, commits and uncommitted work together', async () => {
    await run('checkout', '-qb', 'feature');
    write('a.txt', 'one\ntwo\nthree\n');
    await run('commit', '-qam', 'more');
    write('b.txt', 'changed\n');
    expect(await baseBranch(repo)).toBe('main');
    const changes = await listChanges(repo, 'branch');
    expect(changes.baseBranch).toBe('main');
    expect(changes.files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
      ['a.txt', 'modified', 1, 0],
      ['b.txt', 'modified', 1, 1],
    ]);
  });
});

describe('fileDiff, stage and revert', () => {
  it('diffs tracked and new files', async () => {
    write('a.txt', 'one\nTWO\n');
    write('new.txt', 'hi\n');
    expect((await fileDiff(repo, 'uncommitted', 'a.txt')).diff).toContain('-two\n+TWO');
    expect((await fileDiff(repo, 'uncommitted', 'new.txt')).diff).toContain('+hi');
  });

  it('stages, unstages and reverts; new files are handed back for the Trash', async () => {
    write('a.txt', 'changed\n');
    write('new.txt', 'hi\n');
    await stage(repo, ['a.txt', 'new.txt'], true);
    expect((await listChanges(repo, 'uncommitted')).files.every((f) => f.staged)).toBe(true);
    await stage(repo, ['a.txt'], false);
    expect((await listChanges(repo, 'uncommitted')).files.find((f) => f.path === 'a.txt')?.staged).toBe(false);

    const { untracked } = await revert(repo, ['a.txt', 'new.txt']);
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('one\ntwo\n');
    expect(untracked).toEqual([join(repo, 'new.txt')]);
    // Reverting never deletes; the caller trashes the new file.
    expect(existsSync(join(repo, 'new.txt'))).toBe(true);
    expect((await listChanges(repo, 'uncommitted')).files.map((f) => f.status)).toEqual(['untracked']);
  });

  it('refuses paths outside the repository', async () => {
    expect(() => insideRepo(repo, '../outside.txt')).toThrow();
    expect(() => insideRepo(repo, '/etc/passwd')).toThrow();
    await expect(fileDiff(repo, 'uncommitted', '../x')).rejects.toThrow();
  });

  it('takes paths literally, so a glob character never matches other files', async () => {
    write('ab.txt', 'tracked\n');
    await run('add', 'ab.txt');
    await run('commit', '-qm', 'ab');
    // Windows doesn't allow * in a file name; [b] is a glob that matches ab.txt too.
    const name = process.platform === 'win32' ? 'a[b].txt' : 'a*.txt';
    write(name, 'new\n');
    const { untracked } = await revert(repo, [name]);
    expect(untracked).toEqual([join(repo, name)]);
    // ab.txt is untouched and nothing is staged.
    expect((await run('status', '--porcelain=v1', '--untracked-files=no')).trim()).toBe('');
    await stage(repo, [name], true);
    expect((await run('diff', '--cached', '--name-only')).trim()).toBe(name);
  });

  it('brings back a file whose deletion is staged, and shows its diff', async () => {
    await run('rm', '-q', 'b.txt');
    expect((await fileDiff(repo, 'uncommitted', 'b.txt')).diff).toContain('-keep');
    const { untracked } = await revert(repo, ['b.txt']);
    expect(untracked).toEqual([]);
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toBe('keep\n');
    expect((await listChanges(repo, 'uncommitted')).files).toEqual([]);
  });

  it('undoes a staged rename: the old file comes back and the new one goes to the Trash', async () => {
    await run('mv', 'a.txt', 'moved.txt');
    expect((await listChanges(repo, 'uncommitted')).files.map((f) => [f.path, f.status])).toEqual([['moved.txt', 'renamed']]);
    expect((await fileDiff(repo, 'uncommitted', 'moved.txt')).diff).toMatch(/rename from a\.txt\nrename to moved\.txt/);
    const { untracked } = await revert(repo, ['moved.txt']);
    expect(untracked).toEqual([join(repo, 'moved.txt')]);
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('one\ntwo\n');
    expect((await listChanges(repo, 'uncommitted')).files.map((f) => [f.path, f.status])).toEqual([['moved.txt', 'untracked']]);
  });

  it('lists a worktree rename (intent to add) once, without its old path as another file', async () => {
    await run('mv', 'a.txt', 'moved.txt');
    await run('reset', '-q');
    await run('add', '-N', 'moved.txt');
    const files = (await listChanges(repo, 'uncommitted')).files;
    expect(files.map((f) => [f.path, f.status])).toEqual([['moved.txt', 'renamed']]);
  });

  it('unstages in a repository without commits', async () => {
    const empty = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-git-empty-')));
    try {
      await git(empty, ['init', '-q', '-b', 'main']);
      writeFileSync(join(empty, 'first.txt'), 'x\n');
      await stage(empty, ['first.txt'], true);
      expect((await listChanges(empty, 'uncommitted')).files).toMatchObject([{ path: 'first.txt', status: 'added', staged: true }]);
      await stage(empty, ['first.txt'], false);
      expect((await listChanges(empty, 'uncommitted')).files).toMatchObject([{ path: 'first.txt', status: 'untracked', additions: 1 }]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('ignores diff settings that would break the parsed diff', async () => {
    await run('config', 'diff.external', 'false');
    await run('config', 'color.ui', 'always');
    await run('config', 'diff.suppressBlankEmpty', 'true');
    write('a.txt', 'one\n\ntwo\nthree\n');
    await run('commit', '-qam', 'blank line');
    write('a.txt', 'one\n\ntwo\nTHREE\n');
    const { diff } = await fileDiff(repo, 'uncommitted', 'a.txt');
    expect(diff).not.toContain('\u001b[');
    // The blank context line keeps its leading space.
    expect(diff).toContain(' one\n \n two\n-three\n+THREE\n');
    expect((await listChanges(repo, 'uncommitted')).files).toMatchObject([{ path: 'a.txt', additions: 1, deletions: 1 }]);
  });

  it('counts the lines of new files like git does', async () => {
    write('two.txt', 'a\nb\n');
    write('open.txt', 'a\nb');
    write('empty.txt', '');
    writeFileSync(join(repo, 'bin.dat'), Buffer.from([1, 0, 2, 10, 3]));
    expect(countNewLines(join(repo, 'two.txt')).lines).toBe(2);
    expect(countNewLines(join(repo, 'open.txt')).lines).toBe(2);
    expect(countNewLines(join(repo, 'empty.txt')).lines).toBe(0);
    expect(countNewLines(join(repo, 'bin.dat')).lines).toBe(0);
    const files = (await listChanges(repo, 'uncommitted')).files;
    expect(files.map((f) => [f.path, f.additions])).toEqual([
      ['bin.dat', 0],
      ['empty.txt', 0],
      ['open.txt', 2],
      ['two.txt', 2],
    ]);
  });
});

describe('worktrees', () => {
  it('reports where a worktree stands, and removes it with its branch', async () => {
    const path = join(repo, '.claude', 'worktrees', 'feature');
    await run('worktree', 'add', '-q', '-b', 'worktree-feature', path);
    writeFileSync(join(path, 'a.txt'), 'one\ntwo\nthree\n');
    await git(path, ['commit', '-qam', 'more']);
    writeFileSync(join(path, 'scratch.txt'), 'x');

    const status = await worktreeStatus(path);
    expect(status).toMatchObject({
      path,
      root: repo,
      isWorktree: true,
      branch: 'worktree-feature',
      baseBranch: 'main',
      ahead: 1,
      behind: 0,
      uncommitted: 1,
      upstream: null,
      unpushed: null,
      behindUpstream: null,
      hasRemote: false,
      pushRemote: null,
      mainCheckout: { branch: 'main', dirty: false },
    });
    expect((await worktreeStatus(repo)).isWorktree).toBe(false);

    // git refuses while there are uncommitted files.
    await expect(removeWorktree(status, true)).rejects.toThrow();
    rmSync(join(path, 'scratch.txt'));
    await removeWorktree(await worktreeStatus(path), true);
    expect(existsSync(path)).toBe(false);
    expect((await run('branch', '--list', 'worktree-feature')).trim()).toBe('');
  });
});

describe('sync', () => {
  it('counts commits ahead of and behind the upstream, and builds pull, push and PR commands', async () => {
    const remote = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-remote-')));
    try {
      await git(remote, ['init', '-q', '--bare', '-b', 'main']);
      await run('remote', 'add', 'origin', remote);
      await run('push', '-q', '-u', 'origin', 'main');
      // Someone else pushes a commit; this checkout fetches it but hasn't merged it.
      const other = join(remote, 'clone');
      await git(remote, ['clone', '-q', remote, other]);
      await git(other, ['-c', 'user.email=o@example.com', '-c', 'user.name=O', 'commit', '-q', '--allow-empty', '-m', 'theirs']);
      await git(other, ['push', '-q']);
      await run('fetch', '-q');
      write('a.txt', 'mine\n');
      await run('commit', '-qam', 'mine');

      const status = await worktreeStatus(repo);
      expect(status).toMatchObject({ upstream: 'origin/main', unpushed: 1, behindUpstream: 1, pushRemote: 'origin' });
      const quote = (v: string) => `'${v}'`;
      expect(syncCommand(status, 'pull', quote)).toEqual({ command: 'git pull' });
      expect(syncCommand(status, 'push', quote)).toEqual({ command: 'git push' });
      expect(syncCommand(status, 'pr', quote)).toMatchObject({ code: 'WRONG_BRANCH' });

      await run('switch', '-q', '-c', 'feature');
      const feature = await worktreeStatus(repo);
      expect(feature).toMatchObject({ upstream: null, unpushed: null, behindUpstream: null });
      expect(syncCommand(feature, 'pull', quote)).toMatchObject({ code: 'NO_UPSTREAM' });
      expect(syncCommand(feature, 'pr', quote)).toEqual({ command: "git push -u 'origin' 'feature' && gh pr create --fill --web" });
    } finally {
      rmSync(remote, { recursive: true, force: true });
    }
  });

  it('refuses without a remote', async () => {
    expect(syncCommand(await worktreeStatus(repo), 'push', (v) => v)).toMatchObject({ code: 'NO_REMOTE' });
    expect(syncCommand(await worktreeStatus(repo), 'fetch', (v) => v)).toMatchObject({ code: 'NO_REMOTE' });
  });

  it('fetches and fast-forwards without a terminal, and refuses to merge', async () => {
    const remote = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-remote-')));
    const env = { HOME: process.env.HOME ?? '', PATH: process.env.PATH ?? '' };
    const theirs = async (message: string) => {
      await git(other, ['-c', 'user.email=o@example.com', '-c', 'user.name=O', 'commit', '-q', '--allow-empty', '-m', message]);
      await git(other, ['push', '-q']);
    };
    const other = join(remote, 'clone');
    try {
      await git(remote, ['init', '-q', '--bare', '-b', 'main']);
      await run('remote', 'add', 'origin', remote);
      await run('push', '-q', '-u', 'origin', 'main');
      await git(remote, ['clone', '-q', remote, other]);
      await theirs('theirs');

      // Until a fetch, this checkout doesn't know the upstream moved on.
      expect((await worktreeStatus(repo)).behindUpstream).toBe(0);
      await updateCheckout(repo, 'fetch', env);
      expect((await worktreeStatus(repo)).behindUpstream).toBe(1);
      await updateCheckout(repo, 'pull', env);
      expect(await worktreeStatus(repo)).toMatchObject({ behindUpstream: 0, unpushed: 0 });

      // Both sides have a commit: pulling would merge, which is left to a terminal.
      await theirs('theirs again');
      write('a.txt', 'mine\n');
      await run('commit', '-qam', 'mine');
      await expect(updateCheckout(repo, 'pull', env)).rejects.toThrow(/both moved on/);
      expect(await worktreeStatus(repo)).toMatchObject({ behindUpstream: 1, unpushed: 1 });
    } finally {
      rmSync(remote, { recursive: true, force: true });
    }
  });

  it('fetches with a remote, also on a detached HEAD', async () => {
    await run('remote', 'add', 'origin', repo);
    await run('switch', '-q', '--detach');
    expect(syncCommand(await worktreeStatus(repo), 'fetch', (v) => v)).toEqual({ command: 'git fetch' });
  });
});

describe('stageForCommit', () => {
  it('keeps what is staged, and stages everything when nothing is', async () => {
    write('a.txt', 'changed\n');
    write('new.txt', 'new\n');
    await run('add', 'a.txt');
    expect(await stageForCommit(repo)).toBe(1);
    expect((await run('diff', '--cached', '--name-only')).trim()).toBe('a.txt');

    await run('restore', '--staged', 'a.txt');
    expect(await stageForCommit(repo)).toBe(2);
    expect((await run('diff', '--cached', '--name-only')).trim().split('\n')).toEqual(['a.txt', 'new.txt']);
  });

  it('stages nothing on a clean checkout', async () => {
    expect(await stageForCommit(repo)).toBe(0);
  });
});

describe('branches', () => {
  it('lists local branches and switches without losing uncommitted work', async () => {
    await run('branch', 'feature');
    expect(await listBranches(repo)).toEqual({ current: 'main', branches: expect.arrayContaining(['main', 'feature']) });
    write('scratch.txt', 'mine\n');
    await switchBranch(repo, 'feature');
    expect((await listBranches(repo)).current).toBe('feature');
    expect(readFileSync(join(repo, 'scratch.txt'), 'utf8')).toBe('mine\n');
    await switchBranch(repo, 'feature');

    // A change git would overwrite: it refuses, and the file is untouched.
    await run('switch', '-q', 'main');
    await run('switch', '-qc', 'other');
    write('a.txt', 'committed on other\n');
    await run('commit', '-qam', 'other');
    await run('switch', '-q', 'main');
    write('a.txt', 'uncommitted\n');
    await expect(switchBranch(repo, 'other')).rejects.toThrow();
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('uncommitted\n');
    await expect(switchBranch(repo, '--orphan')).rejects.toThrow(/Not a branch/);
  });
});
