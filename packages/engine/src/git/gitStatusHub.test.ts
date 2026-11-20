import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChangesBase, GitChanges } from '@seshboard/protocol';
import { checkoutFacts, git, listChanges, topLevel } from './gitChanges.ts';
import { GitStatusHub, SAFETY_POLL_MS, type Facts } from './gitStatusHub.ts';

const ROOT = '/work/app';
const WORKTREE = '/work/app/.claude/worktrees/feature';

function setup() {
  let files = ['a.ts'];
  const calls = { list: 0, facts: 0, topLevel: 0, listed: [] as string[] };
  let release: (() => void) | null = null;
  let hold = false;
  let onWatch: ((file: string | null) => void) | null = null;
  let watching = 0;
  /** Folders that are checkouts; others fail as outside git. */
  const repos = new Set([ROOT, WORKTREE]);
  const hub = new GitStatusHub({
    topLevel: async (cwd) => {
      calls.topLevel++;
      const root = [...repos].filter((r) => cwd === r || cwd.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0];
      if (!root) throw new Error('fatal: not a git repository');
      return root;
    },
    facts: async (root): Promise<Facts> => (calls.facts++, { root, branch: 'main', baseBranch: 'main', hasHead: true }),
    list: async (root, base: ChangesBase): Promise<GitChanges> => {
      calls.list++;
      calls.listed.push(root);
      if (hold) await new Promise<void>((r) => (release = r));
      return { root, branch: 'main', baseBranch: 'main', base, files: files.map((path) => ({ path, status: 'modified', additions: 1, deletions: 0, staged: false })), error: null };
    },
    gitDir: async (root) => `${root}/.git`,
    watch: (_dir, onChange) => {
      watching++;
      onWatch = onChange;
      return { close: () => (watching--, (onWatch = null)) };
    },
  });
  return {
    hub,
    calls,
    repos,
    setFiles: (next: string[]) => (files = next),
    holdNext: () => (hold = true),
    release: () => ((hold = false), release?.()),
    gitEvent: (file: string) => onWatch?.(file),
    watching: () => watching,
  };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

afterEach(() => vi.useRealTimers());

describe('GitStatusHub', () => {
  it('answers requests that come together with one look, and a fresh result without git', async () => {
    const t = setup();
    const [a, b] = await Promise.all([t.hub.changes(`${ROOT}/src`, 'uncommitted'), t.hub.changes(ROOT, 'uncommitted')]);
    expect(a).toBe(b);
    expect(t.calls.list).toBe(1);
    await t.hub.changes(ROOT, 'uncommitted');
    expect(t.calls.list).toBe(1);
    // The folder and the facts are kept.
    await t.hub.changes(ROOT, 'uncommitted', 0);
    expect(t.calls.list).toBe(2);
    expect(t.calls.facts).toBe(1);
    expect(t.calls.topLevel).toBe(2);
  });

  it('shares one more look among the requests made during a look', async () => {
    const t = setup();
    t.holdNext();
    const first = t.hub.changes(ROOT, 'uncommitted', 0);
    await flush();
    const later = [t.hub.changes(ROOT, 'uncommitted', 0), t.hub.changes(ROOT, 'uncommitted', 0), t.hub.changes(ROOT, 'uncommitted', 0)];
    t.setFiles(['a.ts', 'b.ts']);
    t.release();
    await first;
    const results = await Promise.all(later);
    expect(t.calls.list).toBe(2);
    expect(results.every((r) => r.files.length === 2)).toBe(true);
  });

  it('looks once more when something changes during a look', async () => {
    vi.useFakeTimers();
    const t = setup();
    const told: number[] = [];
    t.holdNext();
    t.hub.watch(ROOT, 'uncommitted', (changes) => told.push(changes?.files.length ?? -1));
    await vi.advanceTimersByTimeAsync(10);
    expect(t.calls.list).toBe(1);
    // A session writes while the look runs: what it wrote may be past what the look read.
    t.setFiles(['a.ts', 'b.ts']);
    t.hub.touch(`${ROOT}/src`);
    t.release();
    await vi.advanceTimersByTimeAsync(1_100);
    expect(t.calls.list).toBe(2);
    expect(told).toEqual([2, 2]);
    t.hub.stop();
  });

  it('tells watchers every look, and looks again when git or a session changes something', async () => {
    vi.useFakeTimers();
    const t = setup();
    const told: number[] = [];
    const stop = t.hub.watch(ROOT, 'uncommitted', (changes) => told.push(changes?.files.length ?? -1));
    await vi.advanceTimersByTimeAsync(10);
    expect(told).toEqual([1]);
    expect(t.watching()).toBe(1);
    // The same list again still goes out: an edit that keeps a file's counts must reload its open diff.
    t.hub.touch(`${ROOT}/src`);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(t.calls.list).toBe(2);
    expect(told).toEqual([1, 1]);
    // A stage writes the index: a look (at most one a second while things keep changing), and the news.
    t.setFiles(['a.ts', 'b.ts']);
    t.gitEvent('index');
    await vi.advanceTimersByTimeAsync(1_100);
    expect(told).toEqual([1, 1, 2]);
    // The index says nothing about the branch; a new HEAD does: the facts are read again.
    expect(t.calls.facts).toBe(1);
    t.gitEvent('HEAD');
    await vi.advanceTimersByTimeAsync(1_100);
    expect(t.calls.facts).toBe(2);
    // A write elsewhere doesn't touch this checkout.
    t.hub.touch('/work/other');
    await vi.advanceTimersByTimeAsync(1_100);
    expect(t.calls.list).toBe(4);
    stop();
    expect(t.watching()).toBe(0);
  });

  it('touches only the checkout a path is in, not the one around a worktree', async () => {
    vi.useFakeTimers();
    const t = setup();
    t.hub.watch(ROOT, 'uncommitted', () => {});
    t.hub.watch(WORKTREE, 'uncommitted', () => {});
    await vi.advanceTimersByTimeAsync(10);
    t.calls.listed.length = 0;
    t.hub.touch(`${WORKTREE}/src/app.ts`);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(t.calls.listed).toEqual([WORKTREE]);
    t.hub.stop();
  });

  it('polls only while someone watches, and looks when a window comes to the front', async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.hub.changes(ROOT, 'uncommitted');
    await vi.advanceTimersByTimeAsync(SAFETY_POLL_MS * 2);
    expect(t.calls.list).toBe(1);
    // Watching: a look at once (the result is old by now), then one every SAFETY_POLL_MS.
    const stop = t.hub.watch(ROOT, 'uncommitted', () => {});
    await vi.advanceTimersByTimeAsync(SAFETY_POLL_MS * 2 + 10);
    expect(t.calls.list).toBe(4);
    t.hub.setForeground(false);
    t.hub.setForeground(true);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(t.calls.list).toBe(5);
    stop();
    await vi.advanceTimersByTimeAsync(SAFETY_POLL_MS * 3);
    expect(t.calls.list).toBe(5);
    t.hub.stop();
  });

  it('says why outside git, and follows the folder once it becomes a checkout', async () => {
    vi.useFakeTimers();
    const t = setup();
    await expect(t.hub.changes('/work/plain', 'uncommitted')).rejects.toThrow('not a git repository');
    const told: Array<string | number> = [];
    t.hub.watch('/work/plain', 'uncommitted', (changes, error) => told.push(error ?? changes!.files.length));
    await vi.advanceTimersByTimeAsync(10);
    expect(told).toEqual(['fatal: not a git repository']);
    // git init there: the next touch (or window focus, or the slow retry) finds it.
    t.repos.add('/work/plain');
    t.hub.touch('/work/plain');
    await vi.advanceTimersByTimeAsync(10);
    expect(told).toEqual(['fatal: not a git repository', 1]);
    t.hub.stop();
  });

  it('gives a recent result of a watched checkout to whoever counts changed files, and forgets unwatched ones', async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.hub.changes(ROOT, 'uncommitted');
    // Nobody watches: not kept current, so not offered.
    expect(t.hub.fresh(ROOT, 'uncommitted', 30_000)).toBeNull();
    const stop = t.hub.watch(ROOT, 'uncommitted', () => {});
    await vi.advanceTimersByTimeAsync(10);
    expect(t.hub.fresh(ROOT, 'uncommitted', 30_000)?.files.length).toBe(1);
    stop();
    // Unwatched for a minute: the next request reads the folder and the facts again.
    await vi.advanceTimersByTimeAsync(61_000);
    await t.hub.changes(`${ROOT}/lib`, 'uncommitted');
    expect(t.calls.facts).toBe(2);
    t.hub.stop();
  });
});

