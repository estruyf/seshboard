import type { GithubItemType, GithubListItem, GithubSearchResult } from '@seshboard/protocol/client';

/** How long typing waits before asking gh again (what was found before shows at once). */
export const SEARCH_DEBOUNCE_MS = 200;

/** The rows of the `#` list, in its order: issues, then pull requests; only one kind with `type`. */
export function rowsOf(result: Pick<GithubSearchResult, 'issues' | 'pullRequests'>, type: GithubItemType | null = null): GithubListItem[] {
  return [...(type === 'pr' ? [] : result.issues), ...(type === 'issue' ? [] : result.pullRequests)];
}

/**
 * An earlier list narrowed to what is typed now, to show at once while gh is asked: a number keeps the items whose
 * number starts with it, words keep the items whose title (or branch) has every one of them.
 */
export function filterLocal<T extends Pick<GithubSearchResult, 'issues' | 'pullRequests'>>(result: T, query: string): T {
  const q = query.trim().replace(/^#/, '').toLowerCase();
  if (!q) return result;
  const words = q.split(/\s+/);
  const keep = (item: GithubListItem) =>
    /^\d+$/.test(q) ? String(item.number).startsWith(q) : words.every((word) => item.title.toLowerCase().includes(word) || (item.headRefName ?? '').toLowerCase().includes(word));
  return { ...result, issues: result.issues.filter(keep), pullRequests: result.pullRequests.filter(keep) };
}

/** Where a pull request's branch is: `feat/issue-start`, or `someone:patch-1` for one from a fork. */
export const branchLine = (pr: Pick<GithubListItem, 'headRefName' | 'isCrossRepository' | 'headOwner'>) =>
  pr.isCrossRepository && pr.headOwner ? `${pr.headOwner}:${pr.headRefName ?? ''}` : (pr.headRefName ?? '');

/** A pasted link to one issue or pull request on github.com (nothing else in the text), or null. */
export function pastedGithubLink(text: string): { type: GithubItemType; repo: string; number: number; url: string } | null {
  const match = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\/(issues|pull)\/(\d{1,9})(?:[/?#]\S*)?$/i.exec(text.trim());
  if (!match) return null;
  return { type: match[2]!.toLowerCase() === 'pull' ? 'pr' : 'issue', repo: match[1]!, number: Number(match[3]), url: text.trim() };
}

/** The text with a pasted link taken out (and the space it leaves), once its chip is added. */
export function withoutLink(text: string, url: string): string {
  const at = text.indexOf(url);
  if (at < 0) return text;
  const before = text.slice(0, at);
  const after = text.slice(at + url.length);
  return before.endsWith(' ') && (after.startsWith(' ') || after === '') ? `${before.slice(0, -1)}${after}` : `${before}${after}`;
}
