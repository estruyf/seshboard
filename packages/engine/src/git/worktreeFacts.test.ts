import { describe, expect, it } from 'vitest';
import { PENDING_FACTS, type WorktreeEntry, type WorktreeFacts } from '@seshboard/protocol';
import { WorktreeFactsRunner } from './worktreeFacts.ts';
import type { WorktreeListing } from './worktrees.ts';

const entry = (name: string, head = `${name}-1`): WorktreeEntry => ({
  path: `/repo/${name}`,
  name,
  branch: name,
  head,
  isMain: false,
  isLocked: false,
  lockReason: null,
  missing: false,
  underClaudeDir: true,
  ...PENDING_FACTS,
  factsPending: true,
  upstream: null,
  lastActivity: null,
  sessions: [],
});

const factsOf = (e: WorktreeEntry, uncommitted = 0): WorktreeFacts => ({ path: e.path, head: e.head, upstream: null, uncommitted, ahead: 0, behind: 0, merged: false, unpushed: 0, pushed: false, unreadable: false });

/**
 * A listing whose facts are read by the test: `release(name)` lets every read of one finish, `started` is the order
 * they began in. `heads` says at which commit each worktree was listed.
 */
function slowListing(names: string[], heads: Record<string, string> = {}) {
  const entries = names.map((n) => entry(n, heads[n]));
  const started: string[] = [];
  const gates = new Map<string, Array<() => void>>();
  const listing: WorktreeListing = {
    list: { root: '/repo', baseBranch: 'main', pullRequests: false, worktrees: entries },
    facts: (path) =>
      new Promise((resolve) => {
        started.push(path);
        gates.set(path, [...(gates.get(path) ?? []), () => resolve(factsOf(entries.find((e) => e.path === path)!))]);
      }),
  };
  return { listing, started, release: (name: string) => gates.get(`/repo/${name}`)!.forEach((open) => open()), entries };
}

const tick = () => new Promise((done) => setTimeout(done, 5));

