import type { DatabaseSync } from 'node:sqlite';
import type { GitLooseEnd } from '@seshboard/protocol';
import { attributeLooseEnds, changedOwners, mergeLooseEnds, type BranchSession, type RepoFacts } from './looseEnds.ts';

/** Looked at again every few minutes while a window has focus, every 15 without (git and gh cost processes). */
export const FOREGROUND_EVERY_MS = 3 * 60_000;
export const BACKGROUND_EVERY_MS = 15 * 60_000;
/** A turn that ended waits this long, so a commit or a push right after it is in the same look. */
const TURN_END_DELAY_MS = 4_000;

/** A repository worth a look, with every session of it (the newest on a branch can be one that isn't a candidate). */
export interface RepoToCheck {
  root: string;
  sessions: readonly BranchSession[];
}

export interface LooseEndsWatcherOptions {
  /** The repositories with a candidate session (`isCandidate`), now. */
  repos(): RepoToCheck[];
  /** What a repository has; `facts` null when git couldn't read it, `github` false when GitHub's answer is unknown. */
  facts(root: string): Promise<{ facts: RepoFacts | null; github: boolean }>;
  /** A pipeline step's loose ends go to its run row (or the session the run started from). */
  ownerOf(sessionId: string): string;
  /** Every owner's loose ends, after a change. */
  emit(looseEnds: ReadonlyMap<string, readonly GitLooseEnd[]>): void;
  log?(message: string): void;
}

/**
 * `loose_ends`: the last loose ends found, per owner (a session or a run row) and repository, so a restart (or gh offline)
 * starts from what was known instead of from none. Derived: dropping it only costs a look.
 */
export class LooseEndsStore {
  private readonly statements;

  constructor(db: DatabaseSync) {
    this.statements = {
      all: db.prepare('SELECT owner, root, ends_json FROM loose_ends'),
      clear: db.prepare('DELETE FROM loose_ends WHERE root = ?'),
      put: db.prepare('INSERT INTO loose_ends (owner, root, ends_json, at) VALUES (?, ?, ?, ?) ON CONFLICT (owner) DO UPDATE SET root = excluded.root, ends_json = excluded.ends_json, at = excluded.at'),
    };
  }

  load(): Map<string, { root: string; ends: GitLooseEnd[] }> {
    const out = new Map<string, { root: string; ends: GitLooseEnd[] }>();
    for (const row of this.statements.all.all() as Array<{ owner: string; root: string; ends_json: string }>) {
      try {
        const ends = JSON.parse(row.ends_json) as GitLooseEnd[];
        if (Array.isArray(ends) && ends.length) out.set(row.owner, { root: row.root, ends });
      } catch {
        // A bad row is only a look away.
      }
    }
    return out;
  }

  /** Replaces one repository's rows. */
  save(root: string, ends: ReadonlyMap<string, readonly GitLooseEnd[]>, at = Date.now()): void {
    this.statements.clear.run(root);
    for (const [owner, list] of ends) this.statements.put.run(owner, root, JSON.stringify(list), at);
  }
}

/**
 * Finds what sessions left behind (`looseEnds.ts`), one look per repository with a candidate session: when a turn ends,
 * when a window comes to the front, and every few minutes (slower without a window in front). One look at a time.
 */
export class LooseEndsWatcher {
  private readonly current = new Map<string, { root: string; ends: GitLooseEnd[] }>();
  private foreground = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly turnRoots = new Set<string>();
  private running: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    private readonly options: LooseEndsWatcherOptions,
    private readonly store: LooseEndsStore | null = null,
  ) {
    for (const [owner, entry] of store?.load() ?? []) this.current.set(owner, entry);
  }

  /** Every owner's loose ends now. */
  all(): Map<string, GitLooseEnd[]> {
    return new Map([...this.current].map(([owner, { ends }]) => [owner, ends]));
  }

  /** The owners with loose ends: what the archive rule keeps listed (`keep`). */
  owners(): Set<string> {
    return new Set(this.current.keys());
  }

  start(): void {
    this.schedule(5_000);
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.turnTimer) clearTimeout(this.turnTimer);
  }

  /** A window has focus or not: coming to the front looks again at once. */
  setForeground(foreground: boolean): void {
    if (this.foreground === foreground) return;
    this.foreground = foreground;
    if (foreground) void this.refresh();
    else this.schedule(BACKGROUND_EVERY_MS);
  }

  /** A turn ended in `root`: look at that repository shortly. */
  turnEnded(root: string | null): void {
    if (!root || this.closed) return;
    this.turnRoots.add(root);
    if (this.turnTimer) return;
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;
      const roots = [...this.turnRoots];
      this.turnRoots.clear();
      void this.refresh(roots);
    }, TURN_END_DELAY_MS);
    this.turnTimer.unref?.();
  }

  /** Looks at every candidate repository (or only `roots` among them), after the look already going. */
  refresh(roots?: readonly string[]): Promise<void> {
    const next = this.running.then(() => this.look(roots)).catch((error: unknown) => this.options.log?.(`loose ends: ${error instanceof Error ? error.message : String(error)}`));
    this.running = next;
    return next;
  }

  private async look(roots?: readonly string[]): Promise<void> {
    if (this.closed) return;
    const repos = this.options.repos().filter((r) => !roots || roots.includes(r.root));
    const before = this.all();
    for (const repo of repos) {
      const { facts, github } = await this.options.facts(repo.root);
      const found = facts ? attributeLooseEnds(facts, repo.sessions, this.options.ownerOf) : new Map<string, GitLooseEnd[]>();
      const owners = new Set([...repo.sessions.map((s) => this.options.ownerOf(s.id)), ...[...this.current].filter(([, e]) => e.root === repo.root).map(([owner]) => owner)]);
      const merged = mergeLooseEnds(before, found, owners, { git: facts !== null, github });
      for (const owner of owners) {
        const ends = merged.get(owner);
        if (ends) this.current.set(owner, { root: repo.root, ends });
        else this.current.delete(owner);
      }
      this.store?.save(repo.root, new Map([...this.current].filter(([, e]) => e.root === repo.root).map(([owner, e]) => [owner, e.ends])));
    }
    if (changedOwners(before, this.all()).length) this.options.emit(this.all());
    if (!roots) this.schedule(this.foreground ? FOREGROUND_EVERY_MS : BACKGROUND_EVERY_MS);
  }

  private schedule(delay: number): void {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, delay);
    this.timer.unref?.();
  }
}
