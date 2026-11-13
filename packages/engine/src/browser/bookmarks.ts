import type { DatabaseSync } from 'node:sqlite';

/**
 * A browser bookmark as it is kept: a link to find again (⌘D or the star), in a folder ('' for none), for one project
 * (its root) or everywhere (null). `favicon` is a `data:` image or null.
 */
export interface BrowserBookmark {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
  folder: string;
  projectRoot: string | null;
  position: number;
  createdAt: number;
}

interface Row {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
  folder: string;
  project_root: string | null;
  position: number;
  created_at: number;
}

const toBookmark = (row: Row): BrowserBookmark => ({
  id: row.id,
  url: row.url,
  title: row.title,
  favicon: row.favicon,
  folder: row.folder,
  projectRoot: row.project_root,
  position: row.position,
  createdAt: row.created_at,
});

/** Your browser bookmarks (`browser_bookmarks`). Nothing else has these: a cache rebuild keeps them. */
export class BrowserBookmarks {
  private readonly statements;

  constructor(db: DatabaseSync) {
    this.statements = {
      list: db.prepare('SELECT * FROM browser_bookmarks ORDER BY position, created_at'),
      save: db.prepare(
        `INSERT INTO browser_bookmarks (id, url, title, favicon, folder, project_root, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET url = excluded.url, title = excluded.title, favicon = excluded.favicon, folder = excluded.folder,
           project_root = excluded.project_root, position = excluded.position`,
      ),
      remove: db.prepare('DELETE FROM browser_bookmarks WHERE id = ?'),
    };
  }

  list(): BrowserBookmark[] {
    return (this.statements.list.all() as unknown as Row[]).map(toBookmark);
  }

  /** Adds a bookmark, or updates one (its name, folder, project, icon, place); the time it was added stays. */
  save(bookmark: Omit<BrowserBookmark, 'createdAt'> & { createdAt?: number }): void {
    this.statements.save.run(bookmark.id, bookmark.url, bookmark.title, bookmark.favicon, bookmark.folder, bookmark.projectRoot, bookmark.position, bookmark.createdAt ?? Date.now());
  }

  remove(id: string): void {
    this.statements.remove.run(id);
  }
}
