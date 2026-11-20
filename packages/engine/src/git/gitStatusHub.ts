import { watch, type FSWatcher } from 'node:fs';
import { isSameOrInside, type ChangesBase, type GitChanges } from '@seshboard/protocol';

/** A result younger than this answers a request without running git again (several panes, the palette, a card). */
export const FRESH_MS = 1_000;
/**
 * While someone watches: a look this often, for edits git's own files don't show (an editor beside Seshboard). Windows
 * stop watching while they are hidden, so nothing polls for a window nobody sees.
 */
export const SAFETY_POLL_MS = 5_000;
/** Something changed (a write, a turn's end): the next look waits this long, so a burst of changes is one look. */
const SETTLE_MS = 250;
/** While a session keeps writing, a checkout is looked at no more often than this. */
const MIN_GAP_MS = 1_000;
/** What a checkout's facts (branch, base branch) may be at most, even without a sign that they changed. */
const FACTS_MS = 60_000;

/** What a status needs that changes only with HEAD or settings (`CheckoutFacts` in gitChanges.ts). */
export interface Facts {
  root: string;
  branch: string | null;
  baseBranch: string | null;
  hasHead: boolean;
}

export interface GitStatusHubOptions {
  /** The checkout's top folder (throws outside git). */
  topLevel(cwd: string): Promise<string>;
  /** The checkout's facts. */
  facts(root: string): Promise<Facts>;
  /** The changes, with the facts kept here. */
  list(root: string, base: ChangesBase, facts: Facts): Promise<GitChanges>;
  /** The folder with the checkout's own HEAD and index (`.git`, or `.git/worktrees/<name>` for a worktree). */
  gitDir(root: string): Promise<string | null>;
  /** Watches a folder (not recursive); tests pass a fake. */
  watch?(dir: string, onChange: (file: string | null) => void): { close(): void } | null;
  now?(): number;
  log?(message: string): void;
}

export type StatusListener = (changes: GitChanges | null, error: string | null) => void;

interface Entry {
  root: string;
  base: ChangesBase;
  result: GitChanges | null;
  error: string | null;
  /** When the last look ended (0: never), when the one under way began, and whether something changed since it began. */
  at: number;
  startedAt: number;
  dirty: boolean;
  /** The look under way; a request during it waits for one more (`follow`), which they all share. */
  running: Promise<void> | null;
  follow: Promise<void> | null;
  listeners: Set<StatusListener>;
  /** What the listeners were last told, to tell them only news. */
  told: string | null;
  settle: ReturnType<typeof setTimeout> | null;
}

/** A checkout watched for git's own changes (HEAD, index, refs), shared by its two bases. */
interface Watched {
  watcher: { close(): void } | null;
  users: number;
}

const keyOf = (root: string, base: ChangesBase) => `${base}\0${root}`;
const signature = (changes: GitChanges | null, error: string | null) => JSON.stringify([changes, error]);

/**
 * One source of git status per checkout and base, for everything that shows it: the session views (`git.watch`, which
 * pushes `git.changed`), the palette, catch-up and permission cards (`changes`). One look at a time; requests during a
 * look share the one after it; a result younger than `FRESH_MS` answers without git. A checkout someone watches is
 * looked at again when git's own files change (a commit, a stage, a branch switch), when `touch` says something may
 * have changed (a session wrote to its transcript, a window came to the front), and every `SAFETY_POLL_MS` while
 * watched. With nobody watching, nothing runs by itself. The checkout's folder and its facts (branch, base
 * branch, whether it has a commit) are kept, so a look is two git runs.
 */
export class GitStatusHub {
  private readonly entries = new Map<string, Entry>();
  private readonly roots = new Map<string, Promise<string>>();
  private readonly facts = new Map<string, { at: number; facts: Promise<Facts> }>();
  private readonly watched = new Map<string, Watched>();
  private foreground = true;
  private poll: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;

  constructor(private readonly options: GitStatusHubOptions) {
    this.now = options.now ?? Date.now;
  }

  /**
   * The changes in `cwd`'s checkout, from a look at most `maxAgeMs` old (0: a new look). Throws outside git, as
   * `listChanges` does.
   */
  async changes(cwd: string, base: ChangesBase, maxAgeMs = FRESH_MS): Promise<GitChanges> {
    const entry = this.entry(await this.rootOf(cwd), base);
    if (maxAgeMs === 0 || entry.dirty || !entry.at || this.now() - entry.at > maxAgeMs) await this.request(entry, maxAgeMs);
    if (entry.error !== null || !entry.result) throw new Error(entry.error ?? 'No changes read');
    return entry.result;
  }

  /** The last result for a checkout, when it is at most `maxAgeMs` old (loose ends counts uncommitted files with it). */
  fresh(root: string, base: ChangesBase, maxAgeMs: number): GitChanges | null {
    const entry = this.entries.get(keyOf(root, base));
    return entry?.result && !entry.dirty && this.now() - entry.at <= maxAgeMs ? entry.result : null;
  }

  /**
   * Follows `cwd`'s checkout: `listener` gets every new result (and the first one), and the checkout is looked at
   * whenever something may have changed. Returns the way to stop.
   */
  watch(cwd: string, base: ChangesBase, listener: StatusListener): () => void {
    let stopped = false;
    let entry: Entry | null = null;
    void this.rootOf(cwd).then(
      (root) => {
        if (stopped) return;
        entry = this.entry(root, base);
        entry.listeners.add(listener);
        this.useWatcher(root, 1);
        this.updatePoll();
        // A result already here goes at once; a look follows if it may be old.
        if (entry.result || entry.error !== null) listener(entry.result, entry.error);
        if (!entry.at || entry.dirty || this.now() - entry.at > FRESH_MS) void this.request(entry, FRESH_MS);
      },
      (error: Error) => !stopped && listener(null, error.message),
    );
    return () => {
      if (stopped) return;
      stopped = true;
      if (!entry) return;
      entry.listeners.delete(listener);
      this.useWatcher(entry.root, -1);
      if (entry.listeners.size === 0) entry.told = null;
      this.updatePoll();
    };
  }

