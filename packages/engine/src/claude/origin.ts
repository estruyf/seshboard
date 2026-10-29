import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import type { SessionOrigin } from '@seshboard/protocol';

/** Maps Claude Code's `entrypoint` value to a coarse origin for badges. */
export function originFromEntrypoint(entrypoint: string | null | undefined): SessionOrigin {
  if (!entrypoint) return 'unknown';
  if (entrypoint === 'switchboard') return 'app';
  if (entrypoint === 'cli') return 'cli';
  if (entrypoint.startsWith('claude-desktop')) return 'desktop';
  if (entrypoint.startsWith('sdk')) return 'sdk';
  if (/vscode|jetbrains|cursor|windsurf|zed|ide/.test(entrypoint)) return 'ide';
  return 'unknown';
}

const HEAD_CHUNK = 64 * 1024;
/** Images pasted into the first prompt can make its record megabytes long; give up past this. */
const HEAD_MAX = 32 * 1024 * 1024;

export interface TranscriptHead {
  entrypoint: string | null;
  cwd: string | null;
}

/**
 * Reads the `entrypoint` and `cwd` recorded in a transcript's first records.
 * Claude Code writes them after the message, so a first prompt with a pasted
 * image pushes them past the 64 KB the SDK's `listSessions` looks at (it then
 * reports no `cwd`). This reads whole lines until it has both, in chunks, so it
 * stays cheap for ordinary transcripts.
 */
export function readHead(path: string): TranscriptHead {
  const head: TranscriptHead = { entrypoint: null, cwd: null };
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const decoder = new StringDecoder('utf8');
    const buffer = Buffer.alloc(HEAD_CHUNK);
    let pending = '';
    for (let offset = 0; offset < HEAD_MAX; ) {
      const bytes = readSync(fd, buffer, 0, HEAD_CHUNK, offset);
      if (bytes === 0) break;
      offset += bytes;
      const lines = (pending + decoder.write(buffer.subarray(0, bytes))).split('\n');
      pending = lines.pop()!;
      for (const line of lines) {
        if (!line.includes('"cwd"') && !line.includes('"entrypoint"')) continue;
        try {
          const record = JSON.parse(line) as { cwd?: unknown; entrypoint?: unknown };
          if (!head.cwd && typeof record.cwd === 'string' && record.cwd) head.cwd = record.cwd;
          if (!head.entrypoint && typeof record.entrypoint === 'string' && record.entrypoint) head.entrypoint = record.entrypoint;
        } catch {
          // A foreign or partial line; keep looking.
        }
        if (head.cwd && head.entrypoint) return head;
      }
    }
    return head;
  } catch {
    return head;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Records that are the conversation itself; their timestamps are real activity. */
const ACTIVITY_TYPES = new Set(['user', 'assistant', 'system']);
const TAIL_STEPS = [64 * 1024, 1024 * 1024];

/**
 * When the conversation last moved: the timestamp of the last message in the
 * transcript. The file's mtime is not that: Claude Code appends bookkeeping
 * (`last-prompt`, `cost-state`, titles) when a process exits or a session is
 * reopened, which would make old sessions look new. Reads only the tail, a
 * little more if the last records are huge. Null when nothing usable is found.
 */
export function readLastActivity(path: string): number | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    for (const step of TAIL_STEPS) {
      const length = Math.min(step, size);
      const buffer = Buffer.alloc(length);
      const bytes = readSync(fd, buffer, 0, length, size - length);
      const lines = buffer.toString('utf8', 0, bytes).split('\n');
      // The first line is cut off unless the whole file was read.
      const from = length === size ? 0 : 1;
      for (let i = lines.length - 1; i >= from; i--) {
        const line = lines[i]!;
        if (!line.includes('"timestamp"')) continue;
        try {
          const record = JSON.parse(line) as { type?: unknown; timestamp?: unknown };
          if (typeof record.type !== 'string' || !ACTIVITY_TYPES.has(record.type) || typeof record.timestamp !== 'string') continue;
          const at = Date.parse(record.timestamp);
          if (Number.isFinite(at)) return at;
        } catch {
          // A partial or foreign line; keep looking.
        }
      }
      if (length === size) break;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
