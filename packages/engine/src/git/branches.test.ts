import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BranchList } from '@seshboard/protocol';
import { deleteBranches, listBranchOverview, parseRefLines, parseTrack, splitRemoteRef } from './branches.ts';
import { git } from './gitChanges.ts';

let dir: string;
let repo: string;
let origin: string;
const run = (cwd: string, ...args: string[]) => git(cwd, args);
const noPr = { env: {}, openPullRequest: () => null };

async function commit(cwd: string, file: string, text: string) {
  writeFileSync(join(cwd, file), text);
  await run(cwd, 'add', file);
  await run(cwd, 'commit', '-qm', `change ${file}`);
}

const local = (list: BranchList, name: string) => list.branches.find((b) => b.local && b.name === name)!;
const remoteOnly = (list: BranchList, ref: string) => list.branches.find((b) => !b.local && b.remote?.ref === ref)!;
const refExists = async (ref: string) => (await git(repo, ['rev-parse', '--verify', '--quiet', ref], { allowExitCodes: [1] })).trim() !== '';

beforeEach(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-branches-')));
  origin = join(dir, 'origin.git');
  await git(dir, ['init', '-q', '--bare', '-b', 'main', origin]);
  repo = join(dir, 'repo');
  await git(dir, ['clone', '-q', origin, repo]);
  await run(repo, 'config', 'user.email', 'test@example.com');
  await run(repo, 'config', 'user.name', 'Test');
  await commit(repo, 'a.txt', 'one\n');
  await run(repo, 'push', '-q', '-u', 'origin', 'main');
  await run(repo, 'remote', 'set-head', 'origin', 'main');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('parsing', () => {
  it('reads ref lines, upstream tracking and remote refs', () => {
    const [line] = parseRefLines(['refs/heads/x', 'abc', 'refs/remotes/origin/x', 'ahead 2, behind 1', '1700000000', 'Ann', '', 'origin', 'Fix it', '2 5'].join('\0'), true);
    expect(line).toMatchObject({ ref: 'refs/heads/x', upstream: 'refs/remotes/origin/x', committedAt: 1_700_000_000_000, subject: 'Fix it', aheadBehind: '2 5' });
    expect(parseTrack('ahead 2, behind 1')).toEqual({ ahead: 2, behind: 1, gone: false });
    expect(parseTrack('gone')).toEqual({ ahead: 0, behind: 0, gone: true });
    expect(splitRemoteRef('refs/remotes/my/fork/feat/a', ['my', 'my/fork'])).toEqual({ remote: 'my/fork', branch: 'feat/a' });
  });
});

describe('listBranchOverview', () => {
  it('pairs local branches with their remote copies and tells merged, unpushed, gone and remote-only apart', async () => {
    // Merged: a commit of its own that landed on origin/main, pushed with an upstream.
    await run(repo, 'switch', '-q', '-c', 'merged');
    await commit(repo, 'm.txt', 'm\n');
    await run(repo, 'push', '-q', '-u', 'origin', 'merged');
    await run(repo, 'switch', '-q', 'main');
    await run(repo, 'merge', '-q', '--ff-only', 'merged');
    await run(repo, 'push', '-q', 'origin', 'main');
    // Unpushed: two commits nobody else has.
    await run(repo, 'switch', '-q', '-c', 'unpushed');
    await commit(repo, 'u1.txt', '1\n');
    await commit(repo, 'u2.txt', '2\n');
    // Gone: pushed, then deleted on the remote by someone else.
    await run(repo, 'switch', '-q', '-c', 'gone', 'main');
    await commit(repo, 'g.txt', 'g\n');
    await run(repo, 'push', '-q', '-u', 'origin', 'gone');
    await git(dir, ['--git-dir', origin, 'branch', '-D', 'gone']);
    await run(repo, 'fetch', '-q', '--prune');
    // Empty: made and never committed on; tracks origin/main, which is no copy of it.
    await run(repo, 'switch', '-q', '-c', 'empty', 'origin/main');
    // Remote-only: pushed from elsewhere.
    await run(repo, 'switch', '-q', '-c', 'theirs', 'main');
    await commit(repo, 't.txt', 't\n');
    await run(repo, 'push', '-q', 'origin', 'theirs');
    await run(repo, 'switch', '-q', 'main');
    await run(repo, 'branch', '-q', '-D', 'theirs');

    const list = await listBranchOverview(repo);
    expect(list.baseBranch).toBe('main');
    expect(list.remotes).toEqual(['origin']);

    const main = local(list, 'main');
    expect(main).toMatchObject({ isBase: true, ahead: null, merged: false, remote: { ref: 'origin/main', isDefault: true } });
    expect(main.local).toMatchObject({ checkedOutIn: repo, upstream: 'origin/main' });

    expect(local(list, 'merged')).toMatchObject({ merged: true, ahead: 0, remote: { ref: 'origin/merged' }, local: { unpushed: 0, neverCommitted: false } });
    expect(local(list, 'unpushed')).toMatchObject({ merged: false, ahead: 2, remote: null, local: { unpushed: 2, upstream: null } });
    expect(local(list, 'gone')).toMatchObject({ merged: false, ahead: 1, remote: null, local: { upstreamGone: true, unpushed: 1 } });
    expect(local(list, 'empty')).toMatchObject({ merged: false, ahead: 0, remote: null, local: { neverCommitted: true, upstream: 'origin/main' } });
    expect(remoteOnly(list, 'origin/theirs')).toMatchObject({ name: 'theirs', local: null, ahead: 1, merged: false, isBase: false });
    // origin/main pairs with main; it isn't listed again as a remote-only branch.
    expect(list.branches.filter((b) => b.remote?.ref === 'origin/main' && !b.local)).toEqual([]);
  }, 20_000);

  it('shows the branch checked out in a worktree', async () => {
    const path = join(dir, 'wt');
    await run(repo, 'worktree', 'add', '-q', '-b', 'in-worktree', path);
    expect(local(await listBranchOverview(repo), 'in-worktree').local!.checkedOutIn).toBe(path);
  });
});

describe('deleteBranches', () => {
  it('deletes local and remote copies, with a recovery ref', async () => {
    await run(repo, 'switch', '-q', '-c', 'done');
    await commit(repo, 'd.txt', 'd\n');
    await run(repo, 'push', '-q', '-u', 'origin', 'done');
    await run(repo, 'switch', '-q', 'main');
    const sha = (await run(repo, 'rev-parse', 'done')).trim();

    const [result] = await deleteBranches(repo, [{ name: 'done', local: true, remoteRef: 'origin/done', recoveryRef: true }], { ...noPr, now: new Date(2026, 9, 10) });
    expect(result).toMatchObject({ ok: true, localDeleted: true, remoteDeleted: true, recoveryRef: 'refs/switchboard/removed/done-2026-10-10' });
    expect(await refExists('refs/heads/done')).toBe(false);
    expect(await refExists('refs/remotes/origin/done')).toBe(false);
    expect((await git(dir, ['--git-dir', origin, 'branch', '--list', 'done'])).trim()).toBe('');
    expect((await run(repo, 'rev-parse', result!.recoveryRef!)).trim()).toBe(sha);
  });

  it('deletes only the local copy, or only the remote one', async () => {
    await run(repo, 'branch', 'a');
    await run(repo, 'push', '-q', '-u', 'origin', 'a');
    await run(repo, 'branch', 'b');
    await run(repo, 'push', '-q', '-u', 'origin', 'b');
    const results = await deleteBranches(
      repo,
      [
        { name: 'a', local: true, remoteRef: null, recoveryRef: false },
        { name: 'b', local: false, remoteRef: 'origin/b', recoveryRef: false },
      ],
      noPr,
    );
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(await refExists('refs/heads/a')).toBe(false);
    expect(await refExists('refs/remotes/origin/a')).toBe(true);
    expect(await refExists('refs/heads/b')).toBe(true);
    expect(await refExists('refs/remotes/origin/b')).toBe(false);
  });

  it('refuses the base branch, a checked-out branch, the base on the remote and a branch with an open pull request', async () => {
    await run(repo, 'worktree', 'add', '-q', '-b', 'busy', join(dir, 'wt'));
    await run(repo, 'branch', 'reviewed');
    await run(repo, 'push', '-q', 'origin', 'reviewed');
    // Tracks origin/main: its remote copy is not main.
    await run(repo, 'branch', '-q', '--track', 'fix', 'origin/main');
    const pr = { number: 7, state: 'open' as const, url: 'https://example.com/7' };
    const results = await deleteBranches(
      repo,
      [
        { name: 'main', local: true, remoteRef: null, recoveryRef: false },
        { name: 'busy', local: true, remoteRef: null, recoveryRef: false },
        { name: 'main', local: false, remoteRef: 'origin/main', recoveryRef: false },
        { name: 'reviewed', local: false, remoteRef: 'origin/reviewed', recoveryRef: false },
        { name: 'gone-already', local: false, remoteRef: 'origin/gone-already', recoveryRef: false },
      ],
      { env: {}, openPullRequest: (name) => (name === 'reviewed' ? pr : null) },
    );
    expect(results.map((r) => r.code)).toEqual(['BASE', 'CHECKED_OUT', 'BASE', 'OPEN_PR', 'NOT_FOUND']);
    expect(await refExists('refs/heads/main')).toBe(true);
    expect(await refExists('refs/heads/busy')).toBe(true);
    expect(await refExists('refs/remotes/origin/main')).toBe(true);
    expect(await refExists('refs/remotes/origin/reviewed')).toBe(true);
    expect(local(await listBranchOverview(repo), 'fix').remote).toBeNull();
  });
});
