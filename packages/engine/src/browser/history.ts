import type { DatabaseSync } from 'node:sqlite';

/** A page in the browser's history. */
export interface BrowserHistoryEntry {
  url: string;
  title: string;
  visits: number;
  lastVisit: number;
}

interface Row {
  url: string;
  title: string;
  visits: number;
  last_visit: number;
}

/** How many pages the history keeps: the ones opened longest ago go first. */
export const HISTORY_KEEP = 5000;
/** Old pages are dropped once every this many visits, not on each one. */
const PRUNE_EVERY = 100;

const toEntry = (row: Row): BrowserHistoryEntry => ({ url: row.url, title: row.title, visits: row.visits, lastVisit: row.last_visit });

/** `%`, `_` and the escape itself, taken as they are in a LIKE pattern. */
const likeText = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A browser profile's key in the history: its id, or '' for the built-in Default profile (null). */
const profileKey = (profileId: string | null | undefined): string => profileId ?? '';

/**
 * The pages you opened in the browser (`browser_history`), for the address bar's suggestions. One row per address and
 * browser profile, with how often and when last it was opened: a profile suggests only its own pages. Nothing else has
 * these: a cache rebuild keeps them.
 */
export class BrowserHistory {
  private readonly statements;
  private sincePrune = 0;

  constructor(db: DatabaseSync) {
    this.statements = {
      visit: db.prepare(
        `INSERT INTO browser_history (url, profile_id, title, visits, last_visit) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (url, profile_id) DO UPDATE SET
           title = CASE WHEN excluded.title = '' THEN title ELSE excluded.title END,
           visits = visits + excluded.visits,
           last_visit = CASE WHEN excluded.visits > 0 THEN excluded.last_visit ELSE last_visit END`,
      ),
      search: db.prepare(
        `SELECT * FROM browser_history WHERE profile_id = ? AND (url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')
         ORDER BY visits DESC, last_visit DESC LIMIT ?`,
      ),
      prune: db.prepare('DELETE FROM browser_history WHERE rowid NOT IN (SELECT rowid FROM browser_history ORDER BY last_visit DESC LIMIT ?)'),
      forget: db.prepare('DELETE FROM browser_history WHERE profile_id = ?'),
    };
  }

  /** A page opened (`counted`), or its title as it changes: the title is kept, the visit counted only once. */
  visit(url: string, title: string, counted: boolean, now = Date.now(), profileId: string | null = null): void {
    this.statements.visit.run(url, profileKey(profileId), title.slice(0, 500), counted ? 1 : 0, now);
    if (counted && ++this.sincePrune >= PRUNE_EVERY) this.prune();
  }

  /** A browser profile's pages whose address or title holds `query` (any case), most opened first. */
  search(query: string, limit: number, profileId: string | null = null): BrowserHistoryEntry[] {
    const pattern = `%${likeText(query.trim())}%`;
    return (this.statements.search.all(profileKey(profileId), pattern, pattern, limit) as unknown as Row[]).map(toEntry);
  }

  /** Forgets a browser profile's history (Reset; null: the Default profile's). */
  forget(profileId: string | null): void {
    this.statements.forget.run(profileKey(profileId));
  }

  /** Keeps the `keep` pages opened most recently. */
  prune(keep = HISTORY_KEEP): void {
    this.sincePrune = 0;
    this.statements.prune.run(keep);
  }
}
