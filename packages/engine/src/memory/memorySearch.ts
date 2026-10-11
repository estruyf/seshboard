import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { memoryMeta, splitFrontmatter, type MemoryHit } from '@switchboard/protocol';
import { MARK_END, MARK_START, toFtsQuery } from '../sessions/searchIndex.ts';

/** A memory folder to index: a project's (with the profile it belongs to) or the personal one (`root` null). */
export interface IndexedFolder {
  dir: string;
  root: string | null;
  profileId: string | null;
}

/** How much of a memory's body goes into the index. */
const MAX_BODY = 50_000;

/**
 * Full-text search over memory files, next to the conversations in the cache database. The folders stay the source of
 * truth: each sync reads only files whose mtime or size changed and drops ones that are gone, so the table can be
 * thrown away and rebuilt at any time.
 */
export class MemorySearch {
  private readonly statements;
  private readonly begin;
  private readonly commit;
  private readonly rollback;

  constructor(db: DatabaseSync) {
    const columns = `path, root, profile_id AS profileId, name, description, type, modified, origin`;
    this.statements = {
      versions: db.prepare('SELECT path, version FROM memory_indexed'),
      clear: db.prepare('DELETE FROM memory_fts WHERE path = ?'),
      insert: db.prepare('INSERT INTO memory_fts (path, root, profile_id, type, modified, origin, name, description, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      mark: db.prepare('INSERT OR REPLACE INTO memory_indexed (path, version) VALUES (?, ?)'),
      forget: db.prepare('DELETE FROM memory_indexed WHERE path = ?'),
      search: db.prepare(
        `SELECT ${columns}, snippet(memory_fts, -1, '${MARK_START}', '${MARK_END}', '…', 14) AS snippet
         FROM memory_fts WHERE memory_fts MATCH ? ORDER BY bm25(memory_fts, 0, 0, 0, 0, 0, 0, 4, 2, 1) LIMIT ?`,
      ),
      byOrigin: db.prepare(`SELECT ${columns}, '' AS snippet FROM memory_fts WHERE origin = ? ORDER BY modified DESC`),
    };
    this.begin = db.prepare('BEGIN');
    this.commit = db.prepare('COMMIT');
    this.rollback = db.prepare('ROLLBACK');
  }

  /**
   * Brings the index up to date with these folders: changed files read again, new ones added, and (`prune`) every file
   * that is no longer in one of them dropped. Returns how many files were read.
   */
  sync(folders: readonly IndexedFolder[], { prune = true }: { prune?: boolean } = {}): number {
    const indexed = new Map((this.statements.versions.all() as Array<{ path: string; version: string }>).map((r) => [r.path, r.version]));
    const seen = new Set<string>();
    let read = 0;
    this.begin.run();
    try {
      for (const folder of folders) {
        let names: string[];
        try {
          names = readdirSync(folder.dir).filter((n) => n.endsWith('.md') && n !== 'MEMORY.md');
        } catch {
          continue;
        }
        for (const name of names) {
          const path = join(folder.dir, name);
          let version: string;
          let modified: number;
          try {
            const stat = statSync(path);
            if (!stat.isFile()) continue;
            modified = stat.mtimeMs;
            version = `${stat.mtimeMs}:${stat.size}`;
          } catch {
            continue;
          }
          seen.add(path);
          if (indexed.get(path) === version) continue;
          let text: string;
          try {
            text = readFileSync(path, 'utf8');
          } catch {
            continue;
          }
          const { data, body } = splitFrontmatter(text);
          const meta = memoryMeta(data);
          this.statements.clear.run(path);
          this.statements.insert.run(path, folder.root, folder.profileId, meta.type, modified, meta.originSessionId, meta.name ?? name.slice(0, -3), meta.description ?? '', body.slice(0, MAX_BODY));
          this.statements.mark.run(path, version);
          read++;
        }
      }
      if (prune) {
        const dirs = folders.map((f) => f.dir + sep);
        for (const path of indexed.keys()) {
          // A file that is gone, or in a folder no longer indexed (a project removed from Switchboard).
          if (seen.has(path) && dirs.some((d) => path.startsWith(d))) continue;
          this.statements.clear.run(path);
          this.statements.forget.run(path);
        }
      }
      this.commit.run();
    } catch (error) {
      this.rollback.run();
      throw error;
    }
    return read;
  }

  /**
   * The best matches for what you typed (every word, the last one as a prefix), the name weighing most, then the
   * description. `types` keeps to those types; `scope` to one project's memory or the personal folder.
   */
  search(input: string, options: { types?: readonly string[]; scope?: 'all' | 'personal' | string; limit?: number } = {}): MemoryHit[] {
    const query = toFtsQuery(input);
    if (!query) return [];
    const { types, scope = 'all', limit = 30 } = options;
    try {
      // Filtering after the match keeps the query simple; memory folders are small.
      const hits = this.statements.search.all(query, 500) as unknown as MemoryHit[];
      return hits
        .filter((h) => (!types?.length || (h.type !== null && types.includes(h.type))) && (scope === 'all' || (scope === 'personal' ? h.root === null : h.root === scope)))
        .slice(0, limit)
        .map((h) => ({ ...h, modified: Number(h.modified) }));
    } catch {
      return [];
    }
  }

  /** The memories a session wrote (`metadata.originSessionId`), newest first. */
  bySession(sessionId: string): MemoryHit[] {
    return (this.statements.byOrigin.all(sessionId) as unknown as MemoryHit[]).map((h) => ({ ...h, modified: Number(h.modified) }));
  }
}
