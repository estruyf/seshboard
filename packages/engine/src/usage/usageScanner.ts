import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { hourOf, parseUsageLine, USAGE_MARKER, type UsageLine } from './transcriptUsage.ts';

/** A config folder to read: its `projects/` transcripts count for `scope`. */
export interface ScanTarget {
  scope: string;
  configDir: string;
}

/** The scope a config folder counts under: its real path, so two profiles on one folder (or a link to it) count once. */
export function scopeOf(configDir: string): string {
  try {
    return realpathSync(configDir);
  } catch {
    return resolve(configDir);
  }
}

const CHUNK = 1 << 20;
/** How many bytes before the read offset are hashed to notice a rewritten file: lines end alike (`"speed":"standard"}}}`), so enough to span a few. */
const TAIL = 1024;
const MARKER = Buffer.from(USAGE_MARKER);

const hashOf = (bytes: Buffer) => createHash('sha1').update(bytes).digest('hex');

/** Every `.jsonl` under a folder: session transcripts, and subagent transcripts in `<session>/subagents/`. */
async function transcripts(dir: string, depth = 0): Promise<string[]> {
  if (depth > 4) return [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await transcripts(path, depth + 1)));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) found.push(path);
  }
  return found;
}

export interface ScanProgress {
  done: number;
  total: number;
}

/**
 * Reads token usage from Claude Code's transcripts into `session_usage`. Transcripts are append-only, so each file is
 * read from where the last scan stopped (its last complete line); a file that shrank or whose bytes before that point
 * changed is read again from the start. Every response is counted once (`usage_messages`), however many lines and
 * files repeat it. Reading yields between files, so the engine keeps answering during a long first scan.
 */
export class UsageScanner {
  private readonly statements: Record<'file' | 'saveFile' | 'seen' | 'add' | 'cwd', StatementSync>;
  private running: Promise<boolean> | null = null;
  /** Scopes read completely at least once. */
  private readonly scanned = new Set<string>();

  constructor(private readonly db: DatabaseSync) {
    this.statements = {
      file: db.prepare('SELECT size, mtime, offset, tail_hash FROM usage_files WHERE path = ?'),
      saveFile: db.prepare(
        'INSERT INTO usage_files (path, scope, size, mtime, offset, tail_hash) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (path) DO UPDATE SET scope = excluded.scope, size = excluded.size, mtime = excluded.mtime, offset = excluded.offset, tail_hash = excluded.tail_hash',
      ),
      seen: db.prepare('INSERT OR IGNORE INTO usage_messages (key, scope, session_id, at) VALUES (?, ?, ?, ?)'),
      add: db.prepare(
        `INSERT INTO session_usage (scope, session_id, hour, model, input, output, cache_read, cache_write, turns, fast_turns, max_context)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT (scope, session_id, hour, model) DO UPDATE SET
           input = input + excluded.input, output = output + excluded.output, cache_read = cache_read + excluded.cache_read,
           cache_write = cache_write + excluded.cache_write, turns = turns + 1, fast_turns = fast_turns + excluded.fast_turns,
           max_context = MAX(max_context, excluded.max_context)`,
      ),
      cwd: db.prepare('INSERT INTO usage_sessions (scope, session_id, cwd) VALUES (?, ?, ?) ON CONFLICT (scope, session_id) DO UPDATE SET cwd = COALESCE(cwd, excluded.cwd)'),
    };
  }

  /** Whether a scope has been read completely at least once since the engine started. */
  hasScanned(scope: string): boolean {
    return this.scanned.has(scope);
  }

