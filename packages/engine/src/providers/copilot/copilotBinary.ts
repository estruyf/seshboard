import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { posix, win32 } from 'node:path';

/**
 * Where GitHub Copilot CLI may be, in order: PATH first, then the usual install spots (its installer's `~/.local/bin`,
 * Homebrew, WinGet). On Windows only a `copilot.exe`: npm's `copilot.cmd` needs a shell the SDK doesn't start it with
 * (`npmCopilot` runs its script with `node` instead).
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

/**
 * On Windows, npm's install (`npm install -g @github/copilot`, what Seshboard suggests) leaves only a `copilot.cmd`,
 * which the SDK can't start without a shell. Its package's script runs with the user's own `node` instead: the
 * command (`node.exe` on PATH) and its first argument (the script npm's `.cmd` runs). Null elsewhere, or when either
 * isn't there.
 */
export function npmCopilot(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  files: { exists(path: string): boolean; readJson(path: string): unknown },
): { path: string; args: string[] } | null {
  if (platform !== 'win32') return null;
  const { delimiter, join } = win32;
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
  const node = dirs.map((dir) => join(dir, 'node.exe')).find((path) => files.exists(path));
  if (!node) return null;
  for (const dir of dirs) {
    if (!files.exists(join(dir, 'copilot.cmd'))) continue;
    // npm's global prefix keeps the package next to its `.cmd`.
    const pkg = join(dir, 'node_modules', '@github', 'copilot');
    const json = files.readJson(join(pkg, 'package.json')) as { bin?: string | Record<string, string> } | null;
    const bin = typeof json?.bin === 'string' ? json.bin : json?.bin?.copilot;
    if (bin && files.exists(join(pkg, bin))) return { path: node, args: [join(pkg, bin)] };
  }
  return null;
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

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * The user's own `copilot` and its version, or null when it isn't installed. `args` go before the SDK's own: on
 * Windows, npm's install runs as `node <its script>` (`npmCopilot`).
 */
export async function findCopilot(env: Record<string, string | undefined>, home: string): Promise<{ path: string; args?: string[]; version: string | null } | null> {
  const exe = copilotCandidates(env, home).find(isExecutable);
  const found = exe ? { path: exe, args: [] as string[] } : npmCopilot(env, process.platform, { exists: existsSync, readJson });
  if (!found) return null;
  const version = await new Promise<string | null>((resolve) =>
    execFile(found.path, [...found.args, '--version'], { env: env as NodeJS.ProcessEnv, timeout: 10_000 }, (error, stdout) => resolve(error ? null : parseCopilotVersion(stdout))),
  );
  return { path: found.path, ...(found.args.length ? { args: found.args } : {}), version };
}
