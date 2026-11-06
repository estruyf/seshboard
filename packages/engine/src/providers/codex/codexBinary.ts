import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import type { CodexBinary } from './appServer.ts';

/**
 * Where OpenAI's Codex CLI may be, in order: PATH first, then the usual install spots (its installer's `~/.local/bin`,
 * Homebrew, npm's global prefix when the environment names it). On Windows only a `codex.exe`: npm's install leaves a
 * `codex.cmd`, which needs a shell (`npmCodex` finds the `codex.exe` it starts instead).
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

/** The Rust target npm's Codex package names its Windows binaries by, per architecture. */
const WINDOWS_TRIPLES: Partial<Record<NodeJS.Architecture, string>> = { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' };

/**
 * On Windows, `npm install -g @openai/codex` leaves only a `codex.cmd`, which Node can't start without a shell. And its
 * script (`bin/codex.js`) doesn't replace itself with Codex there, as it does on macOS and Linux: it starts the native
 * `codex.exe` as a child, so the pid and a kill would be node's and Codex would be left running. So the `codex.exe`
 * is found the way that script finds it: in the platform package `@openai/codex-win32-<arch>` (nested in Codex's
 * package or next to it), else in Codex's own `vendor` folder, under `vendor/<target>/bin`. Looks next to each
 * `codex.cmd` on PATH and in npm's default global folder (`%APPDATA%\npm`). Null elsewhere, or when it isn't there.
 */
export function npmCodex(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  files: { exists(path: string): boolean },
  arch: NodeJS.Architecture = process.arch,
): { path: string; args: string[] } | null {
  const triple = WINDOWS_TRIPLES[arch];
  if (platform !== 'win32' || !triple) return null;
  const { delimiter, join } = win32;
  const path = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  const dirs = [...new Set([...path, ...(env.APPDATA ? [join(env.APPDATA, 'npm')] : [])])];
  const platformPackage = `codex-win32-${arch}`;
  for (const dir of dirs) {
    if (!files.exists(join(dir, 'codex.cmd'))) continue;
    // npm's global prefix keeps the package next to its `.cmd`.
    const modules = join(dir, 'node_modules');
    const codex = join(modules, '@openai', 'codex');
    const vendors = [join(codex, 'node_modules', '@openai', platformPackage, 'vendor'), join(modules, '@openai', platformPackage, 'vendor'), join(codex, 'vendor')];
    const exe = vendors.map((vendor) => join(vendor, triple, 'bin', 'codex.exe')).find((file) => files.exists(file));
    if (exe) return { path: exe, args: [] };
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

/**
 * The user's own `codex` and its version, or null when it isn't installed. On Windows, npm's install is run by its
 * native `codex.exe` (`npmCodex`).
 */
export async function findCodex(env: Record<string, string | undefined>, home: string): Promise<CodexBinary | null> {
  const exe = codexCandidates(env, home).find(isExecutable);
  const found = exe ? { path: exe, args: [] as string[] } : npmCodex(env, process.platform, { exists: existsSync });
  if (!found) return null;
  const version = await new Promise<string | null>((resolve) =>
    execFile(found.path, [...found.args, '--version'], { env: env as NodeJS.ProcessEnv, timeout: 10_000, windowsHide: true }, (error, stdout) => resolve(error ? null : parseCodexVersion(stdout))),
  );
  return { path: found.path, ...(found.args.length ? { args: found.args } : {}), version };
}
