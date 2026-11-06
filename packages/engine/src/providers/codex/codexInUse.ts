import { execFile } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * How Codex marks a thread a process has open (codex-rs/rollout/src/writer_lock.rs, 0.167): an empty file
 * `<CODEX_HOME>/thread-writer-locks/<threadId>.lock`, held with an exclusive OS lock (`flock` on macOS and Linux,
 * `LockFileEx` on Windows) from `thread/start` or `thread/resume` until the thread unloads: 60 s after its last
 * subscriber leaves (`thread_unload_delay_secs`), or when the process ends. A process that ends cleanly deletes the
 * file; one that is killed leaves it behind, unlocked, until the next Codex to take a lock in that folder clears it. The
 * file holds no pid, so who holds it is asked of the system: the process that has it open.
 */
export const LOCK_DIR = 'thread-writer-locks';

export const lockFile = (codexHome: string, threadId: string) => join(codexHome, LOCK_DIR, `${threadId}.lock`);

/** The pids that have each of `files` open (real paths, symlinks followed, as the system names them); null when this system can't tell. */
export type LockHolders = (files: readonly string[]) => Promise<Map<string, number[]> | null>;

/**
 * `lsof -F pn` output: a `p<pid>` line for each process, then an `n<name>` line for each of its files asked about
 * (with `f<fd>` lines between, which don't matter here).
 */
export function parseLsof(output: string): Map<string, number[]> {
  const holders = new Map<string, number[]>();
  let pid: number | null = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1)) || null;
    else if (line.startsWith('n') && pid !== null) {
      const name = line.slice(1);
      const pids = holders.get(name) ?? [];
      if (!pids.includes(pid)) pids.push(pid);
      holders.set(name, pids);
    }
  }
  return holders;
}

/**
 * Linux's `/proc/locks`: one line per lock, `1: FLOCK  ADVISORY  WRITE 1234 08:01:5678 0 EOF`, with the holder's pid
 * and the file as `major:minor:inode`. Matched by inode (`inodes`: inode → file): Codex's lock folder is on one device.
 */
export function parseProcLocks(text: string, inodes: ReadonlyMap<number, string>): Map<string, number[]> {
  const holders = new Map<string, number[]>();
  for (const line of text.split('\n')) {
    const match = /^\d+:\s+(?:->\s+)?\S+\s+\S+\s+\S+\s+(\d+)\s+[0-9a-f]+:[0-9a-f]+:(\d+)\s/i.exec(line);
    if (!match) continue;
    const file = inodes.get(Number(match[2]));
    if (!file) continue;
    const pid = Number(match[1]);
    const pids = holders.get(file) ?? [];
    if (!pids.includes(pid)) pids.push(pid);
    holders.set(file, pids);
  }
  return holders;
}

const LSOF_TIMEOUT_MS = 10_000;

/**
 * The system's answer: `lsof` on macOS (and Linux when it's there; it exits with 1 when nobody has the files open),
 * else `/proc/locks` on Linux. Windows has no cheap way to name the process behind a lock: null.
 */
export function systemLockHolders(platform: NodeJS.Platform = process.platform): LockHolders {
  if (platform === 'win32') return async () => null;
  const lsof = platform === 'darwin' ? '/usr/sbin/lsof' : 'lsof';
  return (files) =>
    new Promise((resolve) => {
      if (!files.length) return resolve(new Map());
      execFile(lsof, ['-n', '-P', '-F', 'pn', '--', ...files], { timeout: LSOF_TIMEOUT_MS }, (error, stdout) => {
        // 1: one of the files isn't open; what it printed about the others still holds.
        if (!error || (error as { code?: unknown }).code === 1) return resolve(parseLsof(stdout));
        if (platform !== 'linux') return resolve(null);
        try {
          const inodes = new Map(files.flatMap((file) => {
            const stat = statSync(file, { throwIfNoEntry: false });
            return stat ? [[stat.ino, file] as const] : [];
          }));
          resolve(parseProcLocks(readFileSync('/proc/locks', 'utf8'), inodes));
        } catch {
          resolve(null);
        }
      });
    });
}

/**
 * The threads among `threadIds` that a Codex process other than Seshboard's own (`ownPids`, its app-servers) has open
 * right now: a Codex CLI in a terminal, the Codex app, another editor. Only the threads asked about are looked at.
 * Where the system can't name the holder (Windows), a lock file is taken as open unless the thread is one Seshboard
 * has loaded itself (`ownThreads`); a file a killed Codex left behind then counts as open until Codex clears it.
 */
export async function openThreads(
  codexHome: string,
  threadIds: readonly string[],
  ownPids: ReadonlySet<number>,
  options: { ownThreads?: ReadonlySet<string>; holders?: LockHolders } = {},
): Promise<Set<string>> {
  const files = new Map<string, string>();
  for (const threadId of threadIds) {
    try {
      // By its real path, as `lsof` names it (macOS's temp folders are behind `/var` → `/private/var`).
      files.set(realpathSync(lockFile(codexHome, threadId)), threadId);
    } catch {
      // No lock file: nobody has it open.
    }
  }
  if (!files.size) return new Set();
  const holders = await (options.holders ?? systemLockHolders())([...files.keys()]).catch(() => null);
  const open = new Set<string>();
  for (const [file, threadId] of files) {
    if (holders === null) {
      if (!options.ownThreads?.has(threadId)) open.add(threadId);
    } else if ((holders.get(file) ?? []).some((pid) => !ownPids.has(pid))) {
      open.add(threadId);
    }
  }
  return open;
}
