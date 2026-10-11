import { posix, win32 } from 'node:path';
import { APP_DATA_FOLDERS, COMPANION_DIR, COMPANION_INFO_FILE, COMPANION_PROTOCOL, type CompanionInfo } from '@switchboard/protocol/companion-client';

/**
 * Finding a running Switchboard: its engine writes `engine.json` (the socket and a token) in the app's data folder.
 * Pure apart from the reads it is given, so it can be tested.
 */

/**
 * Where Electron keeps an app's data folders: `~/Library/Application Support` on macOS, `%APPDATA%` on Windows,
 * `$XDG_CONFIG_HOME` (or `~/.config`) on Linux.
 */
function appDataRoot(home: string, platform: string, env: Record<string, string | undefined>): string {
  if (platform === 'win32') return env.APPDATA || win32.join(home, 'AppData', 'Roaming');
  if (platform === 'darwin') return `${home}/Library/Application Support`;
  return env.XDG_CONFIG_HOME || `${home}/.config`;
}

/**
 * A folder on this computer: absolute (a drive path on Windows) or under `~`. A network path (`\\server\share`) is
 * never read: Windows would sign in to that server to read it, and the file would choose where the extension connects.
 */
const isLocalFolder = (folder: string, platform: string) =>
  /^~(?=[\\/]|$)/.test(folder) || (platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(folder) : folder.startsWith('/') && !folder.startsWith('//'));

/**
 * The `engine.json` files to look at, in order: the folder from the settings, or the installed app, then a dev build.
 * A folder in the settings that isn't on this computer is ignored.
 */
export function infoFiles(home: string, appDataFolder: string, platform: string = process.platform, env: Record<string, string | undefined> = process.env): string[] {
  const { join } = platform === 'win32' ? win32 : posix;
  const custom = isLocalFolder(appDataFolder.trim(), platform) ? appDataFolder.trim() : '';
  const folders = custom ? [/^~(?=[\\/]|$)/.test(custom) ? join(home, custom.slice(1)) : custom] : APP_DATA_FOLDERS.map((name) => join(appDataRoot(home, platform, env), name));
  return folders.map((folder) => join(folder, COMPANION_DIR, COMPANION_INFO_FILE));
}

/**
 * A socket path a running engine writes: a Unix socket, or on Windows exactly the pipe name the engine makes
 * (`\\.\pipe\switchboard-` and 32 hex digits). Anything looser could lead out of the local pipes: Windows reads
 * `/` and `..` in `\\.\pipe\x/../../UNC/server/pipe/y` as a pipe on another computer.
 */
const isSocketPath = (path: string) => path.startsWith('/') || /^\\\\\.\\pipe\\switchboard-[0-9a-f]{32}$/.test(path);

/** `engine.json` as written by a running engine; null when it doesn't read as one. */
export function parseInfo(text: string): CompanionInfo | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const info = value as Record<string, unknown>;
  if (typeof info.socket !== 'string' || !isSocketPath(info.socket) || typeof info.token !== 'string' || !info.token) return null;
  if (typeof info.pid !== 'number' || typeof info.protocol !== 'number') return null;
  return {
    protocol: info.protocol,
    socket: info.socket,
    token: info.token,
    pid: info.pid,
    startedAt: typeof info.startedAt === 'number' ? info.startedAt : 0,
    appVersion: typeof info.appVersion === 'string' ? info.appVersion : '',
  };
}

export type Found = { kind: 'found'; info: CompanionInfo; file: string } | { kind: 'none' } | { kind: 'incompatible'; info: CompanionInfo };

/**
 * The first file of a running engine that speaks this extension's protocol. A file left behind by a crash (its
 * process is gone) is skipped; one from a newer or older Switchboard says so.
 */
export function pickInfo(files: ReadonlyArray<{ file: string; text: string | null }>, alive: (pid: number) => boolean): Found {
  let incompatible: CompanionInfo | null = null;
  for (const { file, text } of files) {
    const info = text === null ? null : parseInfo(text);
    if (!info || !alive(info.pid)) continue;
    if (info.protocol !== COMPANION_PROTOCOL) {
      incompatible ??= info;
      continue;
    }
    return { kind: 'found', info, file };
  }
  return incompatible ? { kind: 'incompatible', info: incompatible } : { kind: 'none' };
}
