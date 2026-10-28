import { archivedSince as archivedSinceOf, listedInMainList, type ListingState, type SessionScope, type SidebarSort, type StartupView } from '@seshboard/protocol/bridge';
import type { QueueEntry } from './queue.ts';
import type { SessionRowData } from './sessionsStore.ts';
import type { SectionKey } from './sidebarSections.ts';

/** What the status icon on a row shows, most urgent first. */
export type RowStatus = 'needs-you' | 'running' | 'error' | 'unread' | 'background' | 'idle' | null;

/**
 * What the pipelines tree (`pipelineTree.ts`) adds to a parent's row: its state with its sub-sessions' and its run's,
 * so a child that needs you makes the parent Needs you, in its group, its rail and its icon.
 */
export interface TreeFacts {
  treeStatus?: RowStatus;
}

/** A parent's state with its sub-sessions', when the tree lifted it. */
const liftedStatus = (row: SessionRowData): RowStatus | undefined => (row as SessionRowData & TreeFacts).treeStatus;

export function rowStatus(row: SessionRowData): RowStatus {
  const lifted = liftedStatus(row);
  if (lifted !== undefined) return lifted;
  // Another computer says how its sessions are (`remoteRowStatus`).
  if (row.remote) return row.remote.status;
  if (row.live?.status === 'needs-you') return 'needs-you';
  if (row.live?.status === 'running') return 'running';
  if (row.error) return 'error';
  if (row.unread) return 'unread';
  // Idle between turns, but a background command or agent is still working.
  if (row.live?.status === 'idle' && row.live.background?.length) return 'background';
  if (row.live?.status === 'idle') return 'idle';
  return null;
}

/** Whether the sidebar (and the palette) list a session under the chosen scope. */
export const inScope = (row: SessionRowData, scope: SessionScope) => scope === 'all' || row.inApp;

/**
 * The session a new window opens with, or null for New session: the one open last time, but only
 * while the sidebar lists it (a session from another app stays hidden while those are).
 */
export function startupSession(rows: SessionRowData[], lastId: unknown, startupView: StartupView, scope: SessionScope): string | null {
  if (startupView !== 'last' || typeof lastId !== 'string') return null;
  const last = rows.find((row) => row.id === lastId);
  return last && inScope(last, scope) ? last.id : null;
}

/** What the archive rule reads from a row (`listedInMainList`, shared with the VS Code companion and the engine). */
export function rowListing(row: SessionRowData): ListingState {
  const lifted = liftedStatus(row);
  return {
    attention: lifted === 'needs-you' || row.live?.status === 'needs-you' || row.error,
    working: lifted === 'running' || row.live?.status === 'running',
    pinned: row.pinned,
    archivedAt: row.archivedAt,
    restoredAt: row.restoredAt,
    unread: row.unread,
    updatedAt: row.updatedAt,
    // Open in Seshboard counts; a process idling elsewhere doesn't (Claude desktop reopens many old sessions at
    // launch, and they shouldn't all come back).
    openInApp: row.live?.origin === 'app',
  };
}

/**
 * Main list or "Archived"? Anything that wants attention (working, waiting, failed, unread, open in Seshboard) or
 * is pinned stays up. Archiving by hand hides a session until it has new activity; otherwise sessions are archived
 * after `archiveAfterDays` (Settings › Sessions). Unarchiving by hand keeps a session up until it has new activity;
 * then the days count from there.
 */
export function isActive(row: SessionRowData, now: number, archiveAfterDays: number): boolean {
  // Another computer only lists what its own sidebar does, outside Archived. A pipeline's run row follows the same rule
  // as a session, with its tree's newest activity (`sidebarForest`).
  if (row.remote) return true;
  return listedInMainList(rowListing(row), now, archiveAfterDays);
}

/** When an archived row went to Archived (by hand, or its last activity plus the archive days); null while it is listed. */
export const archivedSince = (row: SessionRowData, now: number, archiveAfterDays: number): number | null => archivedSinceOf(rowListing(row), now, archiveAfterDays);

