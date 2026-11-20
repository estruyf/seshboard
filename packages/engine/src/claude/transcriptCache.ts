import { open } from 'node:fs/promises';
import type { TranscriptEntry } from './compactedHistory.ts';
import type { RawSessionMessage } from './transcript.ts';

/** The bytes before the read offset that must be unchanged for a file to count as appended to. */
const TAIL = 1024;
/**
 * The file bytes kept parsed, over every session (their entries take about 1.4 times that in memory). A session whose
 * kept part alone is bigger is read whole each time instead of kept, so no single transcript can sit in memory.
 */
const MAX_BYTES = 32 * 1024 * 1024;
/**
 * Over this size the SDK's own file reader reads a transcript from its last compaction on (and ours keeps only that):
 * what came before a compaction without kept messages is not part of the conversation it builds.
 */
export const SDK_SKIP_BYTES = 5 * 1024 * 1024;
/** The SDK finds a compaction by this marker near the start of a line (in its first 256 bytes). */
const BOUNDARY_MARKER = '"compact_boundary"';
const BOUNDARY_WITHIN = 256;
/** Lines the SDK's reader leaves out over `SDK_SKIP_BYTES`, but for the last one after the compaction. */
const SNAPSHOT = 'attribution-snapshot';

interface Cached {
  path: string;
  ino: number;
  size: number;
  mtimeMs: number;
  /** Where the last complete line ends: the next read starts here (a line still being written waits). */
  offset: number;
  /** The `TAIL` bytes before `offset`, to tell an append from a rewrite. */
  tail: Buffer;
  /** The complete lines kept: all of them, or (`trimmed`) those from the last compaction on, without snapshots. */
  entries: TranscriptEntry[];
  /** Where the kept lines start in the file (0: all of it). */
  keptFrom: number;
  trimmed: boolean;
  /** When trimmed: the last attribution snapshot since the compaction, which the SDK's reader adds at the end. */
  snapshot: TranscriptEntry | null;
  /** What the reader built, for as long as the file is unchanged. */
  messages: readonly RawSessionMessage[];
}

/** Builds the conversation from a file's entries: the SDK's `getSessionMessages` with a session store. */
export type BuildMessages = (entries: TranscriptEntry[]) => Promise<RawSessionMessage[]>;

export interface TranscriptCacheOptions {
  maxBytes?: number;
  /** Over this many bytes a file is kept from its last compaction on, as the SDK reads it (tests make it small). */
  skipBytes?: number;
}

/**
 * Parsed transcripts, shared by everything that reads them (the open transcript, search, catch-up, the phone), keyed
 * by session and checked against the file's size, time and inode on every read. A file that only grew has just its new
 * lines parsed; one that shrank, was replaced or changed before the last read offset is read whole again. Claude Code
 * only ever appends to a transcript (a rewind or a compaction adds lines too), so the append path is the usual one.
 *
 * The conversation is always built by the SDK's reader (through its session store) from the same lines its own file
 * reader would give it: the whole file, or over `SDK_SKIP_BYTES` the lines from the last compaction without kept
 * messages on, with only the last attribution snapshot, at the end. So how a transcript is read stays the SDK's, and a
 * big compacted transcript keeps only its latest part in memory. A last line without its newline yet is used as it
 * is when it is complete JSON, as the SDK's reader does, and read again with the next lines.
 *
 * Least recently read sessions go first past `maxBytes` of kept file.
 */
export class TranscriptCache {
  private readonly files = new Map<string, Cached>();
  /** One read at a time per session, so reads that come together share the work. */
  private readonly queues = new Map<string, Promise<unknown>>();
  private bytes = 0;
  private readonly maxBytes: number;
  private readonly skipBytes: number;
  /** Reads that parsed the whole file, only what was appended, or nothing (unchanged). */
  readonly stats = { full: 0, appended: 0, unchanged: 0 };

  constructor(options: TranscriptCacheOptions = {}) {
    this.maxBytes = options.maxBytes ?? MAX_BYTES;
    // The SDK reads big files whole when this is set; so does the cache.
    this.skipBytes = options.skipBytes ?? (process.env.CLAUDE_CODE_DISABLE_PRECOMPACT_SKIP ? Infinity : SDK_SKIP_BYTES);
  }

