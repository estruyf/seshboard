import type { GithubStarStatus } from '@seshboard/protocol';
import { classifyGhFailure, firstUsefulLine, runGh, type GhCommand, type RunResult } from './pullRequest.ts';

/** Seshboard's own repository, which the sidebar's Star on GitHub button stars. */
export const SESHBOARD_REPO = 'estruyf/switchboard';
const STAR_ENDPOINT = `/user/starred/${SESHBOARD_REPO}`;

/** What `gh api /user/starred/…` answered: 204 (exit 0) when starred, 404 when not, anything else can't tell. */
export function starStatusOf(result: RunResult): GithubStarStatus {
  if (result.code === 0) return 'starred';
  if (!result.missing && /HTTP 404/.test(result.stderr)) return 'not-starred';
  return 'unavailable';
}

/** Whether the account gh is signed in with has starred Seshboard. `unavailable` without gh, signed out or offline. */
export async function githubStarStatus(gh: GhCommand, cwd: string, env: Record<string, string>): Promise<GithubStarStatus> {
  return starStatusOf(await runGh(gh, ['api', '--silent', STAR_ENDPOINT], { cwd, env, timeout: 15_000 }));
}

/** Why starring failed, for the caller to fall back to the repository's page. */
export class StarFailure extends Error {
  constructor(
    readonly code: 'GH_MISSING' | 'GH_AUTH' | 'GH_FAILED',
    message: string,
  ) {
    super(message);
  }
}

/** Stars Seshboard for the account gh is signed in with (`PUT /user/starred/…`). Throws `StarFailure`. */
export async function starSeshboard(gh: GhCommand, cwd: string, env: Record<string, string>): Promise<void> {
  const result = await runGh(gh, ['api', '--silent', '--method', 'PUT', STAR_ENDPOINT], { cwd, env, timeout: 30_000 });
  if (result.code === 0) return;
  const failure = classifyGhFailure(result);
  if (failure.code === 'GH_MISSING' || failure.code === 'GH_AUTH') throw new StarFailure(failure.code, failure.message);
  throw new StarFailure('GH_FAILED', firstUsefulLine(`${result.stderr}\n${result.stdout}`) || 'gh could not star the repository.');
}
