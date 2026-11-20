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
/**
 * How long a checkout's facts (branch, base branch) are kept: long while its git folder is watched (a change there
 * clears them), short without a watch (on Windows, or a checkout only asked about now and then).
 */
const FACTS_WATCHED_MS = 60_000;
const FACTS_UNWATCHED_MS = 5_000;
/** A checkout nobody watches is forgotten this long after its last look. */
const FORGET_MS = 60_000;
/** A watched folder that isn't a checkout (yet) is asked again at most this often (and on a touch or focus). */
const RETRY_ROOT_MS = 30_000;

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
  /**
   * Watches a folder (not recursive); tests pass a fake. Null: no watch (the default on Windows, where a watch on
   * `.git` can keep the project's folder from being renamed or moved to the Trash: polls and touches do the work there).
   */
  watch?: ((dir: string, onChange: (file: string | null) => void) => { close(): void } | null) | null;
  now?(): number;
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
  settle: ReturnType<typeof setTimeout> | null;
}

/** A checkout watched for git's own changes (HEAD, index, refs), shared by its two bases. */
interface Watched {
  watcher: { close(): void } | null;
  users: number;
}

/** A watch on a folder that isn't a checkout yet (`git init` or a clone may make it one). */
interface Pending {
  base: ChangesBase;
  listener: StatusListener;
  /** Starts the watch once the folder is a checkout. */
  attach(root: string): void;
}

const keyOf = (root: string, base: ChangesBase) => `${base}\0${root}`;
/** Files in the git folder that change with a stage but say nothing about the branch, the base or a first commit. */
const INDEX_ONLY = new Set(['index', 'index.lock']);

/**
 * One source of git status per checkout and base, for everything that shows it: the session views (`git.watch`, which
 * pushes `git.changed`), the palette, catch-up and permission cards (`changes`). One look at a time; requests during a
 * look share the one after it; a result younger than `FRESH_MS` answers without git. A checkout someone watches is
 * looked at again when git's own files change (a commit, a stage, a branch switch), when `touch` says something may
 * have changed (a session wrote, Seshboard ran a git action there, a window came to the front), and every
 * `SAFETY_POLL_MS` while watched; every look goes to the watchers (an open diff reloads with it). With nobody
 * watching, nothing runs by itself. The checkout's folder and its facts (branch, base branch, whether it has a commit)
 * are kept, so a look is two git runs.
 */
export class GitStatusHub {
  private readonly entries = new Map<string, Entry>();
  private readonly roots = new Map<string, Promise<string>>();
  private readonly facts = new Map<string, { at: number; facts: Promise<Facts> }>();
  private readonly watched = new Map<string, Watched>();
  /** Watches on folders that aren't checkouts yet, by folder, and when each was last asked. */
  private readonly pending = new Map<string, { since: number; items: Set<Pending> }>();
  private foreground = true;
  private poll: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;
  private readonly watchDir: ((dir: string, onChange: (file: string | null) => void) => { close(): void } | null) | null;

  constructor(private readonly options: GitStatusHubOptions) {
    this.now = options.now ?? Date.now;
    this.watchDir = options.watch === undefined ? (process.platform === 'win32' ? null : watchFolder) : options.watch;
  }

  /**
   * The changes in `cwd`'s checkout, from a look at most `maxAgeMs` old (0: a new look). Throws outside git, as
   * `listChanges` does.
   */
  async changes(cwd: string, base: ChangesBase, maxAgeMs = FRESH_MS): Promise<GitChanges> {
    this.prune();
    const entry = this.entry(await this.rootOf(cwd), base);
    if (maxAgeMs === 0 || entry.dirty || !entry.at || this.now() - entry.at > maxAgeMs) await this.request(entry, maxAgeMs);
    if (entry.error !== null || !entry.result) throw new Error(entry.error ?? 'No changes read');
    return entry.result;
  }

  /**
   * The last result for a checkout a view watches (so it is kept current), when at most `maxAgeMs` old: loose ends
   * counts uncommitted files with it instead of running git itself.
   */
  fresh(root: string, base: ChangesBase, maxAgeMs: number): GitChanges | null {
    const entry = this.entries.get(keyOf(root, base));
    return entry?.listeners.size && entry.result && !entry.dirty && this.now() - entry.at <= maxAgeMs ? entry.result : null;
  }

