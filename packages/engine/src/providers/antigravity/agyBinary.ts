import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { posix, win32 } from 'node:path';

/** The user's own `agy` and its version. */
export interface AgyBinary {
  path: string;
  version: string | null;
}

/**
 * Where Antigravity CLI may be, in order: PATH first, then where its installer puts it (`~/.local/bin` on macOS and
 * Linux, `%LOCALAPPDATA%\agy\bin` on Windows). The engine's PATH may not have `~/.local/bin`, so it is looked at too.
 */
export function agyCandidates(env: Record<string, string | undefined>, home: string, platform: NodeJS.Platform = process.platform): string[] {
  const { delimiter, join } = platform === 'win32' ? win32 : posix;
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    return [...new Set([...dirs.map((dir) => join(dir, 'agy.exe')), join(local, 'agy', 'bin', 'agy.exe'), join(home, '.local', 'bin', 'agy.exe')])];
  }
  return [...new Set([...dirs.map((dir) => join(dir, 'agy')), join(home, '.local', 'bin', 'agy'), '/opt/homebrew/bin/agy', '/usr/local/bin/agy'])];
}

/** `agy --version` prints the version alone (`1.5.12`); a pre-release keeps its suffix. */
export const parseAgyVersion = (output: string) => /(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(output)?.[1] ?? null;

const isExecutable = (path: string) => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** The user's own `agy` and its version, or null when it isn't installed. */
export async function findAgy(env: Record<string, string | undefined>, home: string): Promise<AgyBinary | null> {
  const path = agyCandidates(env, home).find(isExecutable);
  if (!path) return null;
  const version = await new Promise<string | null>((resolve) =>
    execFile(path, ['--version'], { env: env as NodeJS.ProcessEnv, timeout: 10_000, windowsHide: true }, (error, stdout) => resolve(error ? null : parseAgyVersion(stdout))),
  );
  return { path, version };
}
