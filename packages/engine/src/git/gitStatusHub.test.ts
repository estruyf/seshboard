import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChangesBase, GitChanges } from '@seshboard/protocol';
import { GitStatusHub, SAFETY_POLL_MS, type Facts } from './gitStatusHub.ts';

const ROOT = '/work/app';

function setup() {
  let files = ['a.ts'];
  const calls = { list: 0, facts: 0, topLevel: 0 };
  let release: (() => void) | null = null;
  let hold = false;
  let onWatch: ((file: string | null) => void) | null = null;
  let watching = 0;
  const hub = new GitStatusHub({
    topLevel: async (cwd) => {
      calls.topLevel++;
      if (!cwd.startsWith(ROOT)) throw new Error('fatal: not a git repository');
      return ROOT;
    },
    facts: async (root): Promise<Facts> => (calls.facts++, { root, branch: 'main', baseBranch: 'main', hasHead: true }),
    list: async (root, base: ChangesBase): Promise<GitChanges> => {
      calls.list++;
      if (hold) await new Promise<void>((r) => (release = r));
      return { root, branch: 'main', baseBranch: 'main', base, files: files.map((path) => ({ path, status: 'modified', additions: 1, deletions: 0, staged: false })), error: null };
    },
    gitDir: async () => `${ROOT}/.git`,
    watch: (_dir, onChange) => {
      watching++;
      onWatch = onChange;
      return { close: () => (watching--, (onWatch = null)) };
    },
  });
  return {
    hub,
    calls,
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

  it('tells watchers each new result once, and looks again when git or a session changes something', async () => {
    vi.useFakeTimers();
    const t = setup();
    const told: number[] = [];
    const stop = t.hub.watch(ROOT, 'uncommitted', (changes) => told.push(changes?.files.length ?? -1));
    await vi.advanceTimersByTimeAsync(10);
    expect(told).toEqual([1]);
    expect(t.watching()).toBe(1);
    // Nothing new: nothing told.
    t.hub.touch(`${ROOT}/src`);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(t.calls.list).toBe(2);
    expect(told).toEqual([1]);
    // A stage writes the index: a look (at most one a second while things keep changing), and the news.
    t.setFiles(['a.ts', 'b.ts']);
    t.gitEvent('index');
    await vi.advanceTimersByTimeAsync(1_100);
    expect(told).toEqual([1, 2]);
    // A write elsewhere doesn't touch this checkout.
    t.hub.touch('/work/other');
    await vi.advanceTimersByTimeAsync(1_100);
    expect(t.calls.list).toBe(3);
    stop();
    expect(t.watching()).toBe(0);
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

  it('says why outside git, to requests and watchers', async () => {
    const t = setup();
    await expect(t.hub.changes('/tmp/plain', 'uncommitted')).rejects.toThrow('not a git repository');
    const errors: Array<string | null> = [];
    t.hub.watch('/tmp/plain', 'uncommitted', (_changes, error) => errors.push(error));
    await flush();
    expect(errors).toEqual(['fatal: not a git repository']);
  });

  it('gives a recent result to whoever counts changed files, and nothing older', async () => {
    vi.useFakeTimers();
    const t = setup();
    expect(t.hub.fresh(ROOT, 'uncommitted', 30_000)).toBeNull();
    await t.hub.changes(ROOT, 'uncommitted');
    expect(t.hub.fresh(ROOT, 'uncommitted', 30_000)?.files.length).toBe(1);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(t.hub.fresh(ROOT, 'uncommitted', 30_000)).toBeNull();
  });
});