  /**
   * Something may have changed in or under `path` (a session there wrote, its turn ended), or anywhere (no path: a
   * window came to the front). Watched checkouts there are looked at again shortly.
   */
  touch(path?: string | null): void {
    for (const entry of this.entries.values()) if (!path || isSameOrInside(path, entry.root)) this.touchEntry(entry);
  }

  /** Whether a window has focus: coming to the front looks at once (you may have changed files elsewhere). */
  setForeground(on: boolean): void {
    if (on === this.foreground) return;
    this.foreground = on;
    if (on) this.touch();
  }

  stop(): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    for (const entry of this.entries.values()) if (entry.settle) clearTimeout(entry.settle);
    for (const w of this.watched.values()) w.watcher?.close();
    this.watched.clear();
  }

  private entry(root: string, base: ChangesBase): Entry {
    const key = keyOf(root, base);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { root, base, result: null, error: null, at: 0, startedAt: 0, dirty: false, running: null, follow: null, listeners: new Set(), told: null, settle: null };
      this.entries.set(key, entry);
    }
    return entry;
  }

  private rootOf(cwd: string): Promise<string> {
    let root = this.roots.get(cwd);
    if (!root) {
      root = this.options.topLevel(cwd);
      this.roots.set(cwd, root);
      // Not a checkout (yet): ask again next time, it may become one.
      root.catch(() => this.roots.delete(cwd));
    }
    return root;
  }

  private factsOf(root: string): Promise<Facts> {
    const kept = this.facts.get(root);
    if (kept && this.now() - kept.at <= FACTS_MS) return kept.facts;
    const facts = this.options.facts(root);
    this.facts.set(root, { at: this.now(), facts });
    facts.catch(() => this.facts.delete(root));
    return facts;
  }

  /**
   * A look now; while one is under way, that one when it began at most `maxAgeMs` ago and nothing changed since, else
   * the one after it (shared by everyone who asks meanwhile).
   */
  private request(entry: Entry, maxAgeMs = 0): Promise<void> {
    if (!entry.running) return (entry.running = this.look(entry));
    if (maxAgeMs > 0 && !entry.dirty && this.now() - entry.startedAt <= maxAgeMs) return entry.running;
    entry.follow ??= entry.running.then(() => {
      entry.follow = null;
      return this.request(entry);
    });
    return entry.follow;
  }

  private async look(entry: Entry): Promise<void> {
    entry.dirty = false;
    entry.startedAt = this.now();
    try {
      const facts = await this.factsOf(entry.root);
      entry.result = await this.options.list(entry.root, entry.base, facts);
      entry.error = null;
    } catch (error) {
      entry.result = null;
      entry.error = (error as Error).message;
      // The checkout may have gone or changed shape: read its facts again next time.
      this.facts.delete(entry.root);
    } finally {
      entry.at = this.now();
      entry.running = null;
    }
    const told = signature(entry.result, entry.error);
    if (entry.listeners.size && told !== entry.told) {
      entry.told = told;
      for (const listener of entry.listeners) listener(entry.result, entry.error);
    }
  }

  private soon(entry: Entry): void {
    if (entry.settle) return;
    const wait = Math.max(SETTLE_MS, entry.at + MIN_GAP_MS - this.now());
    entry.settle = setTimeout(() => {
      entry.settle = null;
      void this.request(entry);
    }, wait);
    entry.settle.unref?.();
  }

  /** Watches a checkout's git folder while anyone watches the checkout (`delta` +1 or -1). */
  private useWatcher(root: string, delta: number): void {
    let w = this.watched.get(root);
    if (!w) {
      if (delta < 0) return;
      w = { watcher: null, users: 0 };
      this.watched.set(root, w);
      const kept = w;
      void this.options.gitDir(root).then((dir) => {
        if (!dir || this.watched.get(root) !== kept || kept.users === 0) return;
        kept.watcher = (this.options.watch ?? watchFolder)(dir, (file) => {
          // A new HEAD is a switch or a commit: the branch and base may be new too.
          if (!file || file === 'HEAD' || file.startsWith('refs')) this.facts.delete(root);
          for (const entry of this.entries.values()) if (entry.root === root) this.touchEntry(entry);
        });
      });
    }
    w.users += delta;
    if (w.users <= 0) {
      w.watcher?.close();
      this.watched.delete(root);
    }
  }

  private touchEntry(entry: Entry): void {
    entry.dirty = true;
    if (entry.listeners.size) this.soon(entry);
  }

  private updatePoll(): void {
    const want = [...this.entries.values()].some((e) => e.listeners.size > 0);
    if (want && !this.poll) {
      this.poll = setInterval(() => {
        for (const entry of this.entries.values()) if (entry.listeners.size && !entry.running) void this.request(entry);
      }, SAFETY_POLL_MS);
      this.poll.unref?.();
    } else if (!want && this.poll) {
      clearInterval(this.poll);
      this.poll = null;
    }
  }
}

/** `fs.watch` on one folder; null when it can't be watched (the safety poll still looks). */
function watchFolder(dir: string, onChange: (file: string | null) => void): FSWatcher | null {
  try {
    const watcher = watch(dir, (_event, file) => onChange(file ? file.toString() : null));
    watcher.on('error', () => watcher.close());
    return watcher;
  } catch {
    return null;
  }
}
