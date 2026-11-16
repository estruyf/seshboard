import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { browserProfileNameClash, cleanBrowserProfileName, findBrowserProfile, PROFILE_COLORS } from '@seshboard/protocol';

type Color = (typeof PROFILE_COLORS)[number];

/**
 * A browser profile as it is kept (docs/browser.md, Browser profiles): pages with their own cookies, storage and cache,
 * in the partition `persist:browser-<id>`, for one project (its root) or everywhere (null). The built-in Default
 * profile has no row. Not a Claude profile (`profiles/`).
 */
export interface BrowserProfile {
  id: string;
  name: string;
  color: Color;
  projectRoot: string | null;
  position: number;
  createdAt: number;
}

interface Row {
  id: string;
  name: string;
  color: string;
  project_root: string | null;
  position: number;
  created_at: number;
}

const toProfile = (row: Row): BrowserProfile => ({
  id: row.id,
  name: row.name,
  color: (PROFILE_COLORS as readonly string[]).includes(row.color) ? (row.color as Color) : 'gray',
  projectRoot: row.project_root,
  position: row.position,
  createdAt: row.created_at,
});

/** A name that can't be used, or another reason a change is refused: the window shows the message. */
export class BrowserProfileError extends Error {}

/**
 * Your browser profiles (`browser_profiles`). Nothing else has these: a cache rebuild keeps them. Deleting one also
 * forgets its pinned tabs and its history; main clears its pages' data before (`window.seshboard`).
 */
export class BrowserProfiles {
  private readonly statements;

  constructor(private readonly db: DatabaseSync) {
    this.statements = {
      list: db.prepare('SELECT * FROM browser_profiles ORDER BY position, created_at'),
      insert: db.prepare('INSERT INTO browser_profiles (id, name, color, project_root, position, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
      update: db.prepare('UPDATE browser_profiles SET name = ?, color = ?, project_root = ? WHERE id = ?'),
      remove: db.prepare('DELETE FROM browser_profiles WHERE id = ?'),
      tabs: db.prepare('DELETE FROM browser_tabs WHERE profile_id = ?'),
      history: db.prepare('DELETE FROM browser_history WHERE profile_id = ?'),
    };
  }

  list(): BrowserProfile[] {
    return (this.statements.list.all() as unknown as Row[]).map(toProfile);
  }

  /** A new profile, last in the list. Refused when another profile would answer to the same name there. */
  create(input: { name: string; color: Color; projectRoot: string | null }, now = Date.now()): BrowserProfile {
    const name = this.checkedName(input.name, input.projectRoot);
    const all = this.list();
    const profile: BrowserProfile = { id: randomUUID(), name, color: input.color, projectRoot: input.projectRoot, position: all.length ? Math.max(...all.map((p) => p.position)) + 1 : 0, createdAt: now };
    this.statements.insert.run(profile.id, profile.name, profile.color, profile.projectRoot, profile.position, profile.createdAt);
    return profile;
  }

  /** Renames a profile, or gives it another colour or place. */
  update(id: string, change: { name?: string; color?: Color; projectRoot?: string | null }): BrowserProfile {
    const existing = this.list().find((p) => p.id === id);
    if (!existing) throw new BrowserProfileError('That browser profile is gone.');
    const projectRoot = change.projectRoot === undefined ? existing.projectRoot : change.projectRoot;
    const name = change.name === undefined && projectRoot === existing.projectRoot ? existing.name : this.checkedName(change.name ?? existing.name, projectRoot, id);
    const next = { ...existing, name, color: change.color ?? existing.color, projectRoot };
    this.statements.update.run(next.name, next.color, next.projectRoot, id);
    return next;
  }

  /** Removes a profile, its pinned tabs and its history. */
  remove(id: string): void {
    this.db.exec('BEGIN');
    try {
      this.statements.tabs.run(id);
      this.statements.history.run(id);
      this.statements.remove.run(id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** The profile an agent named (`open`'s `profile`) among the ones its project can use; Default (null) for none. */
  find(name: string | null | undefined, projectRoot: string | null): { profile: BrowserProfile | null } | { error: string } {
    return findBrowserProfile(this.list(), name, projectRoot);
  }

  private checkedName(text: string, projectRoot: string | null, exceptId?: string): string {
    const name = cleanBrowserProfileName(text);
    if (!name) throw new BrowserProfileError('Give the browser profile a name.');
    const clash = browserProfileNameClash(this.list(), name, projectRoot, exceptId);
    if (clash) throw new BrowserProfileError(clash);
    return name;
  }
}
