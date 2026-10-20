import type { ContextItem, GithubIssueDetail, GithubItemType, GithubListItem, GithubPrDetail, GithubReason } from '@switchboard/protocol/client';
import { agoText } from '../../lib/format.ts';

/** What to say when GitHub gave nothing to list: null when nothing went wrong. */
export function reasonLine(reason: GithubReason, message: string | null): string | null {
  switch (reason) {
    case 'ok':
      return null;
    case 'no-gh':
      return "GitHub CLI (gh) isn't installed.";
    case 'not-signed-in':
      return 'gh is not signed in to GitHub. Run gh auth login.';
    case 'not-github':
      return 'This project has no remote on GitHub.';
    default:
      return message ?? "Couldn't reach GitHub.";
  }
}

/** "Issue" or "Pull request", to start a sentence or a label. */
export const typeWord = (type: GithubItemType) => (type === 'pr' ? 'Pull request' : 'Issue');

/** "opened 3d ago by estruyf", under an issue in the `#` list. */
export function openedLine(item: Pick<GithubListItem, 'createdAt' | 'updatedAt' | 'author'>, now = Date.now()): string {
  const at = item.createdAt || item.updatedAt;
  const when = at ? `opened ${agoText(at, now)}` : 'opened';
  return item.author ? `${when} by ${item.author}` : when;
}

/** "1 unresolved comment", "2 unresolved comments". */
export const unresolvedText = (count: number) => (count === 1 ? '1 unresolved comment' : `${count} unresolved comments`);

/** "1 comment", "4 comments". */
const commentsText = (count: number) => (count === 1 ? '1 comment' : `${count} comments`);

/**
 * The detail on a chip, after the title: an issue's labels and comments ("enhancement · 4 comments"), a pull request's
 * branch and unresolved review comments ("feat/issue-start · 2 comments"). Null until it is known.
 */
export function chipDetail(detail: GithubIssueDetail | GithubPrDetail | null): string | null {
  if (!detail) return null;
  if (detail.type === 'pr' && 'reviewComments' in detail) {
    return [detail.headRefName, detail.reviewComments.length ? commentsText(detail.reviewComments.length) : null].filter(Boolean).join(' · ') || null;
  }
  const labels = detail.labels.slice(0, 2).map((l) => l.name);
  return [...labels, detail.comments ? commentsText(detail.comments) : null].filter(Boolean).join(' · ') || null;
}

/** A pull request from a fork that you can't push to: Switchboard never pushes it or creates a pull request from it. */
export const isReadOnlyFork = (pr: Pick<GithubPrDetail, 'isCrossRepository' | 'canPush'>) => pr.isCrossRepository && !pr.canPush;

/** A row's name for screen readers: "Issue 32, Start a session from a GitHub issue or pull request, open, enhancement". */
export function itemLabel(item: GithubListItem): string {
  const parts = [`${typeWord(item.type)} ${item.number}`, item.title, item.isDraft ? 'draft' : item.state];
  if (item.type === 'pr') {
    if (item.headRefName) parts.push(`branch ${item.headRefName}`);
    if (item.unresolved) parts.push(unresolvedText(item.unresolved));
    if (item.isCrossRepository) parts.push('from a fork');
  }
  parts.push(...item.labels.map((l) => l.name));
  return parts.join(', ');
}

/** The chip an item becomes in the context tray. */
export const chipItem = (item: Pick<GithubListItem, 'type' | 'repo' | 'number' | 'title' | 'url'>): Extract<ContextItem, { kind: 'github' }> => ({
  kind: 'github',
  type: item.type,
  repo: item.repo,
  number: item.number,
  title: item.title,
  url: item.url,
});
