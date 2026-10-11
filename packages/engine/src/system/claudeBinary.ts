import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import type { ClaudeInstall } from '@switchboard/protocol';

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Where npm keeps the package's own `claude.exe`, below a folder npm installs commands into. */
const NPM_PACKAGE_EXE = ['node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'];

/**
 * Candidate locations in priority order: PATH first, then the usual install spots. On Windows that is a
 * `claude.exe`: the native installer's, WinGet's, or the one npm's `claude.cmd` shim starts (in the package
 * next to it), which runs without a shell where the shim can't.
 */
export function claudeCandidates(env: Record<string, string>, home = homedir(), platform = process.platform): string[] {
  const { delimiter, join } = platform === 'win32' ? win32 : posix;
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
  if (platform === 'win32') {
    const fromPath = dirs.flatMap((dir) => [join(dir, 'claude.exe'), join(dir, ...NPM_PACKAGE_EXE)]);
    const wellKnown = [
      join(home, '.local', 'bin', 'claude.exe'),
      ...(env.APPDATA ? [join(env.APPDATA, 'npm', ...NPM_PACKAGE_EXE)] : []),
      ...(env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'claude.exe')] : []),
    ];
    return [...new Set([...fromPath, ...wellKnown])];
  }
  const fromPath = dirs.map((dir) => join(dir, 'claude'));
  const wellKnown = [join(home, '.claude', 'local', 'claude'), join(home, '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
  return [...new Set([...fromPath, ...wellKnown])];
}

export function parseClaudeVersion(output: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null;
}

function readVersion(path: string, env: Record<string, string>): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(path, ['--version'], { env, timeout: 10_000 }, (error, stdout) => {
      resolve(error ? null : parseClaudeVersion(stdout));
    });
  });
}

/**
 * Finds the user's installed `claude` binary and its version, or null when there is none.
 * An explicit `override` (from settings) is used as-is and never falls back to searching.
 */
export async function findClaude(env: Record<string, string>, override?: string): Promise<ClaudeInstall | null> {
  const path = override !== undefined ? (isExecutable(override) ? override : undefined) : claudeCandidates(env).find(isExecutable);
  if (!path) return null;
  return { path, version: await readVersion(path, env) };
}
