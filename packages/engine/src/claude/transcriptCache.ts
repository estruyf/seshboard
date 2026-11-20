import { open, stat } from 'node:fs/promises';
import type { TranscriptEntry } from './compactedHistory.ts';
import type { RawSessionMessage } from './transcript.ts';

/** The bytes before the read offset that must be unchanged for a file to count as appended to. */
const TAIL = 1024;
/** The file bytes kept parsed, over every session (their entries take about 1.4 times that in memory). */
const MAX_BYTES = 32 * 1024 * 1024;

interface Cached {
  path: string;
  ino: number;
  size: number;
  mtimeMs: number;
  /** Where the last complete line ends: the next read starts here (a line still being written waits). */
  offset: number;
  /** The `TAIL` bytes before `offset`, to tell an append from a rewrite. */
  tail: Buffer;
  entries: TranscriptEntry[];
  /** What the reader built from `entries`, for as long as the file is unchanged. */
  messages: readonly RawSessionMessage[];
}

/** Builds the conversation from a file's entries: the SDK's `getSessionMessages` with a session store. */
export type BuildMessages = (entries: TranscriptEntry[]) => Promise<RawSessionMessage[]>;

/**
 * Parsed transcripts, shared by everything that reads them (the open transcript, search, catch-up, the phone), keyed
 * by session and checked against the file's size, time and inode on every read. A file that only grew has just its new
 * lines parsed; one that shrank, was replaced or changed before the last read offset is read whole again. Claude Code
 * only ever appends to a transcript (a rewind or a compaction adds lines too), so the append path is the usual one.
 * The conversation is always built by the SDK's reader from the whole list of entries, so how a transcript is read
 * stays the SDK's. Least recently read sessions go first past `maxBytes` of file.
 */
export class TranscriptCache {
  private readonly files = new Map<string, Cached>();
  /** One read at a time per session, so reads that come together share the work. */
  private readonly queues = new Map<string, Promise<unknown>>();
  private bytes = 0;
  /** Reads that parsed the whole file, only what was appended, or nothing (unchanged). */
  readonly stats = { full: 0, appended: 0, unchanged: 0 };

  constructor(private readonly maxBytes = MAX_BYTES) {}

  /** The session's messages from the transcript at `path`. The array is frozen: it is shared. */
  read(sessionId: string, path: string, build: BuildMessages): Promise<readonly RawSessionMessage[]> {
    const run = (this.queues.get(sessionId) ?? Promise.resolve()).catch(() => {}).then(() => this.readNow(sessionId, path, build));
    this.queues.set(sessionId, run);
    void run.finally(() => {
      if (this.queues.get(sessionId) === run) this.queues.delete(sessionId);
    }).catch(() => {});
    return run;
  }

  /** The entries of the session's file as last read, if cached (a compacted session's earlier parts are read from them). */
  entries(sessionId: string, path: string): readonly TranscriptEntry[] | null {
    const cached = this.files.get(sessionId);
    return cached?.path === path ? cached.entries : null;
  }

  private forget(sessionId: string): void {
    const cached = this.files.get(sessionId);
    if (!cached) return;
    this.files.delete(sessionId);
    this.bytes -= cached.offset;
  }

  private async readNow(sessionId: string, path: string, build: BuildMessages): Promise<readonly RawSessionMessage[]> {
    const info = await stat(path);
    const cached = this.files.get(sessionId);
    const same = cached && cached.path === path && cached.ino === info.ino;
    if (same && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
      this.stats.unchanged++;
      this.touch(sessionId, cached);
      return cached.messages;
    }
    const handle = await open(path, 'r');
    let next: Cached;
    try {
      const appended = same && info.size >= cached.offset && (await this.tailOf(handle, cached.offset)).equals(cached.tail);
      const start = appended ? cached.offset : 0;
      const buffer = Buffer.alloc(info.size - start);
      const { bytesRead } = buffer.length ? await handle.read(buffer, 0, buffer.length, start) : { bytesRead: 0 };
      // Only complete lines: the last one may still be being written.
      const end = buffer.lastIndexOf(10, bytesRead - 1) + 1;
      const fresh = parseLines(buffer.toString('utf8', 0, end));
      const offset = start + end;
      next = {
        path,
        ino: info.ino,
        size: info.size,
        mtimeMs: info.mtimeMs,
        offset,
        tail: offset === start && appended ? cached.tail : await this.tailOf(handle, offset),
        entries: appended ? cached.entries.concat(fresh) : fresh,
        messages: [],
      };
      if (appended) this.stats.appended++;
      else this.stats.full++;
    } finally {
      await handle.close();
    }
    next.messages = Object.freeze(await build(next.entries));
    this.forget(sessionId);
    this.files.set(sessionId, next);
    this.bytes += next.offset;
    this.evict(sessionId);
    return next.messages;
  }

  private async tailOf(handle: Awaited<ReturnType<typeof open>>, offset: number): Promise<Buffer> {
    const tail = Buffer.alloc(Math.min(TAIL, offset));
    const { bytesRead } = await handle.read(tail, 0, tail.length, offset - tail.length);
    return tail.subarray(0, bytesRead);
  }

  private touch(sessionId: string, cached: Cached): void {
    this.files.delete(sessionId);
    this.files.set(sessionId, cached);
  }

  /** Drops the least recently read sessions past the budget; the one just read stays, however big. */
  private evict(keep: string): void {
    for (const id of this.files.keys()) {
      if (this.bytes <= this.maxBytes) break;
      if (id !== keep) this.forget(id);
    }
  }
}

/** A transcript's lines as entries; a line that isn't valid JSON (a damaged one) is skipped, as the SDK's reader does. */
export function parseLines(text: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as unknown;
      if (entry && typeof entry === 'object' && typeof (entry as TranscriptEntry).type === 'string') entries.push(entry as TranscriptEntry);
    } catch {
      // Skipped.
    }
  }
  return entries;
}
