import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderFiles } from '../provider.ts';

/*
 * Where Antigravity CLI keeps a profile's sessions. Its `--gemini-dir` (`~/.gemini` by default) holds
 * `antigravity-cli/`, and in it, per conversation: `conversations/<id>.db` (its history, SQLite), `brain/<id>/` (its
 * scratch files and logs) and `annotations/<id>.pbtxt`. Seshboard reads none of the databases: the list and the
 * conversation come from `agy acp` (`agySource.ts`). It watches `brain/<id>/.system_generated/logs/transcript.jsonl`,
 * which Antigravity appends to on every step, to know when to ask again, and reads only the times of your prompts from it.
 */

/** Antigravity CLI's data folder inside a profile's `--gemini-dir`. */
export const agyDataDir = (geminiDir: string) => join(geminiDir, 'antigravity-cli');

/** Where each conversation's own folder is: the folder the session index watches. */
export const agyBrainDir = (geminiDir: string) => join(agyDataDir(geminiDir), 'brain');

export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The log Antigravity appends a step to as it works, relative to a conversation's folder in `brain/`. */
const LOG = ['.system_generated', 'logs', 'transcript.jsonl'] as const;

/** A conversation's log, as the watcher names it (relative to `brain/`, with either separator: `\` on Windows). */
const LOG_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[\\/]\.system_generated[\\/]logs[\\/]transcript\.jsonl$/i;

/** A conversation's step log. */
export const agyLogFile = (geminiDir: string, sessionId: string) => join(agyBrainDir(geminiDir), sessionId, ...LOG);

/** The file Antigravity CLI holds open while it has a conversation open (`presence/<id>.lock`). */
export const agyPresenceLock = (geminiDir: string, sessionId: string) => join(agyDataDir(geminiDir), 'presence', `${sessionId}.lock`);

/**
 * Antigravity's conversations for the session index: each one with a step log (one opened and left without a prompt
 * has none, and Antigravity doesn't list it either).
 */
export function agyFiles(geminiDir: string): ProviderFiles {
  const brain = agyBrainDir(geminiDir);
  return {
    sessionOf(relativePath) {
      const match = LOG_FILE.exec(relativePath);
      return match ? { sessionId: match[1]!.toLowerCase(), file: join(brain, match[1]!, ...LOG) } : null;
    },
    files() {
      const files = new Map<string, string>();
      let names: string[];
      try {
        names = readdirSync(brain);
      } catch {
        return files;
      }
      for (const name of names) {
        if (!SESSION_ID.test(name)) continue;
        const file = join(brain, name, ...LOG);
        if (lstatSync(file, { throwIfNoEntry: false })?.isFile()) files.set(name.toLowerCase(), file);
      }
      return files;
    },
  };
}

/**
 * What Delete moves to the Trash for a conversation: its history, its folder and its annotations, those that are there.
 * Moving them takes it out of Antigravity's own list (checked with agy 1.5.12: `session/list` leaves it out, and
 * `session/resume` says it can't read it). Only real files and folders, by their names.
 */
export function agyTrashPaths(geminiDir: string, sessionId: string): string[] {
  if (!SESSION_ID.test(sessionId)) return [];
  const data = agyDataDir(geminiDir);
  const paths = [join(data, 'conversations', `${sessionId}.db`), join(data, 'brain', sessionId), join(data, 'annotations', `${sessionId}.pbtxt`)];
  return paths.filter((path) => {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    return !!stat && !stat.isSymbolicLink() && (stat.isFile() || stat.isDirectory());
  });
}

/** What every user prompt step's line has, so other lines (tool output can be large) are never parsed. */
const USER_INPUT = '"USER_INPUT"';

/**
 * When each of your prompts was sent, in order, from the conversation's step log: ACP's replay has no times. Read
 * loosely: a log that can't be read, or a line of another shape, gives fewer times (the rest take the session's).
 */
export function agyPromptTimes(logFile: string): number[] {
  let text: string;
  try {
    text = readFileSync(logFile, 'utf8');
  } catch {
    return [];
  }
  const times: number[] = [];
  for (const line of text.split('\n')) {
    if (!line.includes(USER_INPUT)) continue;
    try {
      const step = JSON.parse(line) as { type?: unknown; created_at?: unknown };
      if (step.type !== 'USER_INPUT') continue;
      const at = typeof step.created_at === 'string' ? Date.parse(step.created_at) : NaN;
      if (Number.isFinite(at)) times.push(at);
    } catch {
      // A line cut short while Antigravity writes it.
    }
  }
  return times;
}