  /** The session's messages from the transcript at `path`. The array is frozen: it is shared. */
  read(sessionId: string, path: string, build: BuildMessages): Promise<readonly RawSessionMessage[]> {
    const run = (this.queues.get(sessionId) ?? Promise.resolve()).catch(() => {}).then(() => this.readNow(sessionId, path, build));
    this.queues.set(sessionId, run);
    void run
      .finally(() => {
        if (this.queues.get(sessionId) === run) this.queues.delete(sessionId);
      })
      .catch(() => {});
    return run;
  }

  /**
   * Every line of the session's file as last read, when all of them are kept (a compacted session's earlier parts are
   * read from them); null when only the latest part is kept, or nothing.
   */
  entries(sessionId: string, path: string): readonly TranscriptEntry[] | null {
    const cached = this.files.get(sessionId);
    return cached?.path === path && !cached.trimmed ? cached.entries : null;
  }

  private forget(sessionId: string): void {
    const cached = this.files.get(sessionId);
    if (!cached) return;
    this.files.delete(sessionId);
    this.bytes -= cached.offset - cached.keptFrom;
  }

  private async readNow(sessionId: string, path: string, build: BuildMessages): Promise<readonly RawSessionMessage[]> {
    const handle = await open(path, 'r');
    let next: Cached;
    let provisional: TranscriptEntry | null;
    try {
      // The size and time of the file this handle reads, even if the path is replaced meanwhile.
      const info = await handle.stat();
      const cached = this.files.get(sessionId);
      const same = cached && cached.path === path && cached.ino === info.ino;
      if (same && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
        this.stats.unchanged++;
        this.touch(sessionId, cached);
        return cached.messages;
      }
      const over = info.size > this.skipBytes;
      // A file that just grew past the limit is read whole once, to keep it as the SDK reads it from then on.
      const appended = same && !(over && !cached.trimmed) && info.size >= cached.offset && (await tailOf(handle, cached.offset)).equals(cached.tail);
      const start = appended ? cached.offset : 0;
      const buffer = Buffer.alloc(info.size - start);
      const { bytesRead } = buffer.length ? await handle.read(buffer, 0, buffer.length, start) : { bytesRead: 0 };
      const chunk = parseChunk(buffer.subarray(0, bytesRead));
      provisional = chunk.provisional;
      const offset = start + chunk.end;
      const kept = over ? keepAsSdk(appended ? cached : null, chunk, start) : { entries: appended ? cached.entries.concat(chunk.entries) : chunk.entries, keptFrom: 0, trimmed: false, snapshot: null };
      next = { path, ino: info.ino, size: info.size, mtimeMs: info.mtimeMs, offset, tail: appended && offset === start ? cached.tail : await tailOf(handle, offset), ...kept, messages: [] };
      if (appended) this.stats.appended++;
      else this.stats.full++;
    } finally {
      await handle.close();
    }
    // As the SDK's reader orders them: the lines, the unfinished last one, then (trimmed) the last snapshot.
    const lastIsSnapshot = next.trimmed && provisional?.type === SNAPSHOT;
    const snapshot = lastIsSnapshot ? provisional : next.snapshot;
    const input = [...next.entries, ...(provisional && !lastIsSnapshot ? [provisional] : []), ...(snapshot ? [snapshot] : [])];
    next.messages = Object.freeze(await build(input));
    this.forget(sessionId);
    // A transcript whose kept part alone is over the budget is not kept: the next read reads it again.
    if (next.offset - next.keptFrom <= this.maxBytes) {
      this.files.set(sessionId, next);
      this.bytes += next.offset - next.keptFrom;
      this.evict(sessionId);
    }
    return next.messages;
  }

  private touch(sessionId: string, cached: Cached): void {
    this.files.delete(sessionId);
    this.files.set(sessionId, cached);
  }

