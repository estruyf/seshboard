import { execFile } from 'node:child_process';
import { userShell } from './shell.ts';

export interface ShellEnv {
  shell: string;
  env: Record<string, string>;
  /** False when the login shell could not be read and process.env was used instead. */
  resolved: boolean;
  durationMs: number;
}

const MARKER = '__SWITCHBOARD_ENV__';

/** Extracts NUL-separated `env -0` output from between two markers (shell rc files may print noise). */
export function parseEnvOutput(output: string): Record<string, string> | null {
  const start = output.indexOf(MARKER);
  const end = output.lastIndexOf(MARKER);
  if (start === -1 || end <= start) return null;
  const body = output.slice(start + MARKER.length, end);
  const env: Record<string, string> = {};
  for (const entry of body.split('\0')) {
    const eq = entry.indexOf('=');
    if (eq <= 0) continue;
    env[entry.slice(0, eq)] = entry.slice(eq + 1);
  }
  return Object.keys(env).length > 0 ? env : null;
}

/** This process's environment as a plain object, with PATH under that name on Windows too. */
export function processEnv(): Record<string, string> {
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
  return process.platform === 'win32' ? withUpperCasePath(env) : env;
}

/**
 * Windows names variables without regard to case, and an app started from the Start menu gets `Path`. Once
 * copied into a plain object that is a different key from the `PATH` every lookup here reads, so it is
 * renamed (keeping one entry, as a child process may otherwise get two). Pure, for testing.
 */
export function withUpperCasePath(env: Record<string, string>): Record<string, string> {
  const key = Object.keys(env).find((k) => k !== 'PATH' && k.toUpperCase() === 'PATH');
  if (!key) return env;
  const { [key]: value, ...rest } = env;
  return { ...rest, PATH: rest.PATH ?? value! };
}

/**
 * Reads the environment of the user's interactive login shell.
 *
 * Apps launched from Finder or the Dock get a minimal PATH, so without this
 * `claude`, nvm-managed node and project-action commands would not be found.
 */
export function resolveShellEnv(timeoutMs = 5000): Promise<ShellEnv> {
  const started = performance.now();
  // Read now: the engine points process.env.CLAUDE_CONFIG_DIR at a profile's folder while it reads transcripts.
  const base = processEnv();
  const shell = process.platform === 'win32' ? userShell(base).file : process.env.SHELL || '/bin/zsh';
  const fallback = (): ShellEnv => ({
    shell,
    env: base,
    resolved: false,
    durationMs: Math.round(performance.now() - started),
  });

  // Windows has no login shell to read: an app started from the Start menu already gets the user's whole environment.
  if (process.platform === 'win32') return Promise.resolve({ ...fallback(), resolved: true });

  return new Promise((resolve) => {
    execFile(
      shell,
      ['-ilc', `printf '%s' '${MARKER}'; /usr/bin/env -0; printf '%s' '${MARKER}'`],
      {
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        // Keep oh-my-zsh & co. from prompting or auto-updating in a non-interactive read.
        env: { ...base, DISABLE_AUTO_UPDATE: 'true', ZSH_DISABLE_COMPFIX: 'true' },
      },
      (error, stdout) => {
        const env = parseEnvOutput(stdout ?? '');
        if (error && !env) return resolve(fallback());
        if (!env) return resolve(fallback());
        resolve({ shell, env, resolved: true, durationMs: Math.round(performance.now() - started) });
      },
    );
  });
}
