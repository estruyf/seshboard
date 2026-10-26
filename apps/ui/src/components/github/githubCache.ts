import type { GithubSearchResult, ResultOf, RpcClient, Contract } from '@seshboard/protocol/client';
import { filterLocal } from './githubList.ts';

/**
 * What the window already knows from GitHub, so the `#` list shows something the moment it opens: each search's
 * answer, the last list per project (narrowed to what is typed until gh answers), and whether gh works there.
 * The engine keeps its own cache for a minute; this one only saves the round trip.
 */
const searches = new Map<string, GithubSearchResult>();
const lastList = new Map<string, GithubSearchResult>();
const statuses = new Map<string, { at: number; value: Promise<ResultOf<Contract, 'github.status'>> }>();
const STATUS_MS = 60_000;

/** An answer for this query, or the project's last list narrowed to it; null when there is nothing yet. */
export function cachedSearch(root: string, query: string): GithubSearchResult | null {
  const exact = searches.get(`${root}\u0000${query.trim().toLowerCase()}`);
  if (exact) return exact;
  const last = lastList.get(root);
  return last ? filterLocal(last, query) : null;
}

export function rememberSearch(root: string, query: string, result: GithubSearchResult): void {
  searches.set(`${root}\u0000${query.trim().toLowerCase()}`, result);
  if (!query.trim()) lastList.set(root, result);
  else if (!lastList.has(root)) lastList.set(root, result);
}

/** Whether the `#` list works in a project (asked again after a minute; a failed call isn't kept). */
export function githubStatus(client: RpcClient<Contract>, root: string): Promise<ResultOf<Contract, 'github.status'>> {
  const known = statuses.get(root);
  if (known && Date.now() - known.at < STATUS_MS) return known.value;
  const value = client.call('github.status', { root });
  statuses.set(root, { at: Date.now(), value });
  value.catch(() => statuses.delete(root));
  return value;
}

/** Refresh in the list: forget what this window knows about the project too. */
export function forgetGithub(root: string): void {
  for (const key of [...searches.keys()]) if (key.startsWith(`${root}\u0000`)) searches.delete(key);
  lastList.delete(root);
  statuses.delete(root);
}
