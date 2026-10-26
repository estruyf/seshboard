import type { ProjectOrder, SessionSummary } from '@seshboard/protocol/client';
import { shortAge, tildify } from '../../lib/format.ts';
import { fuzzyScore } from '../../lib/fuzzy.ts';
import { realBranch, type SessionRowData } from '../../state/sessionsStore.ts';
import { isActive } from '../../state/sidebarRows.ts';

/** What is going on in one project right now, from its sessions. */
export interface ProjectActivity {
  needsYou: number;
  working: number;
  /** Sessions with a Claude Code process open (any status). */
  open: number;
  /** The newest activity of any of its sessions. */
  lastActivity: number | null;
}

/** One pass over the sessions: activity per project folder. Pass the rows the sidebar shows (in scope). */
export function activityByProject(rows: readonly SessionRowData[]): Map<string, ProjectActivity> {
  const byRoot = new Map<string, ProjectActivity>();
  for (const row of rows) {
    const a = byRoot.get(row.projectRoot) ?? { needsYou: 0, working: 0, open: 0, lastActivity: null };
    if (row.live?.status === 'needs-you') a.needsYou += 1;
    else if (row.live?.status === 'running') a.working += 1;
    if (row.live) a.open += 1;
    a.lastActivity = Math.max(a.lastActivity ?? 0, row.updatedAt);
    byRoot.set(row.projectRoot, a);
  }
  return byRoot;
}

export type TileTone = 'needs-you' | 'working' | 'idle';

/** A tile's status line: needs you first (it's what to act on), then working, else how long it has been quiet. */
export function tileStatus(activity: ProjectActivity | undefined, lastActivity: number | null, now: number): { tone: TileTone; label: string } {
  if (activity?.needsYou) return { tone: 'needs-you', label: `${activity.needsYou} needs you` };
  if (activity?.working) return { tone: 'working', label: `${activity.working} working` };
  const last = Math.max(activity?.lastActivity ?? 0, lastActivity ?? 0);
  return { tone: 'idle', label: last ? `Idle · ${shortAge(last, now)}` : 'No sessions yet' };
}

/** Folders by their latest activity, newest first; folders without any keep their given order after those. */
export function recentFirst(roots: readonly string[], lastActivity: (root: string) => number | null): string[] {
  return roots
    .map((root, index) => ({ root, index, at: lastActivity(root) ?? 0 }))
    .sort((a, b) => b.at - a.at || a.index - b.index)
    .map((r) => r.root);
}

/** Your projects in the order the preference asks for: most recently used first, or as you ordered them (`roots` is in your order). */
export function orderProjects(roots: readonly string[], order: ProjectOrder, lastActivity: (root: string) => number | null): string[] {
  return order === 'yours' ? [...roots] : recentFirst(roots, lastActivity);
}

/** The widths (px) from which New session's project list shows two, then three columns; the CSS has the same (`PROJECT_GRID`). */
export const COLUMN_BREAKPOINTS = [520, 780] as const;

/** How many columns a list of this width shows: one, plus one for each breakpoint it reaches. */
export function columnsFor(width: number, breakpoints: readonly number[]): number {
  return 1 + breakpoints.filter((min) => width >= min).length;
}

/** How many projects the list shows before "All N projects…": three full rows of three, four of two, six of one. Never more than ⌘9 reaches. */
export function quickCount(columns: number): number {
  return columns >= 3 ? 9 : columns === 2 ? 8 : 6;
}

/**
 * Where an arrow key goes in a grid of `count` rows laid out left to right, then down: left and right along a row,
 * up and down to the row above or below. Home and End go to the first and last. Null for any other key, or past an edge.
 */
export function gridMove(key: string, index: number, count: number, columns: number): number | null {
  const next = key === 'ArrowLeft' ? index - 1 : key === 'ArrowRight' ? index + 1 : key === 'ArrowUp' ? index - columns : key === 'ArrowDown' ? index + columns : key === 'Home' ? 0 : key === 'End' ? count - 1 : null;
  return next === null || next < 0 || next >= count ? null : next;
}

/**
 * The quick tiles: the first `count` projects. A picked folder that isn't among them takes the
 * last place, so the choice stays visible after picking it from the full list (or a folder that isn't
 * a project at all).
 */
export function quickTiles(ordered: readonly string[], value: string | null, count: number): string[] {
  const top = ordered.slice(0, count);
  if (!value || top.includes(value)) return top;
  return [...top.slice(0, count - 1), value];
}

/** The full list, filtered by name or path: the best matches first. Typed paths have their own mode (`pathInput.ts`). */
export function filterFolders(all: readonly string[], filter: string, nameOf: (root: string) => string, home: string | null): string[] {
  if (!filter.trim()) return [...all];
  return all
    .map((folder) => ({ folder, score: Math.max(fuzzyScore(filter, nameOf(folder)) ?? -Infinity, (fuzzyScore(filter, tildify(folder, home)) ?? -Infinity) - 2) }))
    .filter((o) => o.score > -Infinity)
    .sort((a, b) => b.score - a.score)
    .map((o) => o.folder);
}

/** The branch each folder had checked out in its latest session (worktree sessions are on their own branch). */
export function latestBranches(sessions: Iterable<SessionSummary>): Map<string, string | null> {
  const latest = new Map<string, { at: number; branch: string | null }>();
  for (const s of sessions) {
    if (s.worktree || (latest.get(s.projectRoot)?.at ?? -1) >= s.updatedAt) continue;
    latest.set(s.projectRoot, { at: s.updatedAt, branch: realBranch(s.gitBranch) });
  }
  return new Map([...latest].map(([root, { branch }]) => [root, branch]));
}

const urgency = (row: SessionRowData) => (row.live?.status === 'needs-you' ? 0 : row.live?.status === 'running' ? 1 : 2);

/**
 * "Pick up in <project>": the project's sessions from the main list (not archived), the ones that
 * need you or are working first, then the newest.
 */
export function pickUpRows(rows: readonly SessionRowData[], root: string, now: number, archiveAfterDays: number, limit = 5): SessionRowData[] {
  return rows
    .filter((row) => row.projectRoot === root && isActive(row, now, archiveAfterDays))
    .sort((a, b) => urgency(a) - urgency(b) || b.updatedAt - a.updatedAt)
    .slice(0, limit);
}
