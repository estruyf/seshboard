import { DAY_MS, dueForDeletion, KEEP_REASON_TEXT, keepReason, type DeletionState, type KeepReason, type SessionOrigin } from '@seshboard/protocol/client';
import type { SessionRowData } from '../../state/sessionsStore.ts';
import { archivedSince, rowListing, rowStatus } from '../../state/sidebarRows.ts';

/** Where a session is, as the overview's Status column says it. */
export type ManagerStatus = 'needs-you' | 'working' | 'listed' | 'archived' | 'pinned';
export const STATUS_LABEL: Record<ManagerStatus, string> = { 'needs-you': 'Needs you', working: 'Working', listed: 'In the list', archived: 'Archived', pinned: 'Pinned' };

/** The time filter, by last activity. */
export type TimeFilter = 'any' | 'week' | 'month' | 'older';
/** The status filter. */
export type StatusFilter = 'all' | 'listed' | 'archived' | 'pinned';
/** The app a session was started in (`origin`); `other` holds the SDK and unknown ones. */
export type AppFilter = 'all' | 'app' | 'cli' | 'ide' | 'desktop' | 'other';

export const APP_LABEL: Record<Exclude<AppFilter, 'all'>, string> = { app: 'Seshboard', cli: 'Terminal', ide: 'Editor', desktop: 'Claude desktop', other: 'Other' };
export const appOf = (origin: SessionOrigin | undefined): Exclude<AppFilter, 'all'> =>
  origin === 'app' || origin === 'cli' || origin === 'ide' || origin === 'desktop' ? origin : 'other';

export interface ManagerFilters {
  query: string;
  time: TimeFilter;
  status: StatusFilter;
  /** One project folder; null for every project. */
  project: string | null;
  app: AppFilter;
  /** "Review the N": exactly these sessions, until the filter is cleared. */
  review: { ids: ReadonlySet<string>; label: string } | null;
}

export const DEFAULT_FILTERS: ManagerFilters = { query: '', time: 'any', status: 'all', project: null, app: 'all', review: null };

/** What a session holds on to that the sidebar doesn't show: a queued prompt, an unsent message, another window. */
export interface Holds {
  queued: ReadonlySet<string>;
  drafts: ReadonlySet<string>;
  /** Open in another Claude Code window (a process this app doesn't run). */
  elsewhere: ReadonlySet<string>;
}

export interface ManagerRow {
  id: string;
  title: string;
  projectRoot: string;
  branch: string | null;
  status: ManagerStatus;
  updatedAt: number;
  fileSize: number;
  app: Exclude<AppFilter, 'all'>;
  /** When it went to Archived; null while the sidebar lists it. */
  archivedSince: number | null;
  /** Why it would stay when deleted in bulk; null when it may go. */
  keep: KeepReason | null;
  data: SessionRowData;
}

function deletionState(row: SessionRowData, holds: Holds): DeletionState {
  const status = rowStatus(row);
  return {
    pinned: row.pinned,
    working: status === 'running' || status === 'background',
    needsYou: status === 'needs-you',
    openElsewhere: holds.elsewhere.has(row.id),
    queued: holds.queued.has(row.id),
    draft: holds.drafts.has(row.id),
  };
}

/** The overview's rows: every indexed session (whatever the sidebar's scope), with its status and what keeps it. */
export function managerRows(rows: readonly SessionRowData[], holds: Holds, now: number, archiveAfterDays: number): ManagerRow[] {
  return rows.flatMap((data): ManagerRow[] => {
    // A session still starting has no transcript yet: nothing to archive, pin or delete.
    if (!data.summary) return [];
    const since = archivedSince(data, now, archiveAfterDays);
    const live = rowStatus(data);
    const status: ManagerStatus = live === 'needs-you' ? 'needs-you' : live === 'running' ? 'working' : data.pinned ? 'pinned' : since === null ? 'listed' : 'archived';
    return [
      {
        id: data.id,
        title: data.title,
        projectRoot: data.projectRoot,
        branch: data.branch,
        status,
        updatedAt: data.updatedAt,
        fileSize: data.summary.fileSize ?? 0,
        app: appOf(data.summary.origin),
        archivedSince: since,
        keep: keepReason(deletionState(data, holds)),
        data,
      },
    ];
  });
}

/** Rows that can't be picked (dimmed, with the reason as the checkbox's tooltip): pinned, working, needing you. */
export function lockReason(row: ManagerRow): string | null {
  if (row.status === 'pinned') return 'Pinned sessions are kept. Unpin it first.';
  if (row.status === 'working') return 'It is working. Wait until it finishes.';
  if (row.status === 'needs-you') return 'It needs you. Answer it first.';
  return null;
}