/**
 * Whether a middle-click on the row archives it: an indexed session in the main list that has finished
 * (idle, unread or closed). Work in progress, a question, a failure or an archived row stay as they are.
 */
export function archivesOnMiddleClick(row: SessionRowData, now: number, archiveAfterDays: number): boolean {
  const status = rowStatus(row);
  return (row.summary !== null || row.remote != null) && !row.remote?.offline && (status === null || status === 'idle' || status === 'unread') && isActive(row, now, archiveAfterDays);
}

export interface SessionListOptions {
  search: string;
  /** Only this project folder; null = all. */
  project: string | null;
  now: number;
  /** Settings › Sessions: finished sessions are archived after this many days. */
  archiveAfterDays: number;
  /** Default: every session. */
  scope?: SessionScope;
  /** Each parent's sub-sessions (`pipelineTree.ts`): a parent matches a search when one of them does. */
  children?: ReadonlyMap<string, readonly SessionRowData[]>;
}

const matches = (row: SessionRowData, needle: string) =>
  row.title.toLowerCase().includes(needle) ||
  (row.remote
    ? row.remote.projectName.toLowerCase().includes(needle) || row.remote.computerName.toLowerCase().includes(needle)
    : row.projectRoot.toLowerCase().includes(needle)) ||
  (row.branch?.toLowerCase().includes(needle) ?? false);

/** Splits sessions into the main list (pinned first, then newest) and the archived list (newest first). */
export function buildSessionList(
  rows: readonly SessionRowData[],
  options: SessionListOptions,
): { active: SessionRowData[]; archived: SessionRowData[] } {
  const needle = options.search.trim().toLowerCase();
  const active: SessionRowData[] = [];
  const archived: SessionRowData[] = [];
  for (const row of rows) {
    if (options.scope && !inScope(row, options.scope)) continue;
    if (options.project && row.projectRoot !== options.project) continue;
    if (needle && !matches(row, needle) && !options.children?.get(row.id)?.some((child) => matches(child, needle))) continue;
    (isActive(row, options.now, options.archiveAfterDays) ? active : archived).push(row);
  }
  active.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  archived.sort((a, b) => b.updatedAt - a.updatedAt);
  return { active, archived };
}

/**
 * The sections of the main list, in the order they show. Recent: what needs attention first, then pinned, then by time.
 * Quickest to unblock: what needs you or a review (quickest first), then what you've read, then what is still working.
 */
export type SessionGroup = 'needs-you' | 'working' | 'pinned' | 'today' | 'yesterday' | 'earlier' | 'review' | 'read' | 'still-working';

export const GROUP_LABEL: Record<SessionGroup, string> = {
  'needs-you': 'Needs you',
  working: 'Working',
  pinned: 'Pinned',
  today: 'Today',
  yesterday: 'Yesterday',
  earlier: 'Earlier',
  review: 'Needs review · quickest first',
  read: 'Read',
  'still-working': 'Still working',
};

const GROUP_ORDER: readonly SessionGroup[] = ['needs-you', 'working', 'pinned', 'today', 'yesterday', 'earlier'];

