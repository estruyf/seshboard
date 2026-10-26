import { existsSync, lstatSync, readdirSync, readlinkSync, renameSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, join } from 'node:path';

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

/** Whether anything is at `path`, also a link to nothing (Chromium's `SingletonLock` points at `host-pid`). */
function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a copy of the app that is still running uses `dir`: Chromium's `SingletonLock` there names this computer and
 * a live process (macOS and Linux). On Windows that copy holds its files open, so moving them fails instead.
 */
export function heldByRunningApp(dir: string, host = hostname()): boolean {
  let target: string;
  try {
    target = readlinkSync(join(dir, 'SingletonLock'));
  } catch {
    return false;
  }
  const match = /^(.*)-(\d+)$/.exec(target);
  if (!match || match[1] !== host) return false;
  try {
    process.kill(Number(match[2]), 0);
    return true;
  } catch (error) {
    // EPERM: the process is there, it just isn't ours to signal.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Moves what `from` holds into `to`, leaving out names `to` has already. All or nothing: when one move fails, the
 * ones before it go back and the error is thrown.
 */
function moveContents(from: string, to: string, rename: (from: string, to: string) => void): void {
  const moved: string[] = [];
  try {
    for (const name of readdirSync(from)) {
      if (present(join(to, name))) continue;
      rename(join(from, name), join(to, name));
      moved.push(name);
    }
  } catch (error) {
    for (const name of moved.reverse()) {
      try {
        rename(join(to, name), join(from, name));
      } catch {
        // Left where it went; the data folder in use stays the old one, which still has preferences and the cache.
      }
    }
    throw error;
  }
}

/**
 * The data folder to use, given the one the new name gives (`…/Seshboard`) and the one from before the rename
 * (`…/Switchboard`). The first time, the old folder moves to the new name, or into the new folder when one without
 * data is there already (Chromium may make it before this runs), keeping what it holds; its data, the keys Windows
 * encrypts with and the single-instance lock come along. The old folder stays in use where it is when a running copy
 * of the app still uses it, or when it can't move (a file in it is open, as Windows refuses). Never deletes anything.
 */
export function legacyDataFolder(next: string, legacy: string, rename: (from: string, to: string) => void = renameSync): string {
  if (!existsSync(legacy) || !inUse(legacy)) return next;
  if (existsSync(next) && inUse(next)) return next;
  if (heldByRunningApp(legacy)) return legacy;
  try {
    if (existsSync(next)) moveContents(legacy, next, rename);
    else rename(legacy, next);
  } catch {
    return legacy;
  }
  try {
    writeFileSync(join(next, MOVED_MARKER), `${new Date().toISOString()}\n`);
  } catch {
    // Only the notice depends on it.
  }
  return next;
}

/** Left in a data folder that moved from the old name, so the app can say what changed (`cameFromSwitchboard`). */
const MOVED_MARKER = 'renamed-from-switchboard';

/**
 * Whether this data folder is the one Switchboard used: still under the old name (it couldn't move), or moved here.
 * The window then explains the rename once (the rename notice).
 */
export function cameFromSwitchboard(dataDir: string): boolean {
  return /^Switchboard( Dev)?$/.test(basename(dataDir)) || existsSync(join(dataDir, MOVED_MARKER));
}