  /** Drops the least recently read sessions past the budget; the one just read stays. */
  private evict(keep: string): void {
    for (const id of this.files.keys()) {
      if (this.bytes <= this.maxBytes) break;
      if (id !== keep) this.forget(id);
    }
  }
}

/** A compaction that kept no messages, which the SDK's reader starts a big file from: its line and where it starts. */
interface Boundary {
  index: number;
  at: number;
}

interface Chunk {
  entries: TranscriptEntry[];
  /** Compactions (as the SDK's file reader tells them) among `entries`, with their byte offset in the chunk. */
  boundaries: Boundary[];
  /** Where the last complete line ends. */
  end: number;
  /** The last line, without its newline yet, when it is complete JSON. */
  provisional: TranscriptEntry | null;
}



function asEntry(line: string): TranscriptEntry | null {
  try {
    const entry = JSON.parse(line) as unknown;
    return entry && typeof entry === 'object' && typeof (entry as TranscriptEntry).type === 'string' ? (entry as TranscriptEntry) : null;
  } catch {
    return null;
  }
}

/** Whether a line is a compaction the SDK's reader starts from: found as it finds it, and keeping no messages. */
function isBoundaryLine(line: string, entry: TranscriptEntry): boolean {
  const marker = line.indexOf(BOUNDARY_MARKER);
  if (marker === -1 || marker >= BOUNDARY_WITHIN || entry.type !== 'system' || entry.subtype !== 'compact_boundary') return false;
  const metadata = entry.compactMetadata as { preservedSegment?: unknown; preservedMessages?: unknown } | undefined;
  return !metadata?.preservedSegment && !metadata?.preservedMessages;
}


/**
 * What the SDK's file reader reads of a file over `SDK_SKIP_BYTES`: the lines from the last compaction that kept no
 * messages on, without attribution snapshots but the last one (put at the end). `before`: what was kept of the file
 * up to `start`, already this way; `chunk`: the lines after it.
 */
function keepAsSdk(before: Cached | null, chunk: Chunk, start: number): Pick<Cached, 'entries' | 'keptFrom' | 'trimmed' | 'snapshot'> {
  const last = chunk.boundaries.at(-1);
  let entries = last ? [] : (before?.entries ?? []);
  let snapshot = last ? null : (before?.snapshot ?? null);
  const keptFrom = last ? start + last.at : (before?.keptFrom ?? 0);
  const fresh: TranscriptEntry[] = [];
  for (const entry of last ? chunk.entries.slice(last.index) : chunk.entries) {
    if (entry.type === SNAPSHOT) snapshot = entry;
    else fresh.push(entry);
  }
  entries = entries.concat(fresh);
  return { entries, keptFrom, trimmed: true, snapshot };
}

/** A transcript's bytes as entries; a line that isn't valid JSON (a damaged one) is skipped, as the SDK's reader does. */
export function parseChunk(buffer: Buffer): Chunk {
  const entries: TranscriptEntry[] = [];
  const boundaries: Boundary[] = [];
  let from = 0;
  let newline = buffer.indexOf(10, from);
  while (newline !== -1) {
    const line = buffer.toString('utf8', from, newline);
    if (line.trim()) {
      const entry = asEntry(line);
      if (entry) {
        if (isBoundaryLine(line, entry)) boundaries.push({ index: entries.length, at: from });
        entries.push(entry);
      }
    }
    from = newline + 1;
    newline = buffer.indexOf(10, from);
  }
  const rest = from < buffer.length ? buffer.toString('utf8', from) : '';
  return { entries, boundaries, end: from, provisional: rest.trim() ? asEntry(rest) : null };
}

/** A transcript's lines as entries (all complete lines of `text`). */
export function parseLines(text: string): TranscriptEntry[] {
  return parseChunk(Buffer.from(text.endsWith('\n') ? text : `${text}\n`)).entries;
}

async function tailOf(handle: Awaited<ReturnType<typeof open>>, offset: number): Promise<Buffer> {
  const tail = Buffer.alloc(Math.min(TAIL, offset));
  const { bytesRead } = await handle.read(tail, 0, tail.length, offset - tail.length);
  return tail.subarray(0, bytesRead);
}
