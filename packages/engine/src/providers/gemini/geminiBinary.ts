import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';

/** Where `gemini` is, and what goes before its own arguments (`node <its script>` on Windows). */
export interface GeminiBinary {
  path: string;
  args?: string[];
  version: string | null;
}

/**
 * Where Google's Gemini CLI may be, in order: PATH first, then the usual install spots (Homebrew, npm's global prefix
 * when the environment names it, `~/.npm-global`). On Windows npm's install leaves only a `gemini.cmd`, which needs a
 * shell: `npmGemini` runs its package's script with the user's own `node` instead.
 */
export function geminiCandidates(env: Record<string, string | undefined>, home: string, platform: NodeJS.Platform = process.platform): string[] {
  const { delimiter, join } = platform === 'win32' ? win32 : posix;
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  if (platform === 'win32') return [...new Set(dirs.map((dir) => join(dir, 'gemini.exe')))];
  const npmPrefix = env.npm_config_prefix ?? env.NPM_CONFIG_PREFIX;
  const wellKnown = [
    join(home, '.local', 'bin', 'gemini'),
    '/opt/homebrew/bin/gemini',
    '/usr/local/bin/gemini',
    ...(npmPrefix ? [join(npmPrefix, 'bin', 'gemini')] : []),
    join(home, '.npm-global', 'bin', 'gemini'),
  ];
  return [...new Set([...dirs.map((dir) => join(dir, 'gemini')), ...wellKnown])];
}

/**
 * On Windows, `npm install -g @google/gemini-cli` leaves a `gemini.cmd`, which Node can't start without a shell. Its
 * package's script runs with the user's own `node` instead: the command (`node.exe` on PATH) and its first argument
 * (the script npm's `.cmd` runs). Null elsewhere, or when either isn't there.
 */
export function npmGemini(
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
    if (!files.exists(join(dir, 'gemini.cmd'))) continue;
    // npm's global prefix keeps the package next to its `.cmd`.
    const pkg = join(dir, 'node_modules', '@google', 'gemini-cli');
    const json = files.readJson(join(pkg, 'package.json')) as { bin?: string | Record<string, string> } | null;
    const bin = typeof json?.bin === 'string' ? json.bin : json?.bin?.gemini;
    if (bin && files.exists(join(pkg, bin))) return { path: node, args: [join(pkg, bin)] };
  }
  return null;
}

/** `0.67.0` (Gemini prints its version alone) → `0.67.0`; a pre-release keeps its suffix (`0.68.0-preview.1`). */
export const parseGeminiVersion = (output: string) => /(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(output)?.[1]?.replace(/\.$/, '') ?? null;

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
 * The user's own `gemini` and its version, or null when it isn't installed. On Windows, npm's install runs as
 * `node <its script>` (`npmGemini`). A `gemini` that doesn't answer `--version` (a broken Node behind it) has no version.
 */
export async function findGemini(env: Record<string, string | undefined>, home: string): Promise<GeminiBinary | null> {
  const exe = geminiCandidates(env, home).find(isExecutable);
  const found = exe ? { path: exe, args: [] as string[] } : npmGemini(env, process.platform, { exists: existsSync, readJson });
  if (!found) return null;
  const version = await new Promise<string | null>((resolve) =>
    execFile(found.path, [...found.args, '--version'], { env: env as NodeJS.ProcessEnv, timeout: 15_000, windowsHide: true }, (error, stdout) => resolve(error ? null : parseGeminiVersion(stdout))),
  );
  return { path: found.path, ...(found.args.length ? { args: found.args } : {}), version };
}
