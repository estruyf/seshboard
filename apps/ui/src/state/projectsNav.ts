import type { ProjectInfo } from '@seshboard/protocol/client';
import { tildify } from '../lib/format.ts';
import type { ProjectTab } from './projectPageStore.ts';
import type { SessionRowData } from './sessionsStore.ts';

// The Projects view's decisions, without React or the stores: which projects the search keeps, the previous and
// next one, where a dragged or ⌥⇧-moved project lands, which tab a project opens on, and when the list folds away.

/** Under this width (of the view, not the window) the list hides and the header's ‹ shows it over the project. */
export const PROJECTS_NARROW_PX = 1000;

/** Whether the Projects view is too narrow for the list beside the project. Not measured yet: wide. */
export const isNarrowProjects = (width: number | null) => width !== null && width < PROJECTS_NARROW_PX;

/**
 * The projects the list's search keeps, in the saved order: the name or the folder (as shown, with ~) contains the
 * text, ignoring case. Plain text rather than fuzzy: a path has so many letters that a fuzzy match keeps everything.
 */
export function filterProjects(list: readonly ProjectInfo[], query: string, home: string | null): ProjectInfo[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...list];
  return list.filter((p) => p.name.toLowerCase().includes(needle) || tildify(p.root, home).toLowerCase().includes(needle));
}

/** Dragging reorders the whole list, so it is off while a search hides some of it. */
export const canReorder = (query: string) => !query.trim();

/**
 * The project before (-1) or after (1) `root` in `list` (the list as shown, so a search narrows it); null at either
 * end. When `root` isn't in it (the search hides it), the first or the last one.
 */
export function neighbourProject<T extends { root: string }>(list: readonly T[], root: string | null, delta: -1 | 1): T | null {
  const index = root === null ? -1 : list.findIndex((p) => p.root === root);
  if (index === -1) return (delta === 1 ? list[0] : list.at(-1)) ?? null;
  return list[index + delta] ?? null;
}

/** `order` with the item at `from` moved to `to` (both indices in `order`); unchanged when either is out of range. */
export function moveProject<T>(order: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= order.length || to < 0 || to >= order.length || from === to) return [...order];
  const next = [...order];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/** ⌥⇧↑ / ⌥⇧↓ on the open project: the new order and its new index, or null at either end. */
export function keyboardMove(order: readonly string[], root: string, delta: -1 | 1): { order: string[]; to: number } | null {
  const from = order.indexOf(root);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= order.length) return null;
  return { order: moveProject(order, from, to), to };
}

/** What a screen reader hears after a move: "Seshboard moved to position 3 of 11". `index` counts from 0. */
export const moveAnnouncement = (name: string, index: number, total: number) => `${name} moved to position ${index + 1} of ${total}`;

/**
 * The page's state after opening `root`: on `tab` when given (switching projects passes the tab on screen, so it
 * stays), else the tab the project was last left on, else Overview. The project remembers it.
 */
export function pageAfterOpen(lastTab: ReadonlyMap<string, ProjectTab>, root: string, tab?: ProjectTab): { root: string; tab: ProjectTab; lastTab: Map<string, ProjectTab> } {
  const next = tab ?? lastTab.get(root) ?? 'overview';
  const remembered = new Map(lastTab);
  remembered.set(root, next);
  return { root, tab: next, lastTab: remembered };
}

/** The project the `projects` view opens on: the one last open when it is still a project, else the first. */
export function initialProject(list: readonly { root: string }[], last: string | null): string | null {
  return (last && list.some((p) => p.root === last) ? last : list[0]?.root) ?? null;
}

/** A project's live state in the list: something waiting for you wins over something working. */
export type ProjectActivity = 'needs-you' | 'working' | null;

/** Each project's live state, from the sidebar's rows (`status` as `rowStatus` reads it). */
export function projectActivity(rows: readonly SessionRowData[], status: (row: SessionRowData) => string | null): Map<string, ProjectActivity> {
  const result = new Map<string, ProjectActivity>();
  for (const row of rows) {
    if (!row.projectRoot) continue;
    const s = status(row);
    if (s === 'needs-you') result.set(row.projectRoot, 'needs-you');
    else if (s === 'running' && result.get(row.projectRoot) !== 'needs-you') result.set(row.projectRoot, 'working');
  }
  return result;
}

/** The worktree hint on a project's row: "4 can go" when some can, else "2 worktrees"; null without any. */
export function worktreeHint(count: number, safe: number): string | null {
  if (safe > 0) return `${safe} can go`;
  if (count > 0) return `${count} ${count === 1 ? 'worktree' : 'worktrees'}`;
  return null;
}
