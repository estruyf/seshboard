import { railEntries, type RailAvailable, type RailToolId, type RailToolState } from './toolRail.ts';
import type { RailTool } from '@seshboard/protocol/bridge';

/*
 * The side panel with nothing in it: the rail's panel button opens it, and it lists the tools that can open there. A
 * pick opens the tool in its place. Pure, with tests.
 */

/** A row of the list, or a line between the rail's groups. */
export type LauncherEntry = { kind: 'tool'; id: RailToolId } | { kind: 'divider' };

/**
 * What the empty side panel lists: Seshboard's own tools that apply to the session (`railEntries`' rules), in the rail's
 * groups and order. Tools hidden from the rail are listed too, so they stay one click away. The pinned apps open outside
 * the panel and a mod's panes open from Claude Code, so neither is listed.
 */
export function launcherEntries(available: RailAvailable, order?: readonly RailTool[]): LauncherEntry[] {
  return railEntries({ ...available, mods: [], apps: [] }, [], order).flatMap((entry): LauncherEntry[] => (entry.kind === 'divider' ? [{ kind: 'divider' }] : entry.kind === 'tool' ? [{ kind: 'tool', id: entry.id }] : []));
}

/** The empty side panel shows while it was asked for and nothing else is on the side (a tool, or Why). */
export const launcherShown = (requested: boolean, openOnSide: number, why: boolean): boolean => requested && openOnSide === 0 && !why;

/** The rail's panel button: Hide panel while the side shows something (the empty panel too), Show panel otherwise. */
export function panelButton(sideShows: boolean): { action: 'show' | 'hide'; label: 'Show panel' | 'Hide panel' } {
  return sideShows ? { action: 'hide', label: 'Hide panel' } : { action: 'show', label: 'Show panel' };
}

/**
 * A pick in the list opens a closed tool (in front, or the terminal where it docks). One already open, such as the
 * terminal shown below, stays as it is: a pick never closes anything.
 */
export const launcherPick = (state: RailToolState): 'open' | null => (state === 'closed' ? 'open' : null);

/** Where ↑ ↓ Home End move the focus among `count` rows from `at` (wrapping round); null for any other key. */
export function launcherKey(key: string, at: number, count: number): number | null {
  if (count === 0) return null;
  if (key === 'ArrowDown') return at < 0 ? 0 : (at + 1) % count;
  if (key === 'ArrowUp') return at < 0 ? count - 1 : (at - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}