// The real thing: git in a temporary repository, the git folder watched with fs.watch. Windows has no watch by default.
describe.skipIf(process.platform === 'win32')('GitStatusHub on a real repository', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  const run = (cwd: string, ...args: string[]) => git(cwd, ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args]);

  it('hears a stage, a commit and a branch switch made outside, also in a linked worktree', async () => {
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-hub-')));
    dirs.push(repo);
    await run(repo, 'init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    await run(repo, 'add', '-A');
    await run(repo, 'commit', '-q', '-m', 'first');
    const hub = new GitStatusHub({
      topLevel,
      facts: (root) => checkoutFacts(root, root),
      list: (root, base, facts) => listChanges(root, base, facts),
      gitDir: (root) => git(root, ['rev-parse', '--absolute-git-dir']).then((d) => d.trim()),
    });
    let last: GitChanges | null = null;
    const stop = hub.watch(repo, 'uncommitted', (changes) => (last = changes));
    await vi.waitFor(() => expect(last).not.toBeNull());
    // Only git's own files change in these: the watch on the git folder brings them in, no poll or touch.
    writeFileSync(join(repo, 'a.txt'), 'two\n');
    await run(repo, 'add', 'a.txt');
    await vi.waitFor(() => expect(last!.files).toEqual([expect.objectContaining({ path: 'a.txt', staged: true })]), { timeout: 4_000 });
    await run(repo, 'commit', '-q', '-m', 'second');
    await vi.waitFor(() => expect(last!.files).toEqual([]), { timeout: 4_000 });
    await run(repo, 'switch', '-q', '-c', 'feature');
    await vi.waitFor(() => expect(last!.branch).toBe('feature'), { timeout: 4_000 });

    const tree = join(repo, 'tree');
    await run(repo, 'worktree', 'add', '-q', '-b', 'other', tree);
    let inTree: GitChanges | null = null;
    const stopTree = hub.watch(tree, 'uncommitted', (changes) => (inTree = changes));
    await vi.waitFor(() => expect(inTree?.branch).toBe('other'));
    writeFileSync(join(tree, 'b.txt'), 'new\n');
    await run(tree, 'add', 'b.txt');
    await vi.waitFor(() => expect(inTree!.files).toEqual([expect.objectContaining({ path: 'b.txt', staged: true })]), { timeout: 4_000 });
    stopTree();
    stop();
    hub.stop();
  });
});
