import type { GithubStar } from '@switchboard/protocol/bridge';
import type { GithubStarStatus } from '@switchboard/protocol/client';

/** Star on GitHub waits until you have this many sessions in the sidebar, so a first launch isn't a request. */
export const STAR_AFTER_SESSIONS = 5;

/** What the button does: star through gh (`star`), open the repository's page (`open-page`), or nothing to show. */
export type StarPrompt = 'hidden' | 'star' | 'open-page';

/**
 * Whether Star on GitHub shows, and what it does. `status` is null while gh is being asked; without gh (or signed
 * out, or offline) the button still shows and opens the page instead.
 */
export function starPrompt(pref: GithubStar, sessions: number, status: GithubStarStatus | null): StarPrompt {
  if (pref === 'done' || sessions < STAR_AFTER_SESSIONS || status === null || status === 'starred') return 'hidden';
  return status === 'not-starred' ? 'star' : 'open-page';
}