  /**
   * Follows `cwd`'s checkout: `listener` gets the result of every look (the first one too, or the last one at once),
   * and the checkout is looked at whenever something may have changed. A folder that isn't a checkout says so, and is
   * followed once it becomes one. Returns the way to stop.
   */
  watch(cwd: string, base: ChangesBase, listener: StatusListener): () => void {
    let stopped = false;
    let entry: Entry | null = null;
    const attach = (root: string) => {
      if (stopped) return;
      entry = this.entry(root, base);
      entry.listeners.add(listener);
      this.useWatcher(root, 1);
      this.updatePoll();
      // A result already here goes at once; a look follows if it may be old.
      if (entry.result || entry.error !== null) listener(entry.result, entry.error);
      if (!entry.at || entry.dirty || this.now() - entry.at > FRESH_MS) void this.request(entry, FRESH_MS);
    };
    const waiting: Pending = { base, listener, attach };
    void this.rootOf(cwd).then(attach, (error: Error) => {
      if (stopped) return;
      listener(null, error.message);
      let pending = this.pending.get(cwd);
      if (!pending) this.pending.set(cwd, (pending = { since: this.now(), items: new Set() }));
      pending.items.add(waiting);
      this.updatePoll();
    });
    return () => {
      if (stopped) return;
      stopped = true;
      const pending = this.pending.get(cwd);
      if (pending?.items.delete(waiting) && pending.items.size === 0) this.pending.delete(cwd);
      if (entry) {
        entry.listeners.delete(listener);
        this.useWatcher(entry.root, -1);
      }
      this.updatePoll();
    };
  }

  /**
   * Something may have changed in `path` (a session there wrote, its turn ended, Seshboard ran a git action there), or
   * anywhere (no path: a window came to the front). The checkout `path` is in is looked at again shortly: the deepest
   * one, so a write in a worktree doesn't look at the main checkout around it.
   */
  touch(path?: string | null): void {
    if (!path) {
      for (const entry of this.entries.values()) this.touchEntry(entry);
      this.retryPending(true);
      return;
    }
    let deepest = '';
    for (const entry of this.entries.values()) if (isSameOrInside(path, entry.root) && entry.root.length > deepest.length) deepest = entry.root;
    for (const entry of this.entries.values()) if (entry.root === deepest) this.touchEntry(entry);
    for (const cwd of this.pending.keys()) if (isSameOrInside(path, cwd) || isSameOrInside(cwd, path)) this.retryRoot(cwd);
  }

  /** The project's settings changed (its default branch): every checkout's base branch is read again. */
  settingsChanged(): void {
    this.facts.clear();
    this.touch();
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
    this.pending.clear();
  }

  private entry(root: string, base: ChangesBase): Entry {
    const key = keyOf(root, base);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { root, base, result: null, error: null, at: 0, startedAt: 0, dirty: false, running: null, follow: null, listeners: new Set(), settle: null };
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

  /** Asks again whether waiting folders are checkouts now: all on a touch, else those not asked for `RETRY_ROOT_MS`. */
  private retryPending(all: boolean): void {
    for (const [cwd, pending] of this.pending) if (all || this.now() - pending.since >= RETRY_ROOT_MS) this.retryRoot(cwd);
  }

  private retryRoot(cwd: string): void {
    const pending = this.pending.get(cwd);
    if (!pending) return;
    pending.since = this.now();
    void this.rootOf(cwd).then(
      (root) => {
        const now = this.pending.get(cwd);
        if (!now) return;
        this.pending.delete(cwd);
        for (const item of now.items) item.attach(root);
        this.updatePoll();
      },
      () => {},
    );
  }

  private factsOf(root: string): Promise<Facts> {
    const kept = this.facts.get(root);
    const lifetime = this.watched.get(root)?.watcher ? FACTS_WATCHED_MS : FACTS_UNWATCHED_MS;
    if (kept && this.now() - kept.at <= lifetime) return kept.facts;
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
    // Every look, also one that found the same: an open diff reloads with it (an edit can keep its counts).
    for (const listener of entry.listeners) listener(entry.result, entry.error);
    // Changed while it looked: once more.
    if (entry.dirty && entry.listeners.size) this.soon(entry);
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
      const watchDir = this.watchDir;
      if (watchDir) {
        void this.options.gitDir(root).then((dir) => {
          if (!dir || this.watched.get(root) !== kept || kept.users === 0) return;
          kept.watcher = watchDir(dir, (file) => {
            // Anything but the index (a stage) may be a commit, a switch or new refs: the facts are read again.
            if (!file || !INDEX_ONLY.has(file)) this.facts.delete(root);
            for (const entry of this.entries.values()) if (entry.root === root) this.touchEntry(entry);
          });
        });
      }
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

  /** Forgets checkouts nobody watches, not looked at for `FORGET_MS`. */
  private prune(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.listeners.size || entry.running || entry.settle || now - entry.at < FORGET_MS) continue;
      this.entries.delete(key);
      if (![...this.entries.values()].some((e) => e.root === entry.root)) this.facts.delete(entry.root);
    }
  }

  private updatePoll(): void {
    const want = this.pending.size > 0 || [...this.entries.values()].some((e) => e.listeners.size > 0);
    if (want && !this.poll) {
      this.poll = setInterval(() => {
        for (const entry of this.entries.values()) if (entry.listeners.size && !entry.running) void this.request(entry);
        this.retryPending(false);
        this.prune();
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
