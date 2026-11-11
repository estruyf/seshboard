import type { DatabaseSync } from 'node:sqlite';

/** A pinned browser tab as it is kept: a session's (its id as `owner`) or the Browser view's (`'browser'`). */
export interface PinnedTab {
  id: string;
  owner: string;
  url: string;
  title: string;
  /** The name you gave it (Rename tab), shown in place of the page's title; null for none. */
  name: string | null;
  /** The page's icon as a small `data:` image, shown at start before the page loads; null for none. */
  favicon: string | null;
  position: number;
  pinnedAt: number;
}

interface Row {
  id: string;
  owner: string;
  url: string;
  title: string;
  name: string | null;
  favicon: string | null;
  position: number;
  pinned_at: number;
}

/** The Browser view's tabs, which belong to no session. */
export const BROWSER_OWNER = 'browser';

const toTab = (row: Row): PinnedTab => ({ id: row.id, owner: row.owner, url: row.url, title: row.title, name: row.name, favicon: row.favicon, position: row.position, pinnedAt: row.pinned_at });

/**
 * The browser tabs you pinned (`browser_tabs`), so they come back after a restart. Tabs that aren't pinned live only in
 * the window. Nothing else has these: a cache rebuild keeps them. An archived session keeps its tabs; a deleted one's go
 * with it (`forget`), and one this computer no longer knows goes at the next start (`prune`).
 */
export class PinnedTabs {
  private readonly statements;

  constructor(private readonly db: DatabaseSync) {
    this.statements = {
      list: db.prepare('SELECT * FROM browser_tabs ORDER BY owner, position, pinned_at'),
      save: db.prepare(
        `INSERT INTO browser_tabs (id, owner, url, title, name, favicon, position, pinned_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET owner = excluded.owner, url = excluded.url, title = excluded.title, name = excluded.name, favicon = excluded.favicon, position = excluded.position`,
      ),
      remove: db.prepare('DELETE FROM browser_tabs WHERE id = ?'),
      position: db.prepare('UPDATE browser_tabs SET position = ? WHERE id = ? AND owner = ?'),
      forget: db.prepare('DELETE FROM browser_tabs WHERE owner = ?'),
      owners: db.prepare('SELECT DISTINCT owner FROM browser_tabs'),
    };
  }

  list(): PinnedTab[] {
    return (this.statements.list.all() as unknown as Row[]).map(toTab);
  }

  /** Pins a tab, or updates one already pinned (its address and title as you browse, its name, its icon, its place). */
  save(tab: Omit<PinnedTab, 'pinnedAt' | 'name' | 'favicon'> & { pinnedAt?: number; name?: string | null; favicon?: string | null }): void {
    this.statements.save.run(tab.id, tab.owner, tab.url, tab.title, tab.name ?? null, tab.favicon ?? null, tab.position, tab.pinnedAt ?? Date.now());
  }

  remove(id: string): void {
    this.statements.remove.run(id);
  }

  /** An owner's pinned tabs in this order; ids it doesn't have are left alone. */
  reorder(owner: string, ids: readonly string[]): void {
    this.db.exec('BEGIN');
    try {
      ids.forEach((id, position) => this.statements.position.run(position, id, owner));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** A session deleted for good: its tabs go. */
  forget(sessionId: string): void {
    if (sessionId !== BROWSER_OWNER) this.statements.forget.run(sessionId);
  }

  /** Drops the tabs of sessions this computer doesn't know any more; the owners it dropped. */
  prune(known: (sessionId: string) => boolean): string[] {
    const gone = (this.statements.owners.all() as Array<{ owner: string }>).map((r) => r.owner).filter((owner) => owner !== BROWSER_OWNER && !known(owner));
    for (const owner of gone) this.statements.forget.run(owner);
    return gone;
  }
}
