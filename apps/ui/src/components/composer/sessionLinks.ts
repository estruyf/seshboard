import type { Brief, SessionSummary, WorktreePullRequest } from '@switchboard/protocol/client';
import { slashScore } from '../savedPrompts/fillModel.ts';

/** Sessions the `@` list shows at most, of them from other projects, and for a bare `@`. */
export const MAX_LINKABLE = 6;
const OTHER_PROJECTS = 3;
const RECENT = 4;

/** A query with a `/` or `.` in it is a path: only files then. */
export const isPathQuery = (query: string) => /[/\\.]/.test(query);

/** The branch a session works on: its worktree's, else the one its transcript recorded. */
export const branchOf = (session: SessionSummary): string | null => session.worktree?.branch ?? session.gitBranch ?? null;

/** Archived by hand and quiet since. */
const archived = (session: SessionSummary) => session.archivedAt !== null && session.archivedAt >= session.updatedAt;

/** How well a session matches what was typed after `@`: its title, then its branch, then its first prompt. */
function scoreOf(query: string, session: SessionSummary): number | null {
  const title = slashScore(query, session.title, session.firstPrompt ?? '');
  const branch = branchOf(session);
  const onBranch = branch ? slashScore(query, branch) : null;
  if (title === null && onBranch === null) return null;
  // A branch match counts a little less than the same match on the title.
  return Math.max(title ?? -Infinity, (onBranch ?? -Infinity) - 5);
}

/**
 * The sessions the `@` list offers to link (docs/session-linking.md): never this one. A bare `@` lists this project's
 * most recent four; a word matches titles, branches and first prompts, this project's first, then up to three of
 * other projects'. A path lists none. An archived session only shows when its title is typed in full.
 */
export function linkableSessions(all: Iterable<SessionSummary>, options: { selfId: string | null; root: string | null; query: string }): SessionSummary[] {
  const query = options.query.trim();
  if (isPathQuery(query)) return [];
  const candidates = [...all].filter((s) => s.id !== options.selfId && (!archived(s) || (query && s.title.toLowerCase() === query.toLowerCase())));
  const here = (s: SessionSummary) => options.root !== null && s.projectRoot === options.root;
  const recent = (a: SessionSummary, b: SessionSummary) => b.updatedAt - a.updatedAt;
  if (!query) return candidates.filter(here).sort(recent).slice(0, RECENT);
  const scored = candidates.flatMap((session) => {
    const score = scoreOf(query, session);
    return score === null ? [] : [{ session, score }];
  });
  const byScore = (a: { session: SessionSummary; score: number }, b: { session: SessionSummary; score: number }) => b.score - a.score || recent(a.session, b.session);
  const mine = scored.filter((s) => here(s.session)).sort(byScore);
  const others = scored.filter((s) => !here(s.session)).sort(byScore).slice(0, OTHER_PROJECTS);
  return [...mine, ...others].slice(0, MAX_LINKABLE).map((s) => s.session);
}

/** What a linked session's chip says after its label: the branch and pull request, or why there is none. */
export function linkDetail(info: { gone: boolean; branch: string | null; pr: WorktreePullRequest | null } | null): string | null {
  if (!info) return null;
  if (info.gone) return 'This session is gone';
  if (!info.branch) return 'No branch';
  return info.pr ? `${info.branch} · #${info.pr.number}` : info.branch;
}

/** The number of a brief's pull request (`#148 open, …`), null without one. */
export function briefPr(brief: Brief): number | null {
  const match = /^#(\d+)\b/.exec(brief.fields['pull request'] ?? '');
  return match ? Number(match[1]) : null;
}
