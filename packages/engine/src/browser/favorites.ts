import type { DatabaseSync } from 'node:sqlite';

/** A browser favourite as it is kept: a site you open often. `favicon` is a `data:` image or null. */
export interface BrowserFavorite {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
  position: number;
  createdAt: number;
}

interface Row {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
  position: number;
  created_at: number;
}

const toFavorite = (row: Row): BrowserFavorite => ({ id: row.id, url: row.url, title: row.title, favicon: row.favicon, position: row.position, createdAt: row.created_at });

/** Your browser favourites (`browser_favorites`), from the toolbar's star. Nothing else has these: a cache rebuild keeps them. */
export class BrowserFavorites {
  private readonly statements;

  constructor(db: DatabaseSync) {
    this.statements = {
      list: db.prepare('SELECT * FROM browser_favorites ORDER BY position, created_at'),
      save: db.prepare(
        `INSERT INTO browser_favorites (id, url, title, favicon, position, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET url = excluded.url, title = excluded.title, favicon = excluded.favicon, position = excluded.position`,
      ),
      remove: db.prepare('DELETE FROM browser_favorites WHERE id = ?'),
    };
  }

  list(): BrowserFavorite[] {
    return (this.statements.list.all() as unknown as Row[]).map(toFavorite);
  }

  /** Adds a favourite, or updates one (its title, icon, place); the time it was added stays. */
  save(favorite: Omit<BrowserFavorite, 'createdAt'> & { createdAt?: number }): void {
    this.statements.save.run(favorite.id, favorite.url, favorite.title, favorite.favicon, favorite.position, favorite.createdAt ?? Date.now());
  }

  remove(id: string): void {
    this.statements.remove.run(id);
  }
}
