import type { SidebarSort } from '@seshboard/protocol/bridge';
import type { QueueEntry } from './queue.ts';
import type { SessionRowData } from './sessionsStore.ts';
import { byWorkingSince, quickTier, rowStatus, sessionPusher, workingSince, type ProjectState, type ProjectSummaryPart, type QuickInfo, type SidebarListRow } from './sidebarRows.ts';

/** What a session counts as in its project: needs you, working, to review (unread, failed or a reminder that came due), or open. */
export function projectState(row: SessionRowData): ProjectState {
  const status = rowStatus(row);
  if (status === 'needs-you') return 'needs-you';
  if (status === 'running') return 'working';
  if (status === 'unread' || status === 'error' || (!row.remote && row.summary?.remindedAt != null)) return 'review';
  return 'open';
}

const STATE_ORDER: readonly ProjectState[] = ['needs-you', 'working', 'review', 'open'];
const STATE_WORDS: Record<ProjectState, string> = { 'needs-you': 'needs you', working: 'working', review: 'to review', open: 'open' };

/** A folded project's line: "1 needs you · 2 working", "3 to review". A state with nothing is left out. */
export function projectSummary(rows: readonly SessionRowData[]): ProjectSummaryPart[] {
  const counts = new Map<ProjectState, number>();
  for (const row of rows) counts.set(projectState(row), (counts.get(projectState(row)) ?? 0) + 1);
  return STATE_ORDER.flatMap((state) => {
    const count = counts.get(state) ?? 0;
    return count ? [{ state, count, text: `${count} ${STATE_WORDS[state]}` }] : [];
  });
}

export const projectSummaryText = (parts: readonly ProjectSummaryPart[]): string => parts.map((part) => part.text).join(' · ');

/**
 * A project's sessions in the order they show: needs you, working, to review, then open. Recent puts pinned sessions
 * first in each state, then the newest (working: the one you set going last). Quickest to unblock puts the quickest
 * review first, as the list grouped by state does, and ranks pinned sessions like the rest.
 */
export function sortInProject(rows: readonly SessionRowData[], sort: SidebarSort, quick: ReadonlyMap<string, QuickInfo>): SessionRowData[] {
  const minutes = (row: SessionRowData) => quick.get(row.id)?.reviewMinutes ?? (projectState(row) === 'needs-you' ? 1 : Number.POSITIVE_INFINITY);
  const within = (state: ProjectState) => (a: SessionRowData, b: SessionRowData) => {
    if (state === 'working') return sort === 'quickest' ? workingSince(b) - workingSince(a) : byWorkingSince(a, b);
    if (sort === 'quickest' && state !== 'open')
      return minutes(a) - minutes(b) || Number(quick.get(a.id)?.testsFailed ?? false) - Number(quick.get(b.id)?.testsFailed ?? false) || b.updatedAt - a.updatedAt;
    return (sort === 'quickest' ? 0 : Number(b.pinned) - Number(a.pinned)) || b.updatedAt - a.updatedAt;
  };
  return STATE_ORDER.flatMap((state) => rows.filter((row) => projectState(row) === state).sort(within(state)));
}

/** A project's group: its key (the folder, or a remote project's key), its name, and its computer when it is on another one. */
interface ProjectGroup {
  key: string;
  name: string;
  remote: { computerId: string; computerName: string; offline: boolean } | null;
  rows: SessionRowData[];
  queued: QueueEntry[];
}

/** Ranks a project for Quickest to unblock: its quickest session (needs you, then to review by time, then read, then working). */
function quickRank(rows: readonly SessionRowData[], quick: ReadonlyMap<string, QuickInfo>): [number, number] {
  let best: [number, number] = [4, Number.POSITIVE_INFINITY];
  for (const row of rows) {
    const tier = quickTier(row);
    const minutes = tier <= 1 ? (quick.get(row.id)?.reviewMinutes ?? (tier === 0 ? 1 : Number.POSITIVE_INFINITY)) : 0;
    if (tier < best[0] || (tier === best[0] && minutes < best[1])) best = [tier, minutes];
  }
  return best;
}

/** The order of projects: those with a session that needs you first, then by the chosen sort, then by name. */
export function compareProjects(sort: SidebarSort, quick: ReadonlyMap<string, QuickInfo>) {
  const needsYou = (group: ProjectGroup) => group.rows.some((row) => projectState(row) === 'needs-you');
  const newest = (group: ProjectGroup) => Math.max(Number.NEGATIVE_INFINITY, ...group.rows.map((row) => Math.max(row.updatedAt, projectState(row) === 'working' ? workingSince(row) : 0)));
  return (a: ProjectGroup, b: ProjectGroup): number => {
    const urgent = Number(needsYou(b)) - Number(needsYou(a));
    if (urgent) return urgent;
    if (sort === 'quickest') {
      const [ta, ma] = quickRank(a.rows, quick);
      const [tb, mb] = quickRank(b.rows, quick);
      if (ta !== tb) return ta - tb;
      if (ma !== mb) return ma - mb;
    } else {
      const na = newest(a);
      const nb = newest(b);
      if (na !== nb) return nb - na;
    }
    return a.name.localeCompare(b.name) || (a.remote?.computerName ?? '').localeCompare(b.remote?.computerName ?? '');
  };
}

