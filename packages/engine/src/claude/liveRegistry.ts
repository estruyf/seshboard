import { readdirSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_PROFILE_ID, type LiveSession, type LiveStatus } from '@switchboard/protocol';
import { coalesce } from '../util/coalesce.ts';
import { originFromEntrypoint } from './origin.ts';

/**
 * Maps the registry's status to the three states the sidebar shows. The format
 * is undocumented: `busy`/`idle` are observed, the rest come from the CLI.
 */
export function normaliseStatus(raw: string): LiveStatus {
  const status = raw.toLowerCase();
  if (status === 'idle') return 'idle';
  if (/wait|requires|blocked|input|permission|approval/.test(status)) return 'needs-you';
  return 'running';
}

/** Whether a process is still running. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Parses one `~/.claude/sessions/<pid>.json` file. Returns null for anything unusable. */
export function parseRegistryEntry(json: unknown, resolveRoot: (cwd: string) => string | null, profileId = BUILTIN_PROFILE_ID): LiveSession | null {
  if (!json || typeof json !== 'object') return null;
  const r = json as Record<string, unknown>;
  const pid = num(r.pid);
  const sessionId = str(r.sessionId);
  if (pid === null || !sessionId) return null;
  const cwd = str(r.cwd);
  const rawStatus = str(r.status) ?? 'unknown';
  return {
    sessionId,
    pid,
    cwd,
    projectRoot: cwd ? resolveRoot(cwd) : null,
    status: normaliseStatus(rawStatus),
    rawStatus,
    name: str(r.name),
    origin: originFromEntrypoint(str(r.entrypoint)),
    startedAt: num(r.startedAt),
    updatedAt: num(r.statusUpdatedAt) ?? num(r.updatedAt),
    profileId,
  };
}

export interface LiveRegistryOptions {
  dir: string;
  /** The profile whose config folder `dir` is in. */
  profileId?: string;
  resolveRoot: (cwd: string) => string | null;
  onChange: (live: LiveSession[]) => void;
  /** Liveness re-check interval; registry files of crashed processes are never removed. */
  pollMs?: number;
  isAlive?: (pid: number) => boolean;
  /** Sessions to leave out, e.g. the engine's own short-lived helper processes. */
  ignore?: (sessionId: string) => boolean;
}

/** Tracks which Claude Code sessions are running right now, from the registry directory. */
export class LiveRegistry {
  private live: LiveSession[] = [];
  private signature = '';
  private watcher: FSWatcher | undefined;
  private poll: ReturnType<typeof setInterval> | undefined;
  private readonly rescan = coalesce(() => this.scan(), 50);

  constructor(private readonly options: LiveRegistryOptions) {}

  start(): void {
    this.scan();
    try {
      this.watcher = watch(this.options.dir, () => this.rescan.trigger());
      this.watcher.on('error', () => this.watcher?.close());
    } catch {
      // Directory missing (no session has run yet): polling still picks it up later.
    }
    this.poll = setInterval(() => this.scan(), this.options.pollMs ?? 2000);
    this.poll.unref?.();
  }

  list(): LiveSession[] {
    return this.live;
  }

  /** Re-reads every registry file. There are only a handful, so a full scan is cheapest. */
  scan(): void {
    const alive = this.options.isAlive ?? isAlive;
    const next: LiveSession[] = [];
    let files: string[] = [];
    try {
      files = readdirSync(this.options.dir).filter((f) => f.endsWith('.json'));
    } catch {
      files = [];
    }
    for (const file of files) {
      try {
        const entry = parseRegistryEntry(JSON.parse(readFileSync(join(this.options.dir, file), 'utf8')), this.options.resolveRoot, this.options.profileId);
        if (entry && alive(entry.pid) && !this.options.ignore?.(entry.sessionId)) next.push(entry);
      } catch {
        // Half-written or foreign file; the next scan will see the complete version.
      }
    }
    next.sort((a, b) => a.pid - b.pid);
    const signature = JSON.stringify(next);
    if (signature === this.signature) return;
    this.signature = signature;
    this.live = next;
    this.options.onChange(next);
  }

  stop(): void {
    this.rescan.stop();
    this.watcher?.close();
    if (this.poll) clearInterval(this.poll);
  }
}