/** Local midnight of the day `now` falls on, so "Today" matches the calendar rather than the last 24 hours. */
export function startOfDay(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Which section a main-list session sits in. A pinned session that waits on you or is working shows
 * there, like any other, and goes back to Pinned when it's done.
 */
export function sessionGroup(row: SessionRowData, now: number): SessionGroup {
  const status = rowStatus(row);
  if (status === 'needs-you') return 'needs-you';
  if (status === 'running') return 'working';
  if (row.pinned) return 'pinned';
  const today = startOfDay(now);
  if (row.updatedAt >= today) return 'today';
  // The day before today; a day can be 23 or 25 hours long across a clock change, hence the second midnight.
  if (row.updatedAt >= startOfDay(today - 1)) return 'yesterday';
  return 'earlier';
}

/**
 * When a working session's turn began: when you last sent it a message (Claude Code's registry: when it
 * went busy). The Working list orders by this rather than by the last write, which moves all the time.
 */
export const workingSince = (row: SessionRowData): number => row.live?.updatedAt ?? row.live?.startedAt ?? row.remote?.workingSince ?? row.updatedAt;

/** Working sessions, pinned first, then the one you set going last. */
export const byWorkingSince = (a: SessionRowData, b: SessionRowData): number => Number(b.pinned) - Number(a.pinned) || workingSince(b) - workingSince(a);

/**
 * Splits the main list into its sections, skipping empty ones. The order inside a section is the
 * order given (buildSessionList puts pinned sessions first, then newest), so pins stay on top of Needs you.
 * Working is the exception: it keeps the order you started its sessions in (`byWorkingSince`).
 */
export function groupSessions(active: readonly SessionRowData[], now: number): { group: SessionGroup; rows: SessionRowData[] }[] {
  const buckets = new Map<SessionGroup, SessionRowData[]>();
  for (const row of active) {
    const group = sessionGroup(row, now);
    const bucket = buckets.get(group);
    if (bucket) bucket.push(row);
    else buckets.set(group, [row]);
  }
  buckets.get('working')?.sort(byWorkingSince);
  return GROUP_ORDER.flatMap((group) => {
    const rows = buckets.get(group);
    return rows ? [{ group, rows }] : [];
  });
}

/** What the quickest-to-unblock order needs to know of a session's catch-up. */
export interface QuickInfo {
  reviewMinutes: number;
  testsFailed: boolean;
}

/** Where a row stands in the quickest-to-unblock order: waiting for you, finished and unread (or failed), read, working. */
function quickTier(row: SessionRowData): 0 | 1 | 2 | 3 {
  const status = rowStatus(row);
  if (status === 'needs-you') return 0;
  if (status === 'running' || status === 'background') return 3;
  if (status === 'unread' || status === 'error') return 1;
  return 2;
}

/**
 * The main list as Quickest to unblock ranks it: sessions waiting for you, then finished ones you haven't read, each by
 * how long their review takes (failing tests last among equal times, a session without a catch-up after those with one),
 * then the ones you've read (newest first), then those still working (in the order you started them). The Queue and
 * Pinned only show in Recent: here pinned sessions are ranked like the rest.
 */
export function quickestGroups(active: readonly SessionRowData[], quick: ReadonlyMap<string, QuickInfo>): { group: SessionGroup; rows: SessionRowData[] }[] {
  const minutes = (row: SessionRowData) => quick.get(row.id)?.reviewMinutes ?? (quickTier(row) === 0 ? 1 : Number.POSITIVE_INFINITY);
  const review = active.filter((row) => quickTier(row) <= 1);
  review.sort(
    (a, b) =>
      quickTier(a) - quickTier(b) ||
      minutes(a) - minutes(b) ||
      Number(quick.get(a.id)?.testsFailed ?? false) - Number(quick.get(b.id)?.testsFailed ?? false) ||
      b.updatedAt - a.updatedAt,
  );
  const read = active.filter((row) => quickTier(row) === 2).sort((a, b) => b.updatedAt - a.updatedAt);
  const working = active.filter((row) => quickTier(row) === 3).sort(byWorkingSince);
  return [
    { group: 'review' as const, rows: review },
    { group: 'read' as const, rows: read },
    { group: 'still-working' as const, rows: working },
  ].filter((g) => g.rows.length > 0);
}

/** The main list's sections in the chosen order. */
export function groupsFor(active: readonly SessionRowData[], now: number, sort: SidebarSort = 'recent', quick: ReadonlyMap<string, QuickInfo> = new Map()) {
  return sort === 'quickest' ? quickestGroups(active, quick) : groupSessions(active, now);
}

/**
 * One row of the virtualised sidebar list: a session, a section header, the queue's header and its items,
 * the "+N hidden" line under a closed section's kept row, or the Archived header (only while it's in the list).
 */
export type SidebarListRow =
  | {
      kind: 'session';
      data: SessionRowData;
      archived: boolean;
      kept?: boolean;
      /** A parent in the pipelines tree: whether its sub-sessions show, and how many it has. */
      parent?: { open: boolean; count: number };
      /** A sub-session, under its parent: its place among its siblings (from 1). */
      child?: { parentId: string; position: number; count: number; level: number };
    }
  | { kind: 'group'; group: SessionGroup; count: number; first: boolean; open: boolean; unread: number }
  | { kind: 'hidden'; group: SessionGroup; count: number }
  | { kind: 'queue-header'; count: number; ready: number; open: boolean; first: boolean }
  | { kind: 'queue'; entry: QueueEntry }
  | { kind: 'archived'; count: number; open: boolean };

export interface ListRowOptions {
  now: number;
  /** Archived is listed (open, or a search shows its matches). Closed, its header is docked under the list instead. */
  archivedOpen: boolean;
  /** The queue as the sidebar lists it (filters applied), with how many are ready. Left out or empty: no Queue section. */
  queue?: { entries: readonly QueueEntry[]; ready: number };
  /** Closed sections: their header stays (with its count), their rows go. */
  closed?: ReadonlySet<SectionKey>;
  /** The open session: its row stays under its section's header even while the section is closed. */
  selectedId?: string | null;
  /** The order (Recent by default) and, for Quickest to unblock, each session's review time. */
  sort?: SidebarSort;
  quick?: ReadonlyMap<string, QuickInfo>;
  /** The pipelines tree: each parent's sub-sessions, and the parents that are open (closed by default). */
  children?: ReadonlyMap<string, readonly SessionRowData[]>;
  openParents?: ReadonlySet<string>;
}

/**
 * The flat row list the sidebar virtualises: each non-empty section under its header, the Queue right under
 * Working (when it has items), then Archived while it's open. A closed section keeps its header and, when the open
 * session is in it, that session's row with a "+N hidden" line.
 */
export function buildListRows(active: readonly SessionRowData[], archived: readonly SessionRowData[], options: ListRowOptions): SidebarListRow[] {
  const list: SidebarListRow[] = [];
  const closed = options.closed ?? new Set<SectionKey>();
  const children = options.children ?? new Map<string, readonly SessionRowData[]>();
  const openParents = options.openParents ?? new Set<string>();
  // A row, and under it (when it is an open parent) its sub-sessions, theirs too. `seen` stops a loop of parents.
  const pushSession = (data: SessionRowData, archived: boolean, kept: boolean, seen: Set<string> = new Set()) => {
    const kids = seen.has(data.id) ? [] : (children.get(data.id) ?? []);
    const open = kids.length > 0 && openParents.has(data.id);
    list.push({ kind: 'session', data, archived, ...(kept ? { kept: true } : {}), ...(kids.length ? { parent: { open, count: kids.length } } : {}) });
    if (!open) return;
    seen.add(data.id);
    kids.forEach((kid, i) => {
      const at = list.length;
      pushSession(kid, archived, false, seen);
      const row = list[at];
      if (row?.kind === 'session') row.child = { parentId: data.id, position: i + 1, count: kids.length, level: seen.size + 1 };
    });
    seen.delete(data.id);
  };
  // The Queue only shows in Recent.
  const queue = options.sort === 'quickest' ? undefined : options.queue;
  const pushQueue = () => {
    if (!queue || queue.entries.length === 0) return;
    const open = !closed.has('queue');
    list.push({ kind: 'queue-header', count: queue.entries.length, ready: queue.ready, open, first: list.length === 0 });
    if (open) for (const entry of queue.entries) list.push({ kind: 'queue', entry });
  };
  let queued = false;
  for (const { group, rows } of groupsFor(active, options.now, options.sort, options.quick)) {
    // The queue goes under Working, or where Working would be.
    if (!queued && group !== 'needs-you' && group !== 'working') {
      pushQueue();
      queued = true;
    }
    const open = group === 'needs-you' || group === 'review' || !closed.has(group);
    const unread = rows.filter((row) => rowStatus(row) === 'unread').length;
    list.push({ kind: 'group', group, count: rows.length, first: list.length === 0, open, unread });
    if (open) {
      for (const data of rows) pushSession(data, false, false);
    } else {
      // The open session, or the parent of the open sub-session.
      const kept = rows.find((row) => row.id === options.selectedId || children.get(row.id)?.some((child) => child.id === options.selectedId));
      if (kept) {
        pushSession(kept, false, true);
        if (rows.length > 1) list.push({ kind: 'hidden', group, count: rows.length - 1 });
      }
    }
    if (group === 'working') {
      pushQueue();
      queued = true;
    }
  }
  if (!queued) pushQueue();
  if (archived.length && options.archivedOpen) {
    list.push({ kind: 'archived', count: archived.length, open: true });
    for (const data of archived) pushSession(data, true, false);
  }
  return list;
}

/**
 * Where the Archived header goes: docked under the list while it's closed, so a short list never scrolls and leaves
 * no gap; in the list, right under the last active row, while it's open or a search shows its matches.
 */
export function archivedPlacement(count: number, options: { open: boolean; searching: boolean }): 'dock' | 'list' | null {
  if (count === 0) return null;
  return options.open || options.searching ? 'list' : 'dock';
}

/**
 * Where to scroll the list after Archived opens: its header about 8px from the top, but only when it landed below
 * the middle of the viewport. Null leaves the list where it is. `headerTop` is the header's offset in the list.
 */
export function archivedRevealTop(headerTop: number, view: { scrollTop: number; height: number; maxScroll: number }, margin = 8): number | null {
  if (headerTop - view.scrollTop <= view.height / 2) return null;
  return Math.max(0, Math.min(view.maxScroll, headerTop - margin));
}

/** What a closed (or the Queue's) header says next to its count, in the state's colour: "1 ready", "2 unread". */
export function headerSummary(row: Extract<SidebarListRow, { kind: 'group' | 'queue-header' }>): { text: string; tone: 'ok' | 'unread' } | null {
  if (row.kind === 'queue-header') return row.ready > 0 ? { text: `${row.ready} ready`, tone: 'ok' } : null;
  if (row.open || row.group === 'working' || row.group === 'still-working' || row.group === 'needs-you' || row.group === 'review' || row.unread === 0) return null;
  return { text: `${row.unread} unread`, tone: 'unread' };
}

/**
 * The section a session sits in (its group), so opening it can open a closed section. Null for an archived one. A
 * pipeline's sub-session sits in its parent's section.
 */
export function sectionOfSession(rows: readonly SessionRowData[], id: string, now: number, archiveAfterDays: number): SessionGroup | null {
  const own = rows.find((r) => r.id === id);
  const parentId = own?.summary?.parentId;
  const row = (parentId && rows.find((r) => r.id === parentId)) || own;
  return row && isActive(row, now, archiveAfterDays) ? sessionGroup(row, now) : null;
}

/** What a waiting session asks for, in a few words for its row: the question, a plan, or the tool it wants to run. */
export function waitingLabel(toolName: string | null): string {
  if (toolName === null) return 'Waiting for you';
  if (toolName === 'AskUserQuestion') return 'Question';
  if (toolName === 'ExitPlanMode') return 'Plan to review';
  return `Permission: ${toolName}`;
}

/** The key of a header row in the list: its group, or 'archived'. */
export type HeaderKey = SessionGroup | 'archived';

/** The sessions under each header, in list order: what ⌘A and a header's "Select all" pick. */
export function sessionsByHeader(rows: readonly SidebarListRow[]): Map<HeaderKey, string[]> {
  const map = new Map<HeaderKey, string[]>();
  let ids: string[] | null = null;
  for (const row of rows) {
    if (row.kind === 'session') ids?.push(row.data.id);
    else if (row.kind === 'group' || row.kind === 'archived') map.set(row.kind === 'group' ? row.group : 'archived', (ids = []));
    // Queued prompts aren't sessions: nothing under the Queue header can be picked.
    else if (row.kind === 'queue-header') ids = null;
  }
  return map;
}
