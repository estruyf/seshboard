import { readFileSync, writeFileSync } from 'node:fs';
import type { LiveSession } from '@seshboard/protocol';
import { isAlive } from '../claude/liveRegistry.ts';

/** A Claude Code process one of the engine's hosts runs, as the live registry lists it. */
interface HostProcess {
  pid: number;
  /** When it started (the registry's `startedAt`), so a pid the system handed to another process doesn't count. */
  startedAt: number | null;
  sessionId: string;
}

type Entry = Pick<LiveSession, 'pid' | 'startedAt' | 'sessionId'>;

const same = (a: Entry, b: Entry) => a.pid === b.pid && (a.startedAt !== null && b.startedAt !== null ? a.startedAt === b.startedAt : a.sessionId === b.sessionId);

function read(file: string): HostProcess[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((p: Partial<HostProcess>) =>
      typeof p?.pid === 'number' && typeof p.sessionId === 'string' ? [{ pid: p.pid, startedAt: typeof p.startedAt === 'number' ? p.startedAt : null, sessionId: p.sessionId }] : [],
    );
  } catch {
    return [];
  }
}

/**
 * The Claude Code processes the engine's hosts run, kept in a file for the engine that comes after this one. An engine
 * that ends without closing its hosts (killed, or crashed) leaves their processes behind: nothing can talk to them any
 * more, but they still hold their sessions in the registry, so those look open in another window. The next engine
 * finds them here as leftovers, and sending to such a session stops the leftover instead of forking the session.
 */
export class HostProcesses {
  /** Processes earlier engines left behind that are still running. */
  private leftovers: HostProcess[];
  private written: string;

  constructor(
    private readonly file: string,
    private readonly alive: (pid: number) => boolean = isAlive,
  ) {
    const recorded = read(file);
    this.written = JSON.stringify(recorded);
    this.leftovers = recorded.filter((p) => alive(p.pid));
  }

  /** Whether a registry entry is a process an earlier engine left behind. */
  isLeftover(entry: Entry): boolean {
    return this.leftovers.some((p) => same(p, entry));
  }

  /** Records the processes this engine's hosts run now (`own`), and forgets leftovers that have ended. */
  record(live: readonly LiveSession[], own: (sessionId: string) => boolean): void {
    this.leftovers = this.leftovers.filter((p) => this.alive(p.pid));
    const current = live.filter((l) => own(l.sessionId) && !this.isLeftover(l)).map((l) => ({ pid: l.pid, startedAt: l.startedAt, sessionId: l.sessionId }));
    const json = JSON.stringify([...this.leftovers, ...current]);
    if (json === this.written) return;
    this.written = json;
    try {
      writeFileSync(this.file, json);
    } catch {
      // The data folder is gone or read-only: only a crash's leftovers go unrecognised.
    }
  }
}
