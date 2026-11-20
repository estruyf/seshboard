import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderFiles } from '../provider.ts';

/** Where Codex CLI writes its sessions' rollout files, by day: `sessions/YYYY/MM/DD/`. */
export const codexSessionsDir = (codexHomeDir: string) => join(codexHomeDir, 'sessions');

/** Where Codex CLI moves the rollout files of the threads it archives (flat). */
export const codexArchiveDir = (codexHomeDir: string) => join(codexHomeDir, 'archived_sessions');

export const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A rollout file: `rollout-<timestamp>-<thread id>.jsonl`, or `.jsonl.zst` once Codex compressed it. The id is the
 * thread's (a UUIDv7). The timestamp is matched loosely: only the id is read from it.
 */
export const ROLLOUT_FILE = /^rollout-[0-9A-Za-z.-]+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl(?:\.zst)?$/i;

/** A rollout file's path relative to `sessions/`, with either separator (the watcher's on Windows has `\`). */
const DAY_FILE = /^(\d{4})[\\/](\d{2})[\\/](\d{2})[\\/]([^\\/]+)$/;

const YEAR = /^\d{4}$/;
const TWO_DIGITS = /^\d{2}$/;

const names = (dir: string, pattern: RegExp): string[] => {
  try {
    return readdirSync(dir).filter((name) => pattern.test(name));
  } catch {
    return [];
  }
};

/** The other spelling of a rollout file: compressed or not. */
const sibling = (path: string) => (path.endsWith('.zst') ? path.slice(0, -'.zst'.length) : `${path}.zst`);

/**
 * Codex's rollout files under `sessions/`, for the session index. A thread's file is found by its name; a subagent's
 * rollout is in the same folders, and the source leaves it out when the index asks about it.
 */
export function codexRolloutFiles(sessionsDir: string): ProviderFiles {
  return {
    sessionOf(relativePath) {
      const day = DAY_FILE.exec(relativePath);
      const match = day && ROLLOUT_FILE.exec(day[4]!);
      if (!day || !match) return null;
      const file = join(sessionsDir, day[1]!, day[2]!, day[3]!, day[4]!);
      // Compressing a rollout writes the `.zst` and removes the `.jsonl`: the session stands for whichever is there now.
      return { sessionId: match[1]!.toLowerCase(), file: existsSync(file) || !existsSync(sibling(file)) ? file : sibling(file) };
    },
    files() {
      const files = new Map<string, string>();
      for (const year of names(sessionsDir, YEAR)) {
        for (const month of names(join(sessionsDir, year), TWO_DIGITS)) {
          for (const day of names(join(sessionsDir, year, month), TWO_DIGITS)) {
            for (const name of names(join(sessionsDir, year, month, day), ROLLOUT_FILE)) {
              const id = ROLLOUT_FILE.exec(name)![1]!.toLowerCase();
              // Both spellings for a moment while Codex compresses one: the plain file is the one still written.
              if (!files.has(id) || !name.endsWith('.zst')) files.set(id, join(sessionsDir, year, month, day, name));
            }
          }
        }
      }
      return files;
    },
  };
}

/**
 * Every rollout file of one thread: in `sessions/YYYY/MM/DD/` (either spelling) or in `archived_sessions/`. Only real
 * files, by their names; nothing else in Codex's folder.
 */
export function codexRolloutsOf(codexHomeDir: string, threadId: string): string[] {
  if (!THREAD_ID.test(threadId)) return [];
  const id = threadId.toLowerCase();
  const sessions = codexSessionsDir(codexHomeDir);
  const found: string[] = [];
  const add = (dir: string) => {
    for (const name of names(dir, ROLLOUT_FILE)) {
      const path = join(dir, name);
      if (ROLLOUT_FILE.exec(name)![1]!.toLowerCase() === id && lstatSync(path, { throwIfNoEntry: false })?.isFile()) found.push(path);
    }
  };
  for (const year of names(sessions, YEAR)) {
    for (const month of names(join(sessions, year), TWO_DIGITS)) {
      for (const day of names(join(sessions, year, month), TWO_DIGITS)) add(join(sessions, year, month, day));
    }
  }
  add(codexArchiveDir(codexHomeDir));
  return found;
}
