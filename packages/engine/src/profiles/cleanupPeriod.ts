import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Claude Code's own clean-up: at startup it deletes transcripts that have been quiet for `cleanupPeriodDays` (30 when
 * the key is missing), in each config folder's `settings.json`. Switchboard shows it per profile and can change that
 * one key, leaving the rest of the file as it was.
 */
export const CLEANUP_KEY = 'cleanupPeriodDays';
/** What Claude Code uses when the key is missing. */
export const CLEANUP_DEFAULT_DAYS = 30;

export const settingsPathOf = (configDir: string) => join(configDir, 'settings.json');

/** The key's value in a settings file's text: a whole number of days, null when missing (or not a number). */
export function readCleanupPeriod(text: string | null): number | null {
  if (text === null || text.trim() === '') return null;
  const value = (JSON.parse(text) as Record<string, unknown> | null)?.[CLEANUP_KEY];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The indentation the file uses (its first indented line), two spaces when it has none. */
function indentOf(text: string): string {
  return /\n([ \t]+)\S/.exec(text)?.[1] ?? '  ';
}

const keyPattern = new RegExp(`("${CLEANUP_KEY}"\\s*:\\s*)(-?[0-9.eE+-]+|null|"[^"]*")`);

/**
 * The settings file's text with the key set to `days`, or without it for null (Claude Code's default). Edits the text
 * in place so the other keys, their order and the formatting stay; when that can't be done safely (an unusual layout),
 * writes the parsed file back as JSON in its own indentation instead.
 */
export function withCleanupPeriod(text: string | null, days: number | null): string {
  const source = text === null || text.trim() === '' ? '{}\n' : text;
  const parsed = JSON.parse(source) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('settings.json is not a JSON object');
  const wanted: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
  if (days === null) delete wanted[CLEANUP_KEY];
  else wanted[CLEANUP_KEY] = days;
  // The edit is kept only when it reads back as exactly the wanted settings (the new key may sit elsewhere).
  const same = (candidate: string) => {
    try {
      const read = JSON.parse(candidate) as Record<string, unknown>;
      const keys = Object.keys(read);
      return keys.length === Object.keys(wanted).length && keys.every((key) => key in wanted && JSON.stringify(read[key]) === JSON.stringify(wanted[key]));
    } catch {
      return false;
    }
  };
  const indent = indentOf(source);
  let edited: string;
  if (keyPattern.test(source)) {
    edited =
      days === null
        ? // The key's line, with the comma before or after it.
          source.replace(new RegExp(`,\\s*\\n?[ \\t]*"${CLEANUP_KEY}"\\s*:\\s*[^,}\\n]+`), '').replace(new RegExp(`[ \\t]*"${CLEANUP_KEY}"\\s*:\\s*[^,}\\n]+,?\\s*\\n?`), '')
        : source.replace(keyPattern, `$1${days}`);
  } else if (days === null) {
    edited = source;
  } else {
    const open = source.indexOf('{');
    const empty = /^\{\s*\}/.test(source.slice(open));
    edited = empty
      ? `${source.slice(0, open)}{\n${indent}"${CLEANUP_KEY}": ${days}\n}${source.slice(source.indexOf('}', open) + 1)}`
      : // Added as the first key, so no comma has to move.
        `${source.slice(0, open + 1)}\n${indent}"${CLEANUP_KEY}": ${days},${source.slice(open + 1).replace(/^[ \t]*\n?/, '\n')}`;
  }
  if (same(edited)) return edited.endsWith('\n') ? edited : `${edited}\n`;
  // Order and values are kept by the object itself; only the layout is lost.
  return `${JSON.stringify(wanted, null, indent)}\n`;
}

/** What a profile's settings file says about Claude Code's clean-up. */
export interface CleanupPeriod {
  settingsPath: string;
  /** Null when the key is missing: Claude Code uses 30 days. */
  days: number | null;
  /** The file couldn't be read as JSON; nothing is ever written to it then. */
  error: string | null;
}

export function readProfileCleanup(configDir: string): CleanupPeriod {
  const settingsPath = settingsPathOf(configDir);
  try {
    const text = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : null;
    return { settingsPath, days: readCleanupPeriod(text), error: null };
  } catch (error) {
    return { settingsPath, days: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Sets (or, with null, removes) the key in a profile's settings file, keeping everything else. */
export function writeProfileCleanup(configDir: string, days: number | null): void {
  const settingsPath = settingsPathOf(configDir);
  const text = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : null;
  // Missing and staying missing: no file to create.
  if (text === null && days === null) return;
  const next = withCleanupPeriod(text, days);
  mkdirSync(dirname(settingsPath), { recursive: true });
  // Written in place rather than renamed over: settings.json is often a link into a dotfiles repository.
  writeFileSync(settingsPath, next);
}
