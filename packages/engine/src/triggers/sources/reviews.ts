import { reviewQuery, type PrItem, type TriggerSource } from '@seshboard/protocol';
import { json, readFailure, type GhRun, type SourceRead } from './gh.ts';

/**
 * Reviews for you: the open pull requests that ask the trigger's reviewer for a review, with its label, or both, as
 * `gh pr list` gives them (one GitHub search does the filtering). Like issues, who opened them is read apart
 * (`readAssociations` with `pullRequest`), only for the ones a check might start.
 */
export async function readReviewRequests(gh: GhRun, root: string, source: TriggerSource): Promise<SourceRead<PrItem[]>> {
  const result = await gh(reviewQuery({ source }), root, 20_000);
  if (result.code !== 0 || result.missing) return readFailure(result);
  const raw = json(result.stdout);
  if (!Array.isArray(raw)) return { ok: false, message: "gh's answer didn't read", rateLimited: false };
  const login = (value: unknown) => (value && typeof (value as { login?: unknown }).login === 'string' ? { login: (value as { login: string }).login } : null);
  const prs = raw.flatMap((r): PrItem[] => {
    const pr = r as Record<string, unknown> | null;
    if (!pr || typeof pr.number !== 'number' || typeof pr.title !== 'string' || typeof pr.url !== 'string' || typeof pr.headRefName !== 'string' || !pr.headRefName) return [];
    const labels = Array.isArray(pr.labels) ? pr.labels.flatMap((l) => (typeof (l as { name?: unknown })?.name === 'string' ? [{ name: (l as { name: string }).name }] : [])) : [];
    return [
      {
        number: pr.number,
        title: pr.title,
        url: pr.url,
        labels,
        author: login(pr.author),
        body: typeof pr.body === 'string' ? pr.body : null,
        updatedAt: typeof pr.updatedAt === 'string' ? pr.updatedAt : undefined,
        headRefName: pr.headRefName,
        baseRefName: typeof pr.baseRefName === 'string' ? pr.baseRefName : undefined,
        headRefOid: typeof pr.headRefOid === 'string' ? pr.headRefOid : undefined,
        isCrossRepository: pr.isCrossRepository === true,
        headRepositoryOwner: login(pr.headRepositoryOwner),
      },
    ];
  });
  return { ok: true, value: prs };
}

/** A pull request's text, comments and reviews so far, for what its review session reads. */
export async function readPullRequest(
  gh: GhRun,
  root: string,
  number: number,
): Promise<SourceRead<{ body: string; comments: Array<{ author: string | null; body: string }>; reviews: Array<{ author: string | null; state: string; body: string }> }>> {
  const result = await gh(['pr', 'view', String(number), '--json', 'body,comments,reviews'], root, 20_000);
  if (result.code !== 0 || result.missing) return readFailure(result);
  const raw = json(result.stdout) as { body?: unknown; comments?: unknown; reviews?: unknown } | null;
  if (!raw) return { ok: false, message: "gh's answer didn't read", rateLimited: false };
  const list = (value: unknown) => (Array.isArray(value) ? value : []) as Array<Record<string, unknown>>;
  const who = (item: Record<string, unknown>) => (typeof (item.author as { login?: unknown } | null)?.login === 'string' ? (item.author as { login: string }).login : null);
  return {
    ok: true,
    value: {
      body: typeof raw.body === 'string' ? raw.body : '',
      comments: list(raw.comments).flatMap((c) => (typeof c.body === 'string' ? [{ author: who(c), body: c.body }] : [])),
      reviews: list(raw.reviews).flatMap((r) => (typeof r.state === 'string' ? [{ author: who(r), state: r.state, body: typeof r.body === 'string' ? r.body : '' }] : [])),
    },
  };
}
