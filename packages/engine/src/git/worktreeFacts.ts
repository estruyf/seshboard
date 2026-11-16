import type { WorktreeEntry, WorktreeFacts } from '@seshboard/protocol';
import type { WorktreeListing } from './worktrees.ts';

/** A read of one worktree's facts under way (or waiting for a place), and everyone who waits for it. */
interface Read {
  task: Promise<void>;
  /** Every project (by the root its list was asked for) that gets the facts; two projects can hold the same worktree. */
  roots: Set<string>;
  /** Its place in the queue while it waits for one; null once it runs. */
  waiter: Waiter | null;
}

/** A read waiting for one of the places. The newest `fill` goes first, then the order within it. */
interface Waiter {
  fill: number;
  index: number;
  /** How many reads went before it while it waited. */
  passed: number;
  grant(): void;
}

/** A read passed over this many times goes before newer ones. */
const MAX_PASSED = 16;

/**
 * Reads the slow facts of worktrees in the background (`worktrees.list` answers without them): a few at a time across
 * every project, each one handed to `emit` as soon as it is read, and kept for a short while so a list asked again
 * right away (a tab opened twice, the Projects list and the Worktrees tab) neither waits nor starts the same work twice.
 * The same shape as the size measuring, `worktrees.size`.
 *
 * A read is shared by worktree path and HEAD: a list that saw the checkout at another commit reads it again, and every
 * project that waits for a read is sent its facts. The list asked last is served first, so the project you have open
 * isn't kept waiting behind the Projects list reading every other one.
 */
export class WorktreeFactsRunner {
  private readonly cache = new Map<string, { facts: WorktreeFacts; at: number }>();
  /** Reads under way, by worktree path and HEAD. */
  private readonly inflight = new Map<string, Read>();
  /** Bumped when a path's facts are thrown away, so a read that started before can't put old facts back. */
  private readonly generation = new Map<string, number>();
  /** Cached facts that fills under way still depend on (how many), by path and HEAD: they don't expire. */
  private readonly held = new Map<string, number>();
  private readonly waiting: Waiter[] = [];
  private running = 0;
  private fills = 0;

  constructor(
    private readonly options: {
      emit(root: string, facts: WorktreeFacts[]): void;
      /** Reads at once (each is a few git processes). */
      concurrency?: number;
      /** How long facts count as current. */
      maxAgeMs?: number;
      now?: () => number;
    },
  ) {}

  private now = () => (this.options.now ?? Date.now)();
  private generationOf = (path: string) => this.generation.get(path) ?? 0;
  private keyOf = (path: string, head: string | null) => `${path}\0${head ?? ''}`;
  private readsOf = (path: string) => [...this.inflight.entries()].filter(([key]) => key.startsWith(`${path}\0`));

  /** The facts already read, and recent enough, for these entries (a checkout that has moved since isn't matched). */
  known(entries: readonly WorktreeEntry[]): WorktreeFacts[] {
    const found: WorktreeFacts[] = [];
    for (const entry of entries) {
      const key = this.keyOf(entry.path, entry.head);
      const hit = this.cache.get(key);
      if (hit && (this.held.has(key) || this.fresh(hit))) found.push(hit.facts);
    }
    return found;
  }

  private fresh = (hit: { at: number }) => this.now() - hit.at < (this.options.maxAgeMs ?? 30_000);

  /** Lets go of facts nobody can ask for any more, so the cache doesn't grow with every checkout that ever moved. */
  private dropExpired(): void {
    for (const [key, hit] of this.cache) if (!this.held.has(key) && !this.fresh(hit)) this.cache.delete(key);
  }

  /** Throws away what is known of these worktrees (all of them without `paths`): they changed, or a fetch moved the base. */
  invalidate(paths?: Iterable<string>): void {
    for (const path of paths ?? new Set([...this.cache.keys(), ...this.inflight.keys()].map((key) => key.split('\0')[0]!))) {
      for (const key of [...this.cache.keys()]) if (key.startsWith(`${path}\0`)) this.cache.delete(key);
      for (const [key] of this.readsOf(path)) this.inflight.delete(key);
      this.generation.set(path, this.generationOf(path) + 1);
    }
  }

