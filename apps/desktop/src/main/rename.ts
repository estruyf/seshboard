import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What carries over from before the app was renamed from Switchboard to Seshboard: its environment variables and its
 * data folder. Plain Node, so the tests run without Electron.
 */

const LEGACY_ENV_PREFIX = 'SWITCHBOARD_';
const ENV_PREFIX = 'SESHBOARD_';

/**
 * Copies every `SWITCHBOARD_…` variable to its `SESHBOARD_…` name when that one isn't set, so a script or a launcher
 * written before the rename (`SWITCHBOARD_DATA_DIR`, `SWITCHBOARD_DISABLE_AUTO_UPDATE`) still works. The engine
 * inherits them. Returns the names it copied.
 */
export function adoptLegacyEnv(env: Record<string, string | undefined>): string[] {
  const copied: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(LEGACY_ENV_PREFIX) || value === undefined) continue;
    const next = ENV_PREFIX + name.slice(LEGACY_ENV_PREFIX.length);
    if (env[next] !== undefined) continue;
    env[next] = value;
    copied.push(next);
  }
  return copied;
}

/** The files a data folder in use has: a folder with neither is new (or one Chromium made before the move). */
const IN_USE = ['preferences.json', 'cache.sqlite'];
const inUse = (dir: string) => IN_USE.some((name) => existsSync(join(dir, name)));

/**
 * The data folder to use, given the one the new name gives (`…/Seshboard`) and the one from before the rename
 * (`…/Switchboard`). The old folder moves to the new name the first time; its data, the keys Windows encrypts with
 * and the single-instance lock come along. When it can't move (a file in it is open, as Windows refuses), or the new
 * folder already exists without data in it, the old folder stays in use where it is. Never deletes anything.
 */
export function legacyDataFolder(next: string, legacy: string, rename: (from: string, to: string) => void = renameSync): string {
  if (!existsSync(legacy) || !inUse(legacy)) return next;
  if (existsSync(next)) return inUse(next) ? next : legacy;
  try {
    rename(legacy, next);
    return next;
  } catch {
    return legacy;
  }
}
