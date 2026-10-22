import type { RunResult } from '../../git/pullRequest.ts';
import { failureOf } from '../../git/github.ts';

/** Runs gh in a folder (no shell, the login shell's environment) and gives its result. */
export type GhRun = (args: string[], cwd: string, timeoutMs?: number) => Promise<RunResult>;

/** A source's answer: what it found, or why it couldn't look. */
export type SourceRead<T> = { ok: true; value: T } | { ok: false; message: string; rateLimited: boolean };

/** A gh call that failed, in words a paused trigger can show: "gh is signed out", "Repository not found". */
export function readFailure(result: RunResult): { ok: false; message: string; rateLimited: boolean } {
  const output = `${result.stderr}\n${result.stdout}`;
  const failure = failureOf(result);
  if (failure.reason === 'rate-limited') return { ok: false, message: 'GitHub asked to slow down (rate limit)', rateLimited: true };
  if (failure.reason === 'not-signed-in') return { ok: false, message: 'gh is signed out', rateLimited: false };
  if (failure.reason === 'no-gh') return { ok: false, message: "GitHub CLI (gh) isn't installed", rateLimited: false };
  if (failure.reason === 'offline') return { ok: false, message: "Couldn't reach GitHub", rateLimited: false };
  if (/could not resolve to a repository|repository not found|not a git repository|no git remotes|none of the git remotes/i.test(output)) return { ok: false, message: 'Repository not found', rateLimited: false };
  return { ok: false, message: failure.message.replace(/\.$/, ''), rateLimited: false };
}

/** gh's JSON; null when it doesn't read. */
export function json(stdout: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    return null;
  }
}

/** The project's repository and its default branch, from `gh repo view`. */
export async function readRepo(gh: GhRun, root: string): Promise<SourceRead<{ repo: string; defaultBranch: string | null }>> {
  const result = await gh(['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef'], root, 15_000);
  if (result.code !== 0 || result.missing) return readFailure(result);
  const value = json(result.stdout) as { nameWithOwner?: unknown; defaultBranchRef?: { name?: unknown } | null } | null;
  if (typeof value?.nameWithOwner !== 'string') return { ok: false, message: "gh's answer didn't read", rateLimited: false };
  const branch = value.defaultBranchRef?.name;
  return { ok: true, value: { repo: value.nameWithOwner, defaultBranch: typeof branch === 'string' && branch ? branch : null } };
}

/** The account gh is signed in with. */
export async function readLogin(gh: GhRun, root: string): Promise<SourceRead<string>> {
  const result = await gh(['api', 'user', '--jq', '.login'], root, 15_000);
  if (result.code !== 0 || result.missing) return readFailure(result);
  const login = result.stdout.trim();
  return login ? { ok: true, value: login } : { ok: false, message: "gh's answer didn't read", rateLimited: false };
}