export interface ProjectRowOptions {
  /** A local project's name from its folder (the remote ones carry theirs). */
  nameOf(root: string): string;
  /** Folded projects, by key. Ignored while searching: every project unfolds. */
  folded?: ReadonlySet<string>;
  searching?: boolean;
  /** The open session: its row stays under its project's header while the project is folded. */
  selectedId?: string | null;
  sort?: SidebarSort;
  quick?: ReadonlyMap<string, QuickInfo>;
  /** The pipelines tree: each parent's sub-sessions, and the parents that are open. */
  children?: ReadonlyMap<string, readonly SessionRowData[]>;
  openParents?: ReadonlySet<string>;
  /** Queued prompts (filters applied): each goes into its project, under a "Queued" label. */
  queue?: readonly QueueEntry[];
  /** Done is listed (open, or a search shows its matches). Closed, its header is docked under the list. */
  archivedOpen: boolean;
  /** Snoozed sessions a search finds, under Snoozed, before Done. */
  snoozed?: readonly SessionRowData[];
}

/**
 * The sidebar's rows grouped by project: each project's header, then its sessions (needs you, working, the queue, to
 * review, open). A folded project keeps its header, a line that says what is in it, and the open session's row. Done
 * and Snoozed come after the projects, as in the list grouped by state.
 */
export function buildProjectRows(active: readonly SessionRowData[], archived: readonly SessionRowData[], options: ProjectRowOptions): SidebarListRow[] {
  const sort = options.sort ?? 'recent';
  const quick = options.quick ?? new Map<string, QuickInfo>();
  const children = options.children ?? new Map<string, readonly SessionRowData[]>();
  const openParents = options.openParents ?? new Set<string>();
  const groups = new Map<string, ProjectGroup>();
  const groupOf = (key: string, make: () => Omit<ProjectGroup, 'rows' | 'queued'>) => {
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { ...make(), rows: [], queued: [] }));
    return group;
  };
  for (const row of active) {
    const remote = row.remote;
    groupOf(row.projectRoot, () => ({
      key: row.projectRoot,
      name: remote ? remote.projectName : options.nameOf(row.projectRoot),
      remote: remote ? { computerId: remote.computerId, computerName: remote.computerName, offline: remote.offline ?? false } : null,
    })).rows.push(row);
  }
  for (const entry of options.queue ?? []) groupOf(entry.item.cwd, () => ({ key: entry.item.cwd, name: options.nameOf(entry.item.cwd), remote: null })).queued.push(entry);
  // A project with the same name on two computers is two groups: the one on another computer says which ("intranet · mystic").
  const names = new Map<string, number>();
  for (const group of groups.values()) names.set(group.name, (names.get(group.name) ?? 0) + 1);
  const label = (group: ProjectGroup) => (group.remote && (names.get(group.name) ?? 0) > 1 ? `${group.name} · ${group.remote.computerName}` : group.name);

  const list: SidebarListRow[] = [];
  for (const group of [...groups.values()].sort(compareProjects(sort, quick))) {
    const rows = sortInProject(group.rows, sort, quick);
    const open = options.searching || !options.folded?.has(group.key);
    list.push({ kind: 'project', key: group.key, name: label(group), remote: group.remote, count: rows.length, open, first: list.length === 0 });
    const push = sessionPusher(list, children, openParents, group.key);
    if (!open) {
      const parts = projectSummary(rows);
      if (parts.length) list.push({ kind: 'project-summary', key: group.key, parts });
      // The open session, or the parent of the open sub-session.
      const kept = rows.find((row) => row.id === options.selectedId || children.get(row.id)?.some((child) => child.id === options.selectedId));
      if (kept) push(kept, false, true);
      continue;
    }
    let queued = group.queued.length === 0;
    for (const row of rows) {
      // The queue goes after what needs you and what is working.
      if (!queued && projectState(row) !== 'needs-you' && projectState(row) !== 'working') {
        pushQueued(list, group);
        queued = true;
      }
      push(row, false, false);
    }
    if (!queued) pushQueued(list, group);
  }
  if (options.snoozed?.length) {
    list.push({ kind: 'group', group: 'snoozed', count: options.snoozed.length, first: list.length === 0, open: true, unread: 0 });
    const push = sessionPusher(list, children, openParents);
    for (const data of options.snoozed) push(data, false, false);
  }
  if (archived.length && options.archivedOpen) {
    list.push({ kind: 'archived', count: archived.length, open: true });
    const push = sessionPusher(list, children, openParents);
    for (const data of archived) push(data, true, false);
  }
  return list;
}

function pushQueued(list: SidebarListRow[], group: ProjectGroup) {
  list.push({ kind: 'queue-label', key: group.key, count: group.queued.length });
  for (const entry of group.queued) list.push({ kind: 'queue', entry });
}

/** The project a session is listed under while the sidebar groups by project: its own, or its pipeline parent's. */
export function projectOfSession(rows: readonly SessionRowData[], id: string): string | null {
  const own = rows.find((r) => r.id === id);
  const parentId = own?.summary?.parentId;
  const row = (parentId && rows.find((r) => r.id === parentId)) || own;
  return row?.projectRoot ?? null;
}
