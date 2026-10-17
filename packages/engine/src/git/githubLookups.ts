import type { GithubIssue, GithubPullRequest } from '@switchboard/protocol';
import { classifyGhFailure, runGh, type GhCommand } from './pullRequest.ts';
import { githubPage } from './remotes.ts';

/** Why there is nothing to pick from GitHub, in words for the blank's list. Never an error toast. */
export const NO_REMOTE = 'This project has no remote on GitHub.';

/** What the reference to an issue points at: a number in this repository, or a link (to any repository). */
export function parseIssueRef(ref: string): { number: number; url: string | null } | null {
  const text = ref.trim();
  const link = /^https?:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/(?:issues|pull)\/(\d+)(?:[/?#].*)?$/i.exec(text);
  if (link) return { number: Number(link[3]), url: text.replace(/[?#].*$/, '').replace(/\/$/, '') };
  const number = /^#?(\d{1,9})$/.exec(text);
  return number ? { number: Number(number[1]), url: null } : null;
}

/** What gh's failure means for a list: missing, signed out, or its own message. */
function reasonOf(result: Awaited<ReturnType<typeof runGh>>): string {
  const failure = classifyGhFailure(result);
  if (failure.code === 'GH_MISSING') return "GitHub CLI (gh) isn't installed.";
  if (failure.code === 'GH_AUTH') return 'gh is not signed in to GitHub. Run gh auth login.';
  return failure.message;
}

const REVIEW_WORDS: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes requested', REVIEW_REQUIRED: 'review required' };

/**
 * The repository's open pull requests, newest first, from `gh pr list`. Empty with a reason when the project has no
 * GitHub remote, or gh is missing or signed out.
 */
export async function openPullRequests(root: string, env: Record<string, string>, gh: GhCommand): Promise<{ pullRequests: GithubPullRequest[]; repo: string | null; reason: string | null }> {
  const page = await githubPage(root).catch(() => null);
  if (!page) return { pullRequests: [], repo: null, reason: NO_REMOTE };
  const result = await runGh(gh, ['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,title,url,isDraft,reviewDecision,reviews,headRefName'], { cwd: root, env, timeout: 20_000 });
  if (result.code !== 0) return { pullRequests: [], repo: page.repo, reason: reasonOf(result) };
  try {
    const list = JSON.parse(result.stdout) as Array<{ number: number; title: string; url: string; isDraft?: boolean; reviewDecision?: string; reviews?: unknown[]; headRefName?: string }>;
    return {
      pullRequests: list.map((pr) => ({
        number: pr.number,
        title: pr.title,
        url: pr.url,
        draft: pr.isDraft === true,
        review: REVIEW_WORDS[pr.reviewDecision ?? ''] ?? null,
        reviews: Array.isArray(pr.reviews) ? pr.reviews.length : 0,
        branch: pr.headRefName ?? '',
      })),
      repo: page.repo,
      reason: null,
    };
  } catch {
    return { pullRequests: [], repo: page.repo, reason: "gh's answer didn't read." };
  }
}

/** An issue from a link, `#123` or `123`, through `gh issue view`. Null with a reason when it can't be found. */
export async function findIssue(root: string, ref: string, env: Record<string, string>, gh: GhCommand): Promise<{ issue: GithubIssue | null; reason: string | null }> {
  const parsed = parseIssueRef(ref);
  if (!parsed) return { issue: null, reason: 'Paste a link to an issue, or type its number.' };
  // A link names its repository; a number needs this project's.
  if (!parsed.url && !(await githubPage(root).catch(() => null))) return { issue: null, reason: NO_REMOTE };
  const result = await runGh(gh, ['issue', 'view', parsed.url ?? String(parsed.number), '--json', 'number,title,url'], { cwd: root, env, timeout: 20_000 });
  if (result.code !== 0) {
    if (/could not resolve|not found|no issue/i.test(`${result.stderr}\n${result.stdout}`)) return { issue: null, reason: `No issue #${parsed.number} found.` };
    return { issue: null, reason: reasonOf(result) };
  }
  try {
    const issue = JSON.parse(result.stdout) as GithubIssue;
    return { issue: { number: issue.number, title: issue.title, url: issue.url }, reason: null };
  } catch {
    return { issue: null, reason: "gh's answer didn't read." };
  }
}
