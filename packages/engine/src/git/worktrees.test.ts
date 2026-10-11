import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorktreeEntry } from '@switchboard/protocol';
import { git } from './gitChanges.ts';
import { ignoredFiles, listWorktrees, measureSize, parseWorktreeList, removalRefusal, removeWorktrees, sessionsBlocking, type SessionActivity } from './worktrees.ts';

let dir: string;
let repo: string;
const run = (cwd: string, ...args: string[]) => git(cwd, args);
const wt = (name: string) => join(repo, '.claude', 'worktrees', name);

/** Adds a worktree the way Claude Code does: `.claude/worktrees/<name>` on branch `worktree-<name>`. */
async function addWorktree(name: string, path = wt(name)) {
  await run(repo, 'worktree', 'add', '-q', '-b', `worktree-${name}`, path);
  return path;
}

async function commit(cwd: string, file: string, text: string) {
  writeFileSync(join(cwd, file), text);
  await run(cwd, 'add', file);
  await run(cwd, 'commit', '-qm', `change ${file}`);
}

const byName = (list: { worktrees: WorktreeEntry[] }, name: string) => list.worktrees.find((w) => w.name === name)!;

beforeEach(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-worktrees-')));
  const origin = join(dir, 'origin.git');
  await git(dir, ['init', '-q', '--bare', '-b', 'main', origin]);
  repo = join(dir, 'repo');
  await git(dir, ['clone', '-q', origin, repo]);
  await run(repo, 'config', 'user.email', 'test@example.com');
  await run(repo, 'config', 'user.name', 'Test');
  writeFileSync(join(repo, '.gitignore'), '.claude/\nnode_modules/\ndist/\n.env*\n.vscode/\n');
  await commit(repo, 'a.txt', 'one\n');
  await run(repo, 'add', '.gitignore');
  await run(repo, 'commit', '-qm', 'ignore');
  await run(repo, 'push', '-q', '-u', 'origin', 'main');
  await run(repo, 'remote', 'set-head', 'origin', 'main');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('parseWorktreeList', () => {
  it('reads branches, detached heads, locks and prunable entries', () => {
    const list = parseWorktreeList(
      ['worktree /r', 'HEAD aaa', 'branch refs/heads/main', '', 'worktree /r/w', 'HEAD bbb', 'detached', 'locked on a USB drive', '', 'worktree /gone', 'HEAD ccc', 'branch refs/heads/old', 'prunable gitdir file points to non-existent location', ''].join('\n'),
    );
    expect(list).toEqual([
      { path: '/r', head: 'aaa', branch: 'refs/heads/main', bare: false, locked: false, lockReason: null, prunable: false },
      { path: '/r/w', head: 'bbb', branch: null, bare: false, locked: true, lockReason: 'on a USB drive', prunable: false },
      { path: '/gone', head: 'ccc', branch: 'refs/heads/old', bare: false, locked: false, lockReason: null, prunable: true },
    ]);
  });
});

describe('listWorktrees', () => {
  it('tells the main checkout, merged, dirty, unpushed, pushed, empty and missing worktrees apart', async () => {
    // Merged: a commit of its own that landed on origin/main.
    const merged = await addWorktree('merged');
    await commit(merged, 'm.txt', 'merged\n');
    await run(repo, 'merge', '-q', '--ff-only', 'worktree-merged');
    await run(repo, 'push', '-q', 'origin', 'main');
    // Dirty: an untracked file.
    const dirty = await addWorktree('dirty');
    writeFileSync(join(dirty, 'wip.txt'), 'wip\n');
    // Unpushed: two commits nobody else has.
    const unpushed = await addWorktree('unpushed');
    await commit(unpushed, 'u1.txt', '1\n');
    await commit(unpushed, 'u2.txt', '2\n');
    // Pushed: one commit, on origin with an upstream.
    const pushed = await addWorktree('pushed');
    await commit(pushed, 'p.txt', 'p\n');
    await run(pushed, 'push', '-q', '-u', 'origin', 'worktree-pushed');
    // Empty: made and never used.
    await addWorktree('empty');
    // Missing: the folder was deleted by hand.
    const gone = await addWorktree('gone');
    rmSync(gone, { recursive: true, force: true });

    const list = await listWorktrees(repo, {
      sessions: [
        { id: 'in-main', cwd: join(repo, 'src'), updatedAt: 1 },
        { id: 'in-dirty', cwd: join(dirty, 'packages', 'x'), updatedAt: Date.now() + 60_000 },
        { id: 'elsewhere', cwd: join(dir, 'other'), updatedAt: 1 },
      ],
    });
    expect(list.root).toBe(repo);
    expect(list.baseBranch).toBe('main');
    expect(list.pullRequests).toBe(false);
    expect(list.worktrees[0]).toMatchObject({ path: repo, isMain: true, branch: 'main', underClaudeDir: false, sessions: ['in-main'] });

    expect(byName(list, 'merged')).toMatchObject({ branch: 'worktree-merged', merged: true, ahead: 0, uncommitted: 0, underClaudeDir: true, missing: false });
    expect(byName(list, 'dirty')).toMatchObject({ uncommitted: 1, merged: false, sessions: ['in-dirty'] });
    // The session's activity counts as the worktree's.
    expect(byName(list, 'dirty').lastActivity).toBeGreaterThan(Date.now());
    expect(byName(list, 'unpushed')).toMatchObject({ ahead: 2, unpushed: 2, pushed: false, merged: false, upstream: null });
    expect(byName(list, 'pushed')).toMatchObject({ ahead: 1, unpushed: 0, pushed: true, merged: false, upstream: 'origin/worktree-pushed' });
    // No commits of its own: not "merged", nothing ahead.
    expect(byName(list, 'empty')).toMatchObject({ ahead: 0, merged: false, unpushed: 0 });
    expect(byName(list, 'gone')).toMatchObject({ missing: true, uncommitted: 0 });
    for (const w of list.worktrees) expect(w.pr).toBeNull();
  });

  it('lists a worktree outside .claude/worktrees, but not as one Claude Code made', async () => {
    const outside = await addWorktree('side', join(dir, 'side-checkout'));
    const list = await listWorktrees(repo);
    expect(byName(list, 'side-checkout')).toMatchObject({ path: outside, underClaudeDir: false, isMain: false });
  });

  it('reads locks and pull requests', async () => {
    const locked = await addWorktree('locked');
    await run(repo, 'worktree', 'lock', '--reason', 'keep me', locked);
    const list = await listWorktrees(repo, { pullRequests: new Map([['worktree-locked', { number: 7, state: 'open', url: 'https://example.com/7' }]]) });
    expect(byName(list, 'locked')).toMatchObject({ isLocked: true, lockReason: 'keep me', pr: { number: 7, state: 'open' } });
    expect(list.pullRequests).toBe(true);
  });
});

describe('removeWorktrees', () => {
  const idle = { activity: () => [] as SessionActivity[], release: async () => {} };

  it('removes a worktree and keeps its branch, or deletes the branch too', async () => {
    const keep = await addWorktree('keep');
    const drop = await addWorktree('drop');
    const results = await removeWorktrees(
      repo,
      [
        { path: keep, deleteBranch: false, recoveryRef: false },
        { path: drop, deleteBranch: true, recoveryRef: false },
      ],
      idle,
    );
    expect(results.map((r) => [r.ok, r.removed, r.branchDeleted])).toEqual([
      [true, true, false],
      [true, true, true],
    ]);
    expect(existsSync(keep)).toBe(false);
    expect(existsSync(drop)).toBe(false);
    const branches = await run(repo, 'branch', '--format=%(refname:short)');
    expect(branches).toContain('worktree-keep');
    expect(branches).not.toContain('worktree-drop');
    expect((await listWorktrees(repo)).worktrees).toHaveLength(1);
  });

  it('prunes a worktree whose folder is gone', async () => {
    const gone = await addWorktree('gone');
    rmSync(gone, { recursive: true, force: true });
    const [result] = await removeWorktrees(repo, [{ path: gone, deleteBranch: false, recoveryRef: false }], idle);
    expect(result).toMatchObject({ ok: true, removed: true });
    expect((await listWorktrees(repo)).worktrees.map((w) => w.path)).toEqual([repo]);
  });

  it('saves a recovery ref before deleting a branch with unpushed commits', async () => {
    const path = await addWorktree('work');
    await commit(path, 'w.txt', 'w\n');
    const head = (await run(path, 'rev-parse', 'HEAD')).trim();
    const now = new Date(2026, 9, 10, 12);
    const [first] = await removeWorktrees(repo, [{ path, deleteBranch: true, recoveryRef: true }], { ...idle, now });
    expect(first).toMatchObject({ ok: true, branchDeleted: true, recoveryRef: 'refs/switchboard/removed/worktree-work-2026-10-10' });
    expect((await run(repo, 'rev-parse', first!.recoveryRef!)).trim()).toBe(head);
    // The same branch name removed again on the same day gets a ref of its own.
    const again = await addWorktree('work');
    const [second] = await removeWorktrees(repo, [{ path: again, deleteBranch: true, recoveryRef: true }], { ...idle, now });
    expect(second!.recoveryRef).toBe('refs/switchboard/removed/worktree-work-2026-10-10-2');
    expect((await run(repo, 'rev-parse', first!.recoveryRef!)).trim()).toBe(head);
  });

  it('refuses the main checkout, uncommitted changes, a locked worktree and a session working there', async () => {
    const dirty = await addWorktree('dirty');
    writeFileSync(join(dirty, 'wip.txt'), 'wip\n');
    const locked = await addWorktree('locked');
    await run(repo, 'worktree', 'lock', locked);
    const busy = await addWorktree('busy');
    const other = await addWorktree('other');
    const released: string[] = [];
    const activity: SessionActivity[] = [
      { sessionId: 'working', cwd: join(busy, 'src'), busy: true, hosted: true },
      { sessionId: 'terminal', cwd: other, busy: false, hosted: false },
    ];
    const results = await removeWorktrees(
      repo,
      [repo, dirty, locked, busy, other].map((path) => ({ path, deleteBranch: true, recoveryRef: false })),
      { activity: () => activity, release: async (ids) => void released.push(...ids) },
    );
    expect(results.map((r) => [r.ok, r.code])).toEqual([
      [false, 'MAIN'],
      [false, 'UNCOMMITTED'],
      [false, 'LOCKED'],
      [false, 'SESSION_BUSY'],
      [false, 'SESSION_BUSY'],
    ]);
    for (const path of [repo, dirty, locked, busy, other]) expect(existsSync(path)).toBe(true);
    expect(await run(repo, 'branch', '--format=%(refname:short)')).toContain('worktree-dirty');
    expect(released).toEqual([]);
  });

  it('stops a session idle in Switchboard before removing its worktree', async () => {
    const path = await addWorktree('idle');
    const released: string[] = [];
    const [result] = await removeWorktrees(repo, [{ path, deleteBranch: false, recoveryRef: false }], {
      activity: () => [{ sessionId: 'idle-here', cwd: path, busy: false, hosted: true }],
      release: async (ids) => void released.push(...ids),
    });
    expect(result!.ok).toBe(true);
    expect(released).toEqual(['idle-here']);
  });
});

describe('sessionsBlocking', () => {
  it('only looks at sessions inside the worktree', () => {
    expect(sessionsBlocking('/r/.claude/worktrees/a', [{ sessionId: 's', cwd: '/r/.claude/worktrees/ab', busy: true, hosted: true }])).toEqual({ refusal: null, release: [] });
    expect(sessionsBlocking('/r/.claude/worktrees/a', [{ sessionId: 's', cwd: '/r/.claude/worktrees/a/src', busy: true, hosted: true }]).refusal?.code).toBe('SESSION_BUSY');
  });
});

describe('ignoredFiles and measureSize', () => {
  it('lists ignored files that may hold work, leaving out dependencies and build output', async () => {
    const path = await addWorktree('ignored');
    writeFileSync(join(path, '.env.local'), 'SECRET=1\n');
    mkdirSync(join(path, '.vscode'));
    writeFileSync(join(path, '.vscode', 'settings.json'), '{}');
    mkdirSync(join(path, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(path, 'node_modules', 'x', 'index.js'), '');
    mkdirSync(join(path, 'dist'));
    writeFileSync(join(path, 'dist', 'out.js'), '');
    expect(await ignoredFiles(path)).toEqual({ files: ['.env.local', '.vscode/'], total: 2 });
    expect(removalRefusal((await listWorktrees(repo)).worktrees.find((w) => w.path === path)!)).toBeNull();
  });

  it('measures a folder on disk', async () => {
    writeFileSync(join(repo, 'big.bin'), Buffer.alloc(200 * 1024));
    expect(await measureSize(repo)).toBeGreaterThanOrEqual(200 * 1024);
    expect(await measureSize(join(dir, 'nope'))).toBeNull();
  });

  it('adds up the files where there is no du (Windows)', async () => {
    const folder = join(dir, 'walked');
    mkdirSync(join(folder, 'a', 'b'), { recursive: true });
    writeFileSync(join(folder, 'one.bin'), Buffer.alloc(1000));
    writeFileSync(join(folder, 'a', 'b', 'two.bin'), Buffer.alloc(2345));
    expect(await measureSize(folder, 'win32')).toBe(3345);
    expect(await measureSize(join(folder, 'one.bin'), 'win32')).toBeNull();
    expect(await measureSize(join(dir, 'nope'), 'win32')).toBeNull();
  });
});