/** The rows that match every filter, newest first. `projectName` makes the text filter find a project by name. */
export function filterRows(rows: readonly ManagerRow[], filters: ManagerFilters, now: number, projectName: (root: string) => string): ManagerRow[] {
  const needle = filters.query.trim().toLowerCase();
  return rows
    .filter((row) => {
      if (filters.review && !filters.review.ids.has(row.id)) return false;
      if (filters.project && row.projectRoot !== filters.project) return false;
      if (filters.app !== 'all' && row.app !== filters.app) return false;
      if (filters.status === 'listed' && !(row.status === 'listed' || row.status === 'working' || row.status === 'needs-you')) return false;
      if (filters.status === 'archived' && row.status !== 'archived') return false;
      if (filters.status === 'pinned' && row.status !== 'pinned') return false;
      const age = now - row.updatedAt;
      if (filters.time === 'week' && age > 7 * DAY_MS) return false;
      if (filters.time === 'month' && age > 30 * DAY_MS) return false;
      if (filters.time === 'older' && age <= 30 * DAY_MS) return false;
      if (needle) {
        const hay = [row.title, row.branch ?? '', row.projectRoot, projectName(row.projectRoot)].join('\n').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export interface MonthGroup {
  /** `2026-08`, for keys and hooks. */
  key: string;
  label: string;
  rows: ManagerRow[];
  bytes: number;
}

/** "August" in the current year, "August 2025" before it. */
export function monthLabel(timestamp: number, now: number): string {
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' });
}

/** Rows (newest first) grouped by the month of their last activity, newest month first. */
export function groupByMonth(rows: readonly ManagerRow[], now: number): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const row of rows) {
    const date = new Date(row.updatedAt);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    let group = groups.at(-1);
    if (!group || group.key !== key) {
      group = groups.find((g) => g.key === key);
      if (!group) groups.push((group = { key, label: monthLabel(row.updatedAt, now), rows: [], bytes: 0 }));
    }
    group.rows.push(row);
    group.bytes += row.fileSize;
  }
  return groups.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}

/** A month's checkbox: every pickable row of it picked, some, or none. */
export function groupState(group: MonthGroup, selected: ReadonlySet<string>): boolean | 'mixed' {
  const pickable = group.rows.filter((row) => !lockReason(row));
  const picked = pickable.filter((row) => selected.has(row.id)).length;
  if (picked === 0) return false;
  return picked === pickable.length ? true : 'mixed';
}

/** The month's checkbox clicked: picks its pickable rows (the ones the filters show), or takes them all away when all were picked. */
export function toggleGroup(group: MonthGroup, selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  const pickable = group.rows.filter((row) => !lockReason(row));
  const all = groupState(group, selected) === true;
  for (const row of pickable) {
    if (all) next.delete(row.id);
    else next.add(row.id);
  }
  return next;
}

/** The line under All sessions: how many, their size, how many are archived and for how long. */
export function overviewSummary(rows: readonly ManagerRow[], now: number): { count: number; bytes: number; archived: number; archivedLong: number } {
  let bytes = 0;
  let archived = 0;
  let archivedLong = 0;
  for (const row of rows) {
    bytes += row.fileSize;
    if (row.archivedSince === null) continue;
    archived++;
    if (now - row.archivedSince > 30 * DAY_MS) archivedLong++;
  }
  return { count: rows.length, bytes, archived, archivedLong };
}

/** What moving some sessions to the Trash does: what goes (by project, biggest first) and what stays, and why. */
export interface DeletePlan {
  going: ManagerRow[];
  bytes: number;
  byProject: Array<{ root: string; count: number; bytes: number }>;
  kept: Array<{ row: ManagerRow; reason: KeepReason }>;
}

export function deletePlan(rows: readonly ManagerRow[]): DeletePlan {
  const going: ManagerRow[] = [];
  const kept: DeletePlan['kept'] = [];
  const projects = new Map<string, { root: string; count: number; bytes: number }>();
  for (const row of rows) {
    if (row.keep) {
      kept.push({ row, reason: row.keep });
      continue;
    }
    going.push(row);
    const entry = projects.get(row.projectRoot) ?? { root: row.projectRoot, count: 0, bytes: 0 };
    entry.count++;
    entry.bytes += row.fileSize;
    projects.set(row.projectRoot, entry);
  }
  return { going, bytes: going.reduce((sum, row) => sum + row.fileSize, 0), byProject: [...projects.values()].sort((a, b) => b.count - a.count || b.bytes - a.bytes), kept };
}

/** The archived sessions deleting would move to the Trash today, with these settings (the engine's rule). */
export function dueToday(rows: readonly ManagerRow[], now: number, archiveAfterDays: number, afterDays: number): ManagerRow[] {
  const holdsOf = (row: ManagerRow): DeletionState => ({
    pinned: row.data.pinned,
    working: row.status === 'working',
    needsYou: row.status === 'needs-you',
    openElsewhere: row.keep === 'open-elsewhere',
    queued: row.keep === 'queued',
    draft: row.keep === 'draft',
  });
  return dueForDeletion(
    rows.map((row) => ({ id: row.id, row, listing: rowListing(row.data), deletion: holdsOf(row) })),
    { now, archiveAfterDays, afterDays },
  ).due.map((c) => c.row);
}

/** How many more go once deleting is on: about how many a day, from the sessions archived in the last 30 days. */
export function paceText(rows: readonly ManagerRow[], now: number): string {
  const recent = rows.filter((row) => row.archivedSince !== null && now - row.archivedSince <= 30 * DAY_MS).length;
  const perDay = recent / 30;
  if (perDay >= 2.5) return `about ${Math.round(perDay)} a day`;
  if (perDay >= 0.75) return 'about one or two a day';
  if (perDay >= 1 / 7) return 'a few a week';
  if (recent > 0) return 'a few a month';
  return 'only as sessions get archived';
}

/** "is pinned" as a count: "2 pinned", "1 with an unsent message". */
export const KEEP_COUNT_TEXT: Record<KeepReason, string> = {
  pinned: 'pinned',
  working: 'working',
  'needs-you': 'waiting for you',
  'open-elsewhere': 'open in another window',
  queued: 'with a queued prompt',
  draft: 'with an unsent message',
};

/** What the confirmation says stays: "Release checklist is pinned." or "3 sessions: 2 pinned, 1 with an unsent message." */
export function keptLine(kept: DeletePlan['kept']): string | null {
  if (kept.length === 0) return null;
  if (kept.length === 1) return `${kept[0]!.row.title} ${KEEP_REASON_TEXT[kept[0]!.reason]}.`;
  const counts = new Map<KeepReason, number>();
  for (const { reason } of kept) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return `${kept.length} sessions: ${[...counts].map(([reason, count]) => `${count} ${KEEP_COUNT_TEXT[reason]}`).join(', ')}.`;
}
