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

/**
 * The pids that have each of `files` open (real paths, symlinks followed, as the system names them). Rejects when it
 * couldn't find out this time (`lsof` failed or was too slow).
 */
export type LockHolders = (files: readonly string[]) => Promise<Map<string, number[]>>;

/**
 * `lsof -F pn` output: a `p<pid>` line for each process, then an `n<name>` line for each of its files asked about
 * (with `f<fd>` lines between, which don't matter here).
 */
export function parseLsof(output: string): Map<string, number[]> {
  const holders = new Map<string, number[]>();
  let pid: number | null = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1)) || null;
    else if (line.startsWith('n') && pid !== null) addHolder(holders, line.slice(1), pid);
  }
  return holders;
}

const addHolder = (holders: Map<string, number[]>, file: string, pid: number) => {
  const pids = holders.get(file) ?? [];
  if (!pids.includes(pid)) pids.push(pid);
  holders.set(file, pids);
};

/** Linux's `st_dev` → the `major:minor` `/proc/locks` prints (in hex there), as the kernel encodes it for `stat`. */
export const deviceNumbers = (dev: number) => `${(dev >>> 8) & 0xfff}:${(dev & 0xff) | ((dev >>> 12) & 0xfff00)}`;

/**
 * Linux's `/proc/locks`: one line per lock, `1: FLOCK  ADVISORY  WRITE 1234 08:01:5678 0 EOF`, with the holder's pid
 * and the file as `major:minor:inode` (device numbers in hex). `files` maps `major:minor:inode` (decimal) to the file.
 */
export function parseProcLocks(text: string, files: ReadonlyMap<string, string>): Map<string, number[]> {
  const holders = new Map<string, number[]>();
  for (const line of text.split('\n')) {
    const match = /^\d+:\s+(?:->\s+)?\S+\s+\S+\s+\S+\s+(\d+)\s+([0-9a-f]+):([0-9a-f]+):(\d+)\s/i.exec(line);
    if (!match) continue;
    const file = files.get(`${parseInt(match[2]!, 16)}:${parseInt(match[3]!, 16)}:${match[4]}`);
    if (file) addHolder(holders, file, Number(match[1]));
  }
  return holders;
}

const LSOF_TIMEOUT_MS = 5_000;

/**
 * The system's answer: `lsof` on macOS (and Linux when it's there; it exits with 1 when one of the files isn't open),
 * else `/proc/locks` on Linux. Null on Windows, which has no cheap way to name the process behind a lock.
 */
export function systemLockHolders(platform: NodeJS.Platform = process.platform): LockHolders | null {
  if (platform === 'win32') return null;
  const lsof = platform === 'darwin' ? '/usr/sbin/lsof' : 'lsof';
  return (files) =>
    new Promise((resolve, reject) => {
      if (!files.length) return resolve(new Map());
      execFile(lsof, ['-n', '-P', '-F', 'pn', '--', ...files], { timeout: LSOF_TIMEOUT_MS }, (error, stdout) => {
        if (!error || (error as { code?: unknown }).code === 1) return resolve(parseLsof(stdout));
        if (platform !== 'linux') return reject(error);
        try {
          const keys = new Map(
            files.flatMap((file) => {
              const stat = statSync(file, { throwIfNoEntry: false });
              return stat ? [[`${deviceNumbers(stat.dev)}:${stat.ino}`, file] as const] : [];
            }),
          );
          resolve(parseProcLocks(readFileSync('/proc/locks', 'utf8'), keys));
        } catch (procError) {
          reject(procError);
        }
      });
    });
}

/** How long an answer is kept while the lock files stay the same: a stale one would otherwise be asked about forever. */
export const LOCKS_TTL_MS = 20_000;

export interface CodexLocks {
  /**
   * The threads among `threadIds` that a Codex process other than Seshboard's own (`ownPids`, its app-servers) has
   * open right now: a Codex CLI in a terminal, the Codex app, another editor. Threads Seshboard has loaded itself
   * (`ownThreads`) are skipped: Codex's lock is exclusive, so nobody else can have them.
   */
  openThreads(threadIds: readonly string[], ownPids: ReadonlySet<number>, ownThreads?: ReadonlySet<string>): Promise<Set<string>>;
}

/**
 * Who has a profile's threads open, asked of the system only when it may have changed: the engine asks every few
 * seconds, and `lsof` takes a fraction of one. The answer is kept while the lock files asked about stay the same (the
 * same files, created at the same time) for up to `LOCKS_TTL_MS`. When the system can't say this time, the last
 * answer stands (none before the first: not open), so a slow `lsof` never takes a stale lock file as a session open
 * elsewhere. Where the system can't name the holder at all (Windows), a lock file is taken as open: a file a killed
 * Codex left behind then counts until Codex clears it.
 */
export function codexLocks(codexHome: string, options: { holders?: LockHolders | null; now?: () => number } = {}): CodexLocks {
  const holders = options.holders === undefined ? systemLockHolders() : options.holders;
  const now = options.now ?? Date.now;
  let last: { key: string; at: number; holders: Map<string, number[]> } | null = null;
  let known = new Map<string, number[]>();
  /** The question being asked now: a second caller with the same files waits for it instead of asking again. */
  let asking: { key: string; answer: Promise<Map<string, number[]>> } | null = null;
  return {
    async openThreads(threadIds, ownPids, ownThreads) {
      const files = new Map<string, { threadId: string; stamp: string }>();
      for (const threadId of threadIds) {
        if (ownThreads?.has(threadId)) continue;
        try {
          // By its real path, as `lsof` names it (macOS's temp folders are behind `/var` → `/private/var`).
          const file = realpathSync(lockFile(codexHome, threadId));
          const stat = statSync(file);
          files.set(file, { threadId, stamp: `${file}:${stat.ino}:${stat.mtimeMs}` });
        } catch {
          // No lock file: nobody has it open.
        }
      }
      if (!files.size) return new Set();
      if (!holders) return new Set([...files.values()].map((f) => f.threadId));
      const key = [...files.values()].map((f) => f.stamp).sort().join('\n');
      let answer: Map<string, number[]>;
      if (last && last.key === key && now() - last.at < LOCKS_TTL_MS) {
        answer = last.holders;
      } else if (asking?.key === key) {
        answer = await asking.answer;
      } else {
        const question = {
          key,
          answer: holders([...files.keys()]).then(
            (got) => (known = got),
            () => known,
          ),
        };
        asking = question;
        answer = await question.answer;
        if (asking === question) asking = null;
        last = { key, at: now(), holders: answer };
      }
      const open = new Set<string>();
      for (const [file, { threadId }] of files) {
        if ((answer.get(file) ?? []).some((pid) => !ownPids.has(pid))) open.add(threadId);
      }
      return open;
    },
  };
}
