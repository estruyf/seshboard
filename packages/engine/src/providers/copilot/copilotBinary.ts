import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { posix, win32 } from 'node:path';

/**
 * Where GitHub Copilot CLI may be, in order: PATH first, then the usual install spots (its installer's `~/.local/bin`,
 * Homebrew, WinGet). On Windows only a `copilot.exe`: npm's `copilot.cmd` needs a shell the SDK doesn't start it with.
 */
export function copilotCandidates(env: Record<string, string | undefined>, home: string, platform: NodeJS.Platform = process.platform): string[] {
  const { delimiter, join } = platform === 'win32' ? win32 : posix;
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
  if (platform === 'win32') {
    const wellKnown = [join(home, '.local', 'bin', 'copilot.exe'), ...(env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'copilot.exe')] : [])];
    return [...new Set([...dirs.map((dir) => join(dir, 'copilot.exe')), ...wellKnown])];
  }
  const wellKnown = [join(home, '.local', 'bin', 'copilot'), '/opt/homebrew/bin/copilot', '/usr/local/bin/copilot'];
  return [...new Set([...dirs.map((dir) => join(dir, 'copilot')), ...wellKnown])];
}

const isExecutable = (path: string) => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** `GitHub Copilot CLI 1.0.90-0.` → `1.0.90-0`. */
export const parseCopilotVersion = (output: string) => /(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(output)?.[1]?.replace(/\.$/, '') ?? null;

/** The user's own `copilot` and its version, or null when it isn't installed. */
export async function findCopilot(env: Record<string, string | undefined>, home: string): Promise<{ path: string; version: string | null } | null> {
  const path = copilotCandidates(env, home).find(isExecutable);
  if (!path) return null;
  const version = await new Promise<string | null>((resolve) =>
    execFile(path, ['--version'], { env: env as NodeJS.ProcessEnv, timeout: 10_000 }, (error, stdout) => resolve(error ? null : parseCopilotVersion(stdout))),
  );
  return { path, version };
}