  /**
   * Reads what is new in every target's transcripts (one at a time; a call during a scan waits for it and starts
   * another). `onProgress` follows the files; `onFile` is told after a file added tokens. Resolves to whether
   * anything was added.
   */
  scan(targets: readonly ScanTarget[], hooks: { onProgress?: (scope: string, progress: ScanProgress) => void; onFile?: (scope: string) => void } = {}): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      // Profiles on the same folder are read once.
      const unique = [...new Map(targets.map((t) => [t.scope, t])).values()];
      let added = false;
      for (const target of unique) {
        const files = await transcripts(join(target.configDir, 'projects'));
        let done = 0;
        hooks.onProgress?.(target.scope, { done, total: files.length });
        for (const path of files) {
          if (await this.readFile(target.scope, path)) {
            added = true;
            hooks.onFile?.(target.scope);
          }
          done++;
          hooks.onProgress?.(target.scope, { done, total: files.length });
          await new Promise((r) => setImmediate(r));
        }
        if (existsSync(target.configDir)) this.scanned.add(target.scope);
      }
      return added;
    };
    const previous = this.running ?? Promise.resolve(false);
    const next = previous.catch(() => false).then(run);
    this.running = next.finally(() => {
      if (this.running === next) this.running = null;
    });
    return next;
  }

  /** Reads one file's new lines. True when it added tokens. */
  private async readFile(scope: string, path: string): Promise<boolean> {
    let info;
    try {
      info = await stat(path);
    } catch {
      return false;
    }
    const size = info.size;
    const mtime = Math.floor(info.mtimeMs);
    const known = this.statements.file.get(path) as { size: number; mtime: number; offset: number; tail_hash: string | null } | undefined;
    if (known && known.size === size && known.mtime === mtime) return false;

    let handle;
    try {
      handle = await open(path, 'r');
    } catch {
      return false;
    }
    try {
      let start = known?.offset ?? 0;
      if (known && start > 0) {
        // Rewritten or replaced rather than appended to: read it all again (counted responses stay counted once).
        const tail = Buffer.alloc(Math.min(TAIL, start));
        const { bytesRead } = await handle.read(tail, 0, tail.length, start - tail.length);
        if (size < start || bytesRead !== tail.length || hashOf(tail) !== known.tail_hash) start = 0;
      }
      const lines: UsageLine[] = [];
      let offset = start;
      let pending: Buffer[] = [];
      let position = start;
      const buffer = Buffer.alloc(CHUNK);
      while (position < size) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(CHUNK, size - position), position);
        if (bytesRead === 0) break;
        const chunk = buffer.subarray(0, bytesRead);
        let from = 0;
        let newline = chunk.indexOf(10, from);
        while (newline !== -1) {
          const piece = chunk.subarray(from, newline);
          const line = pending.length ? Buffer.concat([...pending, piece]) : piece;
          pending = [];
          // Lines without the marker (tool results can be megabytes) are never decoded.
          if (line.indexOf(MARKER) !== -1) {
            const parsed = parseUsageLine(line.toString('utf8'));
            if (parsed) lines.push(parsed);
          }
          offset = position + newline + 1;
          from = newline + 1;
          newline = chunk.indexOf(10, from);
        }
        // A line that runs on into the next chunk. A last line without its newline yet is left for the next scan.
        if (from < bytesRead) pending.push(Buffer.from(chunk.subarray(from)));
        position += bytesRead;
      }
      let tailHash: string | null = null;
      if (offset > 0) {
        const tail = Buffer.alloc(Math.min(TAIL, offset));
        await handle.read(tail, 0, tail.length, offset - tail.length);
        tailHash = hashOf(tail);
      }
      return this.store(scope, path, { size, mtime, offset, tailHash }, lines);
    } finally {
      await handle.close();
    }
  }

  /** Counts a file's new responses and saves how far it was read, in one transaction. */
  private store(scope: string, path: string, file: { size: number; mtime: number; offset: number; tailHash: string | null }, lines: UsageLine[]): boolean {
    let added = false;
    this.db.exec('BEGIN');
    try {
      for (const line of lines) {
        if (this.statements.seen.run(line.key, scope, line.sessionId, line.at).changes === 0) continue;
        added = true;
        this.statements.add.run(
          scope,
          line.sessionId,
          hourOf(line.at),
          line.model,
          line.input,
          line.output,
          line.cacheRead,
          line.cacheWrite,
          line.fast ? 1 : 0,
          line.input + line.cacheRead + line.cacheWrite,
        );
        if (line.cwd) this.statements.cwd.run(scope, line.sessionId, line.cwd);
      }
      this.statements.saveFile.run(path, scope, file.size, file.mtime, file.offset, file.tailHash);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return added;
  }
}
