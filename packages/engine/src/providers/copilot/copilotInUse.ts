import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { LiveStatus } from '@seshboard/protocol';
import { parseEvents, type CopilotEvent } from './copilotEvents.ts';

/** `inuse.<pid>.lock`: Copilot's mark that a process has the session open, removed when it lets go. */
const LOCK = /^inuse\.(\d+)\.lock$/;

/** The processes that hold a session's locks (one may be gone: a crashed process leaves its lock behind). */
export function lockPids(sessionDir: string): number[] {
  try {
    return readdirSync(sessionDir).flatMap((name) => {
      const match = LOCK.exec(name);
      return match ? [Number(match[1])] : [];
    });
  } catch {
    return [];
  }
}

/** Whether a process is running (EPERM: it is, but belongs to someone else). */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Where a session open in Copilot is, from its last events on disk: working, waiting on a permission, or between turns.
 * Copilot doesn't write when it goes idle (`session.idle` is ephemeral): a model turn that ends on a reply without tool
 * calls is the end of its work, as are an abort, an error and a shutdown.
 */
export function liveStatusOf(events: readonly CopilotEvent[]): LiveStatus {
  const asked = new Set<string>();
  let status: LiveStatus = 'idle';
  /** The last reply asked for tools: the work goes on after its turn ends. */
  let toolsPending = false;
  for (const event of events) {
    const data = (event.data ?? {}) as Record<string, unknown>;
    // A subagent's own steps say nothing about the session's.
    if (typeof data.parentToolCallId === 'string') continue;
    switch (event.type) {
      case 'assistant.turn_start':
      case 'user.message':
        status = 'running';
        break;
      case 'assistant.message':
        toolsPending = Array.isArray(data.toolRequests) && data.toolRequests.length > 0;
        break;
      case 'assistant.turn_end':
        if (!toolsPending) {
          status = 'idle';
          asked.clear();
        }
        break;
      case 'session.idle':
      case 'assistant.idle':
      case 'abort':
      case 'session.error':
      case 'session.shutdown':
        status = 'idle';
        toolsPending = false;
        asked.clear();
        break;
      case 'permission.requested':
        if (typeof data.requestId === 'string') asked.add(data.requestId);
        break;
      case 'permission.completed':
        if (typeof data.requestId === 'string') asked.delete(data.requestId);
        break;
      default:
        break;
    }
  }
  return status === 'running' && asked.size ? 'needs-you' : status;
}

/** How much of the end of `events.jsonl` is read for the status. */
const TAIL_BYTES = 32 * 1024;

/** The session's last events (whole lines only), and when it last wrote. */
export function tailEvents(eventsFile: string): { events: CopilotEvent[]; updatedAt: number | null } {
  const stat = statSync(eventsFile, { throwIfNoEntry: false });
  if (!stat?.isFile()) return { events: [], updatedAt: null };
  const length = Math.min(stat.size, TAIL_BYTES);
  const fd = openSync(eventsFile, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, stat.size - length);
    const lines = buffer.subarray(0, read).toString('utf8').split('\n');
    if (stat.size > length) lines.shift();
    return { events: parseEvents(lines.join('\n')), updatedAt: Math.round(stat.mtimeMs) };
  } finally {
    closeSync(fd);
  }
}

/** A session open in Copilot's own app (Copilot CLI in a terminal), not through Seshboard. */
export interface CopilotLiveSession {
  sessionId: string;
  pid: number;
  status: LiveStatus;
  updatedAt: number | null;
}

/**
 * The sessions among `sessionIds` that a process other than Seshboard's own (`own`) has open right now. Only the
 * sessions asked about are looked at: a scan of every folder would read hundreds for the few that matter.
 */
export function openSessions(sessionsDir: string, sessionIds: readonly string[], own: ReadonlySet<number>, alive: (pid: number) => boolean = isAlive): CopilotLiveSession[] {
  return sessionIds.flatMap((sessionId) => {
    const dir = join(sessionsDir, sessionId);
    const pid = lockPids(dir).find((p) => !own.has(p) && alive(p));
    if (pid === undefined) return [];
    const { events, updatedAt } = tailEvents(join(dir, 'events.jsonl'));
    return [{ sessionId, pid, status: liveStatusOf(events), updatedAt }];
  });
}
