import { git } from './gitChanges.ts';

/** How long a fetched branch counts as fresh: a new worktree started within it doesn't fetch again. */
export const BASE_FRESH_MS = 2 * 60_000;

type Fetcher = (root: string, remote: string, branch: string, env: Record<string, string>) => Promise<void>;

/** `git fetch` of one branch into its remote-tracking ref, as a new worktree from `origin/<branch>` needs it. */
export const fetchBranch: Fetcher = async (root, remote, branch, env) => {
  await git(root, ['fetch', '--quiet', '--no-tags', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`], { env: { ...env, GIT_TERMINAL_PROMPT: '0' }, timeout: 120_000 });
};

/**
 * Fetches of the branch a new worktree starts from (`origin/dev`), shared between New session and the start itself.
 * New session fetches while you write the prompt (`worktree.prefetch`), so Start finds the branch fresh and doesn't wait on the
 * network; a start that comes while that fetch runs joins it instead of fetching again. A fetch that fails (offline)
 * isn't remembered, so the next start tries again and the copy here does meanwhile.
 */
export class BaseFetches {
  private readonly entries = new Map<string, { at: number | null; running: Promise<void> | null }>();

  constructor(private readonly options: { freshMs?: number; now?: () => number; fetch?: Fetcher } = {}) {}

  /** Fetches the branch unless it was fetched in the last two minutes, or joins the fetch that is running. Never throws. */
  ensure(root: string, remote: string, branch: string, env: Record<string, string> = {}): Promise<void> {
    const key = `${root}\0${remote}\0${branch}`;
    const entry = this.entries.get(key) ?? { at: null, running: null };
    this.entries.set(key, entry);
    if (entry.running) return entry.running;
    const now = this.options.now ?? Date.now;
    if (entry.at !== null && now() - entry.at < (this.options.freshMs ?? BASE_FRESH_MS)) return Promise.resolve();
    const running = (this.options.fetch ?? fetchBranch)(root, remote, branch, env).then(
      () => {
        entry.at = now();
      },
      () => {},
    );
    entry.running = running.finally(() => {
      entry.running = null;
    });
    return entry.running;
  }
}
