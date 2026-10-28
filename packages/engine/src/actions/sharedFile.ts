import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { RpcError } from '@seshboard/protocol';

/** The project's shared settings, committed with the repository: actions, prompts and the icon. */
export const SHARED_FILE = '.seshboard.json';
/**
 * Its name from before the rename. A project that has it keeps it (teammates on older versions read only that one):
 * it is read and written where it is, and a new file gets the new name.
 */
export const LEGACY_SHARED_FILE = '.switchboard.json';

/** The project's shared file: `.seshboard.json`, or `.switchboard.json` when only that one is there. */
export function sharedFilePath(projectRoot: string): string {
  const file = join(projectRoot, SHARED_FILE);
  if (existsSync(file)) return file;
  const legacy = join(projectRoot, LEGACY_SHARED_FILE);
  return existsSync(legacy) ? legacy : file;
}

/** Whether a file name is the shared file's, by either name. */
export const isSharedFileName = (name: string) => name === SHARED_FILE || name === LEGACY_SHARED_FILE;

/**
 * The entries of one list in the file (`actions`, `prompts`). The file is hand-written, so entries are loose records
 * checked one by one by whoever reads them, and a list that is missing is empty. Null when the key holds something else.
 */
export function entriesOf(data: Record<string, unknown> | null, key: string): Array<Record<string, unknown>> | null {
  const list = z.array(z.record(z.string(), z.unknown())).default([]).safeParse(data?.[key]);
  return list.success ? list.data : null;
}

export interface SharedFileRead {
  /** Where the file is (or would be). */
  file: string;
  /** The file as written, null when there is none or it doesn't read. */
  data: Record<string, unknown> | null;
  /** Why it doesn't read (not JSON, or not an object). */
  error: string | null;
  /** When it last changed (0 without a file). */
  mtime: number;
}

/** Reads the project's shared file. A missing file is no error; one that doesn't read says why. */
export function readSharedFile(projectRoot: string): SharedFileRead {
  const file = sharedFilePath(projectRoot);
  const name = basename(file);
  if (!existsSync(file)) return { file, data: null, error: null, mtime: 0 };
  let raw: unknown;
  let mtime = 0;
  try {
    mtime = statSync(file).mtimeMs;
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { file, data: null, error: `${name}: ${(error as Error).message}`, mtime };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { file, data: null, error: `${name}: expected { "actions": [...] }`, mtime };
  return { file, data: raw as Record<string, unknown>, error: null, mtime };
}

/** The indent the file uses (two spaces when it can't tell), so a write doesn't reformat it. */
function indentOf(text: string): string {
  const match = /\n([ \t]+)"/.exec(text);
  return match ? match[1]! : '  ';
}

/**
 * Changes the project's shared file: `change` gets what it holds (an empty object when there is no file yet) and
 * returns what it should hold. Keys keep their order, keys Seshboard doesn't know stay, and the indent stays, so a
 * commit shows only what changed. Written to a file next to it, then moved over it, so it is never half written.
 * Refuses (WRITE_FAILED, with the reason) a file that doesn't read, rather than overwrite what someone wrote.
 */
export function writeSharedFile(projectRoot: string, change: (data: Record<string, unknown>) => Record<string, unknown>): void {
  const read = readSharedFile(projectRoot);
  const name = basename(read.file);
  if (read.error) throw new RpcError('WRITE_FAILED', `The project's ${name} can't be read, so Seshboard won't overwrite it. Fix it first. (${read.error.replace(`${name}: `, '')})`);
  let indent = '  ';
  let finalNewline = true;
  if (read.data) {
    const text = readFileSync(read.file, 'utf8');
    indent = indentOf(text);
    finalNewline = text.endsWith('\n');
  }
  const next = change(read.data ?? {});
  const body = `${JSON.stringify(next, null, indent)}${finalNewline ? '\n' : ''}`;
  const temp = `${read.file}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, body);
    renameSync(temp, read.file);
  } catch (error) {
    try {
      if (existsSync(temp)) unlinkSync(temp);
    } catch {
      // Left behind; the next write replaces it.
    }
    const code = (error as NodeJS.ErrnoException).code;
    const why = code === 'EACCES' || code === 'EPERM' ? "you don't have permission to change it" : code === 'EROFS' ? 'the folder is read-only' : code === 'ENOENT' ? 'the project folder is gone' : (error as Error).message;
    throw new RpcError('WRITE_FAILED', `The project's ${name} can't be written: ${why}.`);
  }
}

/**
 * Puts `entry` in the list under `key`, replacing the one with the same id (keeping its place and the keys it has that
 * `entry` doesn't), or adds it at the end. `order` comes first in each entry, then the rest as they were.
 */
export function upsertEntry(data: Record<string, unknown>, key: string, entry: Record<string, unknown> & { id: string }, order: readonly string[], idOf: (raw: Record<string, unknown>, index: number) => string): Record<string, unknown> {
  const list = Array.isArray(data[key]) ? (data[key] as unknown[]) : [];
  let found = false;
  const nextList = list.map((raw, i) => {
    if (!isRecord(raw) || idOf(raw, i) !== entry.id) return raw;
    found = true;
    return ordered({ ...raw, ...entry }, order);
  });
  if (!found) nextList.push(ordered(entry, order));
  // A key that is there keeps its place; a new one goes at the end.
  return { ...data, [key]: nextList };
}

/** Takes the entry with this id out of the list under `key`; the key goes too when its list is left empty. */
export function removeEntry(data: Record<string, unknown>, key: string, id: string, idOf: (raw: Record<string, unknown>, index: number) => string): Record<string, unknown> {
  const list = Array.isArray(data[key]) ? (data[key] as unknown[]) : [];
  const nextList = list.filter((raw, i) => !isRecord(raw) || idOf(raw, i) !== id);
  if (nextList.length === 0) {
    const { [key]: _gone, ...rest } = data;
    return rest;
  }
  return { ...data, [key]: nextList };
}

/** The same object with the keys in `order` first. */
function ordered(entry: Record<string, unknown>, order: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of order) if (key in entry && entry[key] !== undefined) out[key] = entry[key];
  for (const [key, value] of Object.entries(entry)) if (!(key in out) && value !== undefined) out[key] = value;
  return out;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
