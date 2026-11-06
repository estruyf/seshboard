import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import type { CodexBinary } from './appServer.ts';

/**
 * Where OpenAI's Codex CLI may be, in order: PATH first, then the usual install spots (its installer's `~/.local/bin`,
 * Homebrew, npm's global prefix when the environment names it). On Windows only a `codex.exe`: npm's install leaves a
 * `codex.cmd`, which needs a shell (`npmCodex` runs its script with `node` instead).
 */
export function codexCandidates(env: Record<string, string | undefined>, home: string, platform: NodeJS.Platform = process.platform): string[] {
  const { delimiter, join } = platform === 'win32' ? win32 : posix;
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  if (platform === 'win32') {
    return [...new Set([...dirs.map((dir) => join(dir, 'codex.exe')), join(home, '.local', 'bin', 'codex.exe')])];
  }
  const npmPrefix = env.npm_config_prefix ?? env.NPM_CONFIG_PREFIX;
  const wellKnown = [
    join(home, '.local', 'bin', 'codex'),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    ...(npmPrefix ? [join(npmPrefix, 'bin', 'codex')] : []),
    join(home, '.npm-global', 'bin', 'codex'),
  ];
  return [...new Set([...dirs.map((dir) => join(dir, 'codex')), ...wellKnown])];
}

/**
 * On Windows, `npm install -g @openai/codex` leaves only a `codex.cmd`, which Node can't start without a shell. Its
 * package's script runs with the user's own `node` instead: the command (`node.exe` on PATH) and its first argument
 * (the script npm's `.cmd` runs). Looks on PATH and in npm's default global folder (`%APPDATA%\npm`). Null elsewhere, or
 * when either isn't there.
 */
export function npmCodex(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  files: { exists(path: string): boolean; readJson(path: string): unknown },
): { path: string; args: string[] } | null {
  if (platform !== 'win32') return null;
  const { delimiter, join } = win32;
  const path = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  const node = path.map((dir) => join(dir, 'node.exe')).find((file) => files.exists(file));
  if (!node) return null;
  const dirs = [...new Set([...path, ...(env.APPDATA ? [join(env.APPDATA, 'npm')] : [])])];
  for (const dir of dirs) {
    if (!files.exists(join(dir, 'codex.cmd'))) continue;
    // npm's global prefix keeps the package next to its `.cmd`.
    const pkg = join(dir, 'node_modules', '@openai', 'codex');
    const json = files.readJson(join(pkg, 'package.json')) as { bin?: string | Record<string, string> } | null;
    const bin = typeof json?.bin === 'string' ? json.bin : json?.bin?.codex;
    if (bin && files.exists(join(pkg, bin))) return { path: node, args: [join(pkg, bin)] };
  }
  return null;
}

/** `codex-cli 0.167.0` → `0.167.0` (a pre-release keeps its suffix: `0.168.0-alpha.2`). */
export const parseCodexVersion = (output: string) => /(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(output)?.[1]?.replace(/\.$/, '') ?? null;

const isExecutable = (path: string) => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * The user's own `codex` and its version, or null when it isn't installed. `args` go before `app-server`: on Windows,
 * npm's install runs as `node <its script>` (`npmCodex`).
 */
export async function findCodex(env: Record<string, string | undefined>, home: string): Promise<CodexBinary | null> {
  const exe = codexCandidates(env, home).find(isExecutable);
  const found = exe ? { path: exe, args: [] as string[] } : npmCodex(env, process.platform, { exists: existsSync, readJson });
  if (!found) return null;
  const version = await new Promise<string | null>((resolve) =>
    execFile(found.path, [...found.args, '--version'], { env: env as NodeJS.ProcessEnv, timeout: 10_000, windowsHide: true }, (error, stdout) => resolve(error ? null : parseCodexVersion(stdout))),
  );
  return { path: found.path, ...(found.args.length ? { args: found.args } : {}), version };
}