describe('WorktreeFactsRunner', () => {
  it('reads a few worktrees at a time, emitting each as it finishes', async () => {
    const emitted: string[] = [];
    const runner = new WorktreeFactsRunner({ emit: (_root, facts) => emitted.push(...facts.map((f) => f.path)), concurrency: 2 });
    const { listing, started, release } = slowListing(['a', 'b', 'c', 'd']);
    const filled = runner.fill('/repo', listing);
    await tick();
    expect(started).toEqual(['/repo/a', '/repo/b']);
    release('b');
    await tick();
    expect(started).toEqual(['/repo/a', '/repo/b', '/repo/c']);
    expect(emitted).toEqual(['/repo/b']);
    release('a');
    release('c');
    await tick();
    release('d');
    await filled;
    expect(emitted.sort()).toEqual(['/repo/a', '/repo/b', '/repo/c', '/repo/d']);
  });

  it('answers a list asked again from what it knows, and starts nothing twice', async () => {
    let now = 1_000;
    const runner = new WorktreeFactsRunner({ emit: () => {}, now: () => now, maxAgeMs: 10_000 });
    const { listing, started, release, entries } = slowListing(['a', 'b']);
    const first = runner.fill('/repo', listing);
    // Asked again while the first reads: the same reads, not new ones.
    const second = runner.fill('/repo', listing);
    await tick();
    expect(started).toHaveLength(2);
    release('a');
    release('b');
    await Promise.all([first, second]);
    expect(started).toHaveLength(2);

    expect(runner.known(entries).map((f) => f.path)).toEqual(['/repo/a', '/repo/b']);
    await runner.fill('/repo', listing);
    expect(started).toHaveLength(2);

    // Too old, or a checkout that has moved since: read again.
    now += 10_001;
    expect(runner.known(entries)).toEqual([]);
    now -= 10_001;
    expect(runner.known([entry('a', 'a-2')])).toEqual([]);
  });

  it('reads a worktree again for a list that saw it at another commit, and every list gets its own facts', async () => {
    const emitted: Array<[string, string | null]> = [];
    const runner = new WorktreeFactsRunner({ emit: (root, facts) => emitted.push(...facts.map((f): [string, string | null] => [root, f.head])) });
    const old = slowListing(['a'], { a: 'h1' });
    const moved = slowListing(['a'], { a: 'h2' });
    const first = runner.fill('/repo', old.listing);
    await tick();
    // A session committed meanwhile: the second list saw h2, which the read under way (at h1) can't answer for.
    const second = runner.fill('/repo', moved.listing);
    await tick();
    expect(moved.started).toEqual(['/repo/a']);
    // Whichever finishes last, each head keeps its own facts.
    moved.release('a');
    old.release('a');
    await Promise.all([first, second]);
    expect(runner.known(moved.entries).map((f) => f.head)).toEqual(['h2']);
    expect(runner.known(old.entries).map((f) => f.head)).toEqual(['h1']);
    expect(emitted).toEqual(expect.arrayContaining([['/repo', 'h1'], ['/repo', 'h2']]));
  });

  it('sends the facts to every project that waits for a read, even one that joined it later', async () => {
    const emitted: Array<[string, string]> = [];
    const runner = new WorktreeFactsRunner({ emit: (root, facts) => emitted.push(...facts.map((f): [string, string] => [root, f.path])) });
    // The same worktree is in two projects: a sibling checkout, or a subfolder of the repository.
    const { listing, started, release } = slowListing(['a']);
    const one = runner.fill('/repo', listing);
    const other = runner.fill('/repo/packages/app', listing);
    await tick();
    expect(started).toEqual(['/repo/a']);
    release('a');
    await Promise.all([one, other]);
    expect(emitted.sort()).toEqual([
      ['/repo', '/repo/a'],
      ['/repo/packages/app', '/repo/a'],
    ]);
  });

  it('reads the list asked last first, so the open project is not kept waiting behind the others', async () => {
    const runner = new WorktreeFactsRunner({ emit: () => {}, concurrency: 1 });
    const background = slowListing(['x1', 'x2']);
    const open = slowListing(['y1', 'y2']);
    const first = runner.fill('/other', background.listing);
    await tick();
    const second = runner.fill('/repo', open.listing);
    await tick();
    expect(background.started).toEqual(['/repo/x1']);
    background.release('x1');
    await tick();
    // x2 was asked first, y1 and y2 last: they go before it.
    expect(open.started).toEqual(['/repo/y1']);
    open.release('y1');
    await tick();
    expect(open.started).toEqual(['/repo/y1', '/repo/y2']);
    open.release('y2');
    await tick();
    background.release('x2');
    await Promise.all([first, second]);
  });

  it('does not run git for a read that was thrown away while it waited for its turn', async () => {
    const runner = new WorktreeFactsRunner({ emit: () => {}, concurrency: 1 });
    const { listing, started, release } = slowListing(['a', 'b']);
    const filled = runner.fill('/repo', listing);
    await tick();
    expect(started).toEqual(['/repo/a']);
    // b waits for the only place; its facts are no longer wanted when its turn comes.
    runner.invalidate(['/repo/b']);
    release('a');
    await filled;
    expect(started).toEqual(['/repo/a']);
  });

  it('finishes a slow repository whose reads take longer than facts stay current, even when it is asked again and again', async () => {
    let now = 0;
    const runner = new WorktreeFactsRunner({ emit: () => {}, concurrency: 4, maxAgeMs: 10_000, now: () => now });
    const names = Array.from({ length: 80 }, (_, i) => `w${i}`);
    const { listing, started, release, entries } = slowListing(names);
    const fills = [runner.fill('/repo', listing)];
    const released = new Set<string>();
    // Each read takes 2 seconds: 80 of them, four at a time, are 40 seconds, and the first facts are 10 seconds old
    // long before the last are in. A reload every 14 seconds must neither lose them nor read anything twice.
    for (let step = 1; step <= 60 && released.size < names.length; step++) {
      await tick();
      for (const path of started.filter((p) => !released.has(p))) {
        released.add(path);
        release(path.slice('/repo/'.length));
      }
      now += 2_000;
      if (step % 7 === 0) fills.push(runner.fill('/repo', listing));
    }
    await Promise.all(fills);
    expect(released.size).toBe(80);
    expect(started).toHaveLength(80);
    // Nothing holds them now: what was read more than `maxAgeMs` ago counts as pending again, the rest is current.
    const current = runner.known(entries).length;
    expect(current).toBeGreaterThan(0);
    expect(current).toBeLessThan(80);
  });

  it('reads a fact again that outlived its fill, instead of serving it as current', async () => {
    let now = 0;
    const runner = new WorktreeFactsRunner({ emit: () => {}, concurrency: 4, maxAgeMs: 10_000, now: () => now });
    const { listing, started, release, entries } = slowListing(['a', 'b']);
    const longRun = runner.fill('/repo', listing);
    await tick();
    release('a');
    await tick();
    // b is slow: a's fact is read at t=0 and the fill runs until t=60. A reload meanwhile gets it without a new read.
    now = 30_000;
    expect(runner.known(entries).map((f) => f.path)).toEqual(['/repo/a']);
    const reload = runner.fill('/repo', listing);
    await tick();
    expect(started).toEqual(['/repo/a', '/repo/b']);
    now = 60_000;
    release('b');
    await Promise.all([longRun, reload]);
    // Everything held is let go. a was read a minute ago (the worktree may have been edited since): not current.
    expect(runner.known(entries).map((f) => f.path)).toEqual(['/repo/b']);
    const again = runner.fill('/repo', listing);
    await tick();
    expect(started.filter((p) => p === '/repo/a')).toHaveLength(2);
    release('a');
    await again;
    expect(runner.known(entries)).toHaveLength(2);
  });

  it('serves a fill that was passed over many times before newer ones, and lets go of facts that are no longer wanted', async () => {
    let now = 0;
    const runner = new WorktreeFactsRunner({ emit: () => {}, concurrency: 1, maxAgeMs: 1_000, now: () => now });
    const old = slowListing(['o1']);
    const running = slowListing(['r0']);
    const first = runner.fill('/other', running.listing);
    await tick();
    const waitingOld = runner.fill('/old', old.listing);
    // Newer fills keep arriving; each is read before o1 until o1 has been passed over enough.
    const newer = Array.from({ length: 20 }, (_, i) => slowListing([`n${i}`]));
    const fills = newer.map((n) => runner.fill('/new', n.listing));
    await tick();
    running.release('r0');
    const done = new Set<string>();
    const releaseNewer = () => {
      for (const n of newer) {
        const name = n.entries[0]!.name;
        if (n.started.length && !done.has(name)) {
          done.add(name);
          n.release(name);
        }
      }
    };
    while (!old.started.length && done.size < newer.length) {
      await tick();
      releaseNewer();
    }
    // The oldest fill got its turn after at most 16 newer reads, not after all twenty.
    expect(old.started).toEqual(['/repo/o1']);
    expect(done.size).toBeLessThanOrEqual(17);
    old.release('o1');
    while (done.size < newer.length) {
      await tick();
      releaseNewer();
    }
    await Promise.all([first, waitingOld, ...fills]);
    // Everything that was read is gone from the cache once it is too old and something else is read.
    now += 5_000;
    const later = slowListing(['z']);
    const lastFill = runner.fill('/z', later.listing);
    await tick();
    later.release('z');
    await lastFill;
    expect((runner as unknown as { cache: Map<string, unknown> }).cache.size).toBe(1);
  });

  it('forgets what changed, and ignores a read that began before', async () => {
    const emitted: WorktreeFacts[] = [];
    const runner = new WorktreeFactsRunner({ emit: (_root, facts) => emitted.push(...facts) });
    const { listing, started, release, entries } = slowListing(['a']);
    const stale = runner.fill('/repo', listing);
    await tick();
    runner.invalidate(['/repo/a']);
    const fresh = runner.fill('/repo', listing);
    await tick();
    // The read that began before was thrown away, so a new one began; both finish, only the newer one counts.
    expect(started).toHaveLength(2);
    release('a');
    await Promise.all([stale, fresh]);
    expect(runner.known(entries)).toHaveLength(1);
    expect(emitted).toHaveLength(1);
  });

  it('waits for the fetch before reading, and reads on when it fails', async () => {
    const runner = new WorktreeFactsRunner({ emit: () => {} });
    const { listing, started, release } = slowListing(['a']);
    let fetched!: (error?: Error) => void;
    const after = new Promise<void>((resolve, reject) => (fetched = (error) => (error ? reject(error) : resolve())));
    const filled = runner.fill('/repo', listing, { after });
    await tick();
    expect(started).toEqual([]);
    fetched(new Error('offline'));
    await tick();
    expect(started).toEqual(['/repo/a']);
    release('a');
    await filled;
  });

  it('drops what a list without the fetch read meanwhile, and still sends the new facts to that list', async () => {
    const emitted: Array<[string, number]> = [];
    const runner = new WorktreeFactsRunner({ emit: (root, facts) => emitted.push(...facts.map((f): [string, number] => [root, f.uncommitted])) });
    const plain = slowListing(['a']);
    const withFetch = slowListing(['a']);
    let fetched!: () => void;
    const after = new Promise<void>((resolve) => (fetched = resolve));
    // The fetch list waits for its fetch; a list without one starts its reads and finishes them first.
    const waiting = runner.fill('/repo', withFetch.listing, { after });
    const quick = runner.fill('/repo/sibling', plain.listing);
    await tick();
    expect(plain.started).toEqual(['/repo/a']);
    fetched();
    await tick();
    // The read from before the fetch is not served to the fetch list: a new one begins, for both lists.
    expect(withFetch.started).toEqual(['/repo/a']);
    plain.release('a');
    await tick();
    expect(runner.known(withFetch.entries)).toEqual([]);
    withFetch.release('a');
    await Promise.all([waiting, quick]);
    expect(runner.known(withFetch.entries)).toHaveLength(1);
    expect(emitted.sort()).toEqual([
      ['/repo', 0],
      ['/repo/sibling', 0],
    ]);
  });

  it('leaves a worktree pending when its read fails, and finishes the rest', async () => {
    const emitted: string[] = [];
    const runner = new WorktreeFactsRunner({ emit: (_root, facts) => emitted.push(...facts.map((f) => f.path)) });
    const entries = [entry('a'), entry('b')];
    const listing: WorktreeListing = {
      list: { root: '/repo', baseBranch: 'main', pullRequests: false, worktrees: entries },
      facts: async (path) => {
        if (path.endsWith('/a')) throw new Error('gone');
        return factsOf(entries[1]!);
      },
    };
    await runner.fill('/repo', listing);
    expect(emitted).toEqual(['/repo/b']);
    expect(runner.known(entries).map((f) => f.path)).toEqual(['/repo/b']);
  });
});
