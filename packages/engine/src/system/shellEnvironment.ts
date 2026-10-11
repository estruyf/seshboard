import type { AppStateStore } from '../db/appState.ts';
import { userShell } from './shell.ts';
import { processEnv, resolveShellEnv, type ShellEnv } from './shellEnv.ts';

const PATH_KEY = 'shell.path';

/**
 * The user's login-shell environment. Reading it takes ~0.5 s, so the PATH
 * from the previous launch is kept in the cache for things that only need to
 * find binaries (like `claude --version`). Only PATH is cached: shell
 * profiles often export secrets, and those must not be copied to disk.
 * Sessions always wait for the fresh, full environment.
 */
export class ShellEnvironment {
  private settled: ShellEnv | null = null;
  private readonly cachedPath: string | null;
  readonly ready: Promise<ShellEnv>;

  constructor(
    private readonly store: AppStateStore,
    resolve: () => Promise<ShellEnv> = () => resolveShellEnv(),
  ) {
    const cached = store.get(PATH_KEY);
    this.cachedPath = typeof cached === 'string' && cached ? cached : null;
    this.ready = resolve().then((env) => {
      this.settled = env;
      const path = env.env.PATH;
      if (env.resolved && path && path !== this.cachedPath) store.set(PATH_KEY, path);
      return env;
    });
  }

  /** An environment good enough to find binaries, without waiting when a cached PATH exists. */
  async forLookup(): Promise<Record<string, string>> {
    if (this.settled) return this.settled.env;
    if (this.cachedPath) return { ...processEnv(), PATH: this.cachedPath };
    return (await this.ready).env;
  }

  /** What to show in diagnostics right now. */
  async describe(): Promise<{ shell: string; resolved: boolean; cached: boolean; durationMs: number }> {
    if (!this.settled && this.cachedPath) {
      return { shell: userShell(processEnv()).file, resolved: true, cached: true, durationMs: 0 };
    }
    const env = this.settled ?? (await this.ready);
    return { shell: env.shell, resolved: env.resolved, cached: false, durationMs: env.durationMs };
  }
}
