import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrations } from './migrations.ts';

export interface CacheDatabase {
  readonly db: DatabaseSync;
  /** The file in use: the cache itself, or the side file when the cache was left alone (see `fallback`). */
  readonly path: string;
  readonly sqliteVersion: string;
  /** True when a corrupt cache file was moved aside and rebuilt on open. */
  readonly recovered: boolean;
  /**
   * Set when the cache file could be read but not used, and was left untouched: it was written by a newer
   * build (`newerSchema` holds its version), or opening or migrating it failed for another reason. This run
   * uses a side file instead, so the user's choices in the cache are still there for the next build that can open it.
   */
  readonly fallback: { reason: string; newerSchema: number | null } | null;
  close(): void;
}

export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  return row?.user_version ?? 0;
}

/** The cache was written by a newer build. Not corruption: the file must be kept as it is. */
class NewerSchemaError extends Error {
  constructor(readonly version: number) {
    super(`Cache schema v${version} is newer than this build (v${migrations.length})`);
  }
}

function migrate(db: DatabaseSync): void {
  const current = schemaVersion(db);
  if (current > migrations.length) throw new NewerSchemaError(current);
  for (let version = current; version < migrations.length; version++) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

function openAndMigrate(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  try {
    // First, so switching to WAL waits for another process instead of failing at once.
    db.exec('PRAGMA busy_timeout = 2000');
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
    return db;
  } catch (error) {
    // Move a corrupt file aside while SQLite still has it open: closing the connection deletes its WAL.
    // Windows can't rename an open file, so there the WAL and shared memory are copied aside first, and the
    // database is moved after closing.
    if (!isCorruptionError(error)) {
      db.close();
    } else if (process.platform === 'win32') {
      const aside = asideName(path);
      for (const suffix of SIDE_FILES) if (existsSync(`${path}${suffix}`)) copyFileSync(`${path}${suffix}`, `${aside}${suffix}`);
      db.close();
      moveAside(path, aside);
    } else {
      moveAside(path);
      db.close();
    }
    throw error;
  }
}

/** SQLite's own verdict that the file is damaged or not a database (SQLITE_CORRUPT, SQLITE_NOTADB), as opposed to busy, read-only or a failed migration. */
export function isCorruptionError(error: unknown): boolean {
  const { errcode, message } = (error ?? {}) as { errcode?: unknown; message?: unknown };
  // Extended result codes keep the primary code in the low byte.
  if (typeof errcode === 'number' && ((errcode & 0xff) === 11 || (errcode & 0xff) === 26)) return true;
  return typeof message === 'string' && /file is not a database|database disk image is malformed/i.test(message);
}

/** Moves the cache and its WAL and shared-memory files aside together, so the copy keeps its last commits. */
function moveAside(path: string, aside = asideName(path)): void {
  if (!existsSync(path)) return;
  renameSync(path, aside);
  for (const suffix of SIDE_FILES) {
    if (existsSync(`${path}${suffix}`)) renameSync(`${path}${suffix}`, `${aside}${suffix}`);
  }
}

const SIDE_FILES = ['-wal', '-shm'];
const asideName = (path: string) => `${path}.broken-${Date.now()}`;

/**
 * Opens (or creates) the cache database. Most of it can be rebuilt from ~/.claude, but some tables hold user
 * choices (pins, projects, actions, profiles), so a file is only replaced when SQLite says it is corrupt; it is
 * then moved aside, never deleted. A file this build can't use for another reason (written by a newer build,
 * a failed migration, a lock) stays as it is, and this run works on a side file next to it instead of blocking
 * startup. Opening a newer schema in place is not an option: migrations rename and drop columns (v13), so an
 * older build's queries could fail or write rows the newer build misreads.
 */
export function openCacheDatabase(path: string): CacheDatabase {
  mkdirSync(dirname(path), { recursive: true });
  let db: DatabaseSync;
  let usedPath = path;
  let recovered = false;
  let fallback: CacheDatabase['fallback'] = null;
  try {
    db = openAndMigrate(path);
  } catch (error) {
    if (isCorruptionError(error)) {
      moveAside(path);
      db = openAndMigrate(path);
      recovered = true;
    } else {
      // One side file per schema version, so going back to an older build keeps its own choices between launches.
      usedPath = `${path}.v${migrations.length}`;
      try {
        db = openAndMigrate(usedPath);
      } catch (sideError) {
        if (!isCorruptionError(sideError)) throw sideError;
        moveAside(usedPath);
        db = openAndMigrate(usedPath);
      }
      fallback = { reason: (error as Error).message, newerSchema: error instanceof NewerSchemaError ? error.version : null };
    }
  }
  const { version } = db.prepare('SELECT sqlite_version() AS version').get() as { version: string };
  return {
    db,
    path: usedPath,
    sqliteVersion: version,
    recovered,
    fallback,
    close: () => db.close(),
  };
}