  /**
   * Reads the facts of every entry of `listing` that isn't known yet, emitting each as it is read; resolves when all are
   * in. `after` is waited for first (a fetch, so "merged" and "pushed" are read against what it brought): what was read
   * or cached before it is dropped, and the projects that waited for those reads wait for the new ones. A read that
   * fails leaves its worktree pending.
   */
  async fill(root: string, listing: WorktreeListing, options: { after?: Promise<unknown> } = {}): Promise<void> {
    const fill = ++this.fills;
    const entries = listing.list.worktrees;
    const held = entries.map((e) => this.keyOf(e.path, e.head));
    let holding = false;
    // What this fill has read doesn't age out while it runs (nor for a fill asked meanwhile): in a big repository the
    // first facts are older than `maxAgeMs` before the last are in, and a reload must get them, not read them again.
    // Taken once it is known what is current already, so it can't make an old fact look current.
    const hold = () => {
      holding = true;
      for (const key of held) this.held.set(key, (this.held.get(key) ?? 0) + 1);
    };
    try {
      await this.fillHeld(root, listing, fill, options, hold);
    } finally {
      for (const key of holding ? held : []) {
        const left = (this.held.get(key) ?? 1) - 1;
        // Once nothing holds them, facts count by the time they were read: an old one is pending again and read anew
        // (a worktree edited while a long fill ran must not look clean for another half minute).
        if (left > 0) this.held.set(key, left);
        else this.held.delete(key);
      }
    }
  }

  private async fillHeld(root: string, listing: WorktreeListing, fill: number, options: { after?: Promise<unknown> }, hold: () => void): Promise<void> {
    const entries = listing.list.worktrees;
    const inherited = new Map<string, Set<string>>();
    if (options.after) {
      await options.after.catch(() => {});
      for (const entry of entries) {
        const roots = new Set(this.readsOf(entry.path).flatMap(([, read]) => [...read.roots]));
        if (roots.size) inherited.set(entry.path, roots);
      }
      this.invalidate(entries.map((e) => e.path));
    }
    const have = new Set(this.known(entries).map((f) => f.path));
    hold();
    await Promise.all(
      entries.flatMap((entry, index) => (have.has(entry.path) ? [] : [this.read(root, listing, entry, fill, index, inherited.get(entry.path))])),
    );
  }

  private read(root: string, listing: WorktreeListing, entry: WorktreeEntry, fill: number, index: number, alsoFor?: ReadonlySet<string>): Promise<void> {
    const key = this.keyOf(entry.path, entry.head);
    const running = this.inflight.get(key);
    if (running) {
      running.roots.add(root);
      if (running.waiter && fill > running.waiter.fill) Object.assign(running.waiter, { fill, index });
      return running.task;
    }
    const read: Read = { task: Promise.resolve(), roots: new Set([root, ...(alsoFor ?? [])]), waiter: null };
    const generation = this.generationOf(entry.path);
    const { ready, waiter } = this.acquire(fill, index);
    read.waiter = waiter;
    read.task = ready
      .then(async (release) => {
        read.waiter = null;
        try {
          // Thrown away while it waited for its turn: don't spend git on it.
          if (this.generationOf(entry.path) !== generation) return;
          const facts = await listing.facts(entry.path);
          if (this.generationOf(entry.path) !== generation) return;
          this.dropExpired();
          this.cache.set(key, { facts, at: this.now() });
          for (const to of read.roots) this.options.emit(to, [facts]);
        } finally {
          release();
        }
      })
      .catch(() => {})
      .finally(() => {
        if (this.inflight.get(key) === read) this.inflight.delete(key);
      });
    this.inflight.set(key, read);
    return read.task;
  }

  /** A place to read in, now or when one is free, and the way to give it up. */
  private acquire(fill: number, index: number): { ready: Promise<() => void>; waiter: Waiter | null } {
    const release = () => {
      this.running--;
      // The newest fill first; but one that has been passed over many times goes before any newer one, so reloads
      // asked again and again can't keep an older fill waiting for good.
      const rank = (w: Waiter) => (w.passed >= MAX_PASSED ? Infinity : w.fill);
      const next = this.waiting.reduce<Waiter | null>((best, w) => (!best || rank(w) > rank(best) || (rank(w) === rank(best) && (w.fill < best.fill || (w.fill === best.fill && w.index < best.index))) ? w : best), null);
      if (next) {
        this.waiting.splice(this.waiting.indexOf(next), 1);
        for (const w of this.waiting) w.passed++;
        next.grant();
      }
    };
    if (this.running < (this.options.concurrency ?? 4)) {
      this.running++;
      return { ready: Promise.resolve(release), waiter: null };
    }
    let waiter!: Waiter;
    const ready = new Promise<() => void>((resolve) => {
      waiter = {
        fill,
        index,
        passed: 0,
        grant: () => {
          this.running++;
          resolve(release);
        },
      };
    });
    this.waiting.push(waiter);
    return { ready, waiter };
  }
}
