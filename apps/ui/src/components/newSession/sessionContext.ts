import type { SessionRowData } from '../../state/sessionsStore.ts';
import { isActive, rowStatus } from '../../state/sidebarRows.ts';
import type { NewSessionMode } from './newSessionLayout.ts';
import { pickUpRows } from './projectTiles.ts';

/** How many of the project's done sessions show under what is still open. */
const LAST_DONE = 3;

/** A session in New session's context, with its state in words and the state's colour. */
export interface ContextRow {
  row: SessionRowData;
  label: string;
  tone: 'needs-you' | 'working' | 'unread' | 'error' | 'idle';
}

/** A row's state as the sidebar's groups say it: needs you, working, to review (finished, not read), open, or done. */
export function contextState(row: SessionRowData, done: boolean): Pick<ContextRow, 'label' | 'tone'> {
  if (done) return { label: 'Done', tone: 'idle' };
  switch (rowStatus(row)) {
    case 'needs-you':
      return { label: 'Needs you', tone: 'needs-you' };
    case 'running':
    case 'background':
      return { label: 'Working', tone: 'working' };
    case 'unread':
      return { label: 'To review', tone: 'unread' };
    case 'error':
      return { label: 'Failed', tone: 'error' };
    default:
      return { label: 'Open', tone: 'idle' };
  }
}

/** The picked project's sessions: what `pickUpRows` lists (needs you, working, then the newest), then the last few done. */
export function contextRows(rows: readonly SessionRowData[], root: string, now: number, archiveAfterDays: number): ContextRow[] {
  const open = pickUpRows(rows, root, now, archiveAfterDays).map((row) => ({ row, ...contextState(row, false) }));
  const done = rows
    .filter((row) => row.projectRoot === root && !isActive(row, now, archiveAfterDays))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, LAST_DONE)
    .map((row) => ({ row, ...contextState(row, true) }));
  return [...open, ...done];
}

export type ContextSection = 'in-project' | 'going' | 'defaults';

/**
 * Which sections the context shows, top to bottom. A section with nothing in it stays out. Going now shows only with a
 * focus limit set; when stacked, the focus line's Show opens that list instead.
 */
export function contextSections(input: { mode: NewSessionMode; sessions: number; focusLimit: number | null; going: number; hasDefaults: boolean }): ContextSection[] {
  const sections: ContextSection[] = [];
  if (input.sessions > 0) sections.push('in-project');
  if (input.focusLimit !== null && input.going > 0 && input.mode !== 'stack') sections.push('going');
  if (input.hasDefaults) sections.push('defaults');
  return sections;
}

/** Defaults for a project, in two lines: "Personal · Opus · Auto", and "Current checkout on dev". */
export function defaultsLines(input: { profile: string | null; model: string; mode: string; worktree: boolean; branch: string | null }): [string, string] {
  const first = [input.profile, input.model, input.mode].filter(Boolean).join(' · ');
  const where = input.worktree ? 'New worktree' : 'Current checkout';
  return [first, input.branch ? `${where} ${input.worktree ? 'from' : 'on'} ${input.branch}` : where];
}
