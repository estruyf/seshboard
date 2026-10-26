import { isSameOrInside, type WorktreeEntry, type WorktreeSize } from '@seshboard/protocol/client';

// The worktree overview's decisions, without React or the stores: which group each worktree is in and why, which
// rows can be picked for clean-up, what a selection frees, and the words the table and its summary use.

/** No activity for this many days, and a pushed worktree counts as probably done. */
export const INACTIVE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The table's groups, in the order they show. */
export type WorktreeGroup = 'main' | 'safe' | 'done' | 'keep' | 'stale';
export const GROUP_ORDER: readonly WorktreeGroup[] = ['main', 'safe', 'done', 'keep', 'stale'];

export const GROUP_LABEL: Record<Exclude<WorktreeGroup, 'main'>, string> = { safe: 'Safe to remove', done: 'Probably done', keep: 'Keep', stale: 'Stale' };
export const GROUP_NOTE: Record<Exclude<WorktreeGroup, 'main'>, string> = {
  safe: 'merged or no extra commits, clean, no session',
  done: `pushed, clean, inactive ${INACTIVE_DAYS}+ days`,
  keep: '',
  stale: 'folder is gone; git still lists it',
};

/** How the sessions in a worktree stand, from the sidebar's rows. */
export interface WorktreeSessions {
  /** Sessions working there (or waiting for you). */
  busy: number;
  /** Of those, the ones waiting for you. */
  needsYou: number;
  /** A Claude Code process is open there, idle. */
  open: number;
  total: number;
}
export const NO_SESSIONS: WorktreeSessions = { busy: 0, needsYou: 0, open: 0, total: 0 };

export interface WorktreeRow {
  entry: WorktreeEntry;
  group: WorktreeGroup;
  /** Why it is kept (Keep only): the first reason that applies. */
  reason: string | null;
  /** Why it can't be picked for clean-up, or null when it can. */
  locked: string | null;
  sessions: WorktreeSessions;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Merged by ancestry, or its pull request was merged (a squash merge leaves the branch's own commits behind). */
export const isMerged = (entry: WorktreeEntry) => entry.merged || entry.pr?.state === 'merged';

/** Why a worktree can't be picked for clean-up; null when it can. The engine refuses the same. */
export function lockReason(entry: WorktreeEntry, sessions: WorktreeSessions): string | null {
  if (entry.isMain) return 'The main checkout is never removed';
  if (entry.isLocked) return `Locked by git${entry.lockReason ? `: ${entry.lockReason}` : ''}`;
  if (entry.missing) return null;
  if (sessions.busy > 0) return 'A session is working here';
  if (entry.uncommitted > 0) return `${plural(entry.uncommitted, 'uncommitted change', 'uncommitted changes')}: commit or revert first`;
  return null;
}

/** Which group a worktree belongs in, and (for Keep) the reason. */
export function classify(entry: WorktreeEntry, sessions: WorktreeSessions, now: number, inactiveDays = INACTIVE_DAYS): { group: WorktreeGroup; reason: string | null } {
  if (entry.isMain) return { group: 'main', reason: null };
  if (entry.missing) return { group: 'stale', reason: null };
  const clean = entry.uncommitted === 0 && sessions.busy === 0 && !entry.isLocked;
  const inactive = entry.lastActivity === null || now - entry.lastActivity >= inactiveDays * DAY_MS;
  // Only worktrees Claude Code made are suggested; others are listed, and removed only when you pick them.
  if (clean && entry.underClaudeDir) {
    if (isMerged(entry) || entry.ahead === 0) return { group: 'safe', reason: null };
    if ((entry.pushed || entry.pr?.state === 'open') && inactive) return { group: 'done', reason: null };
  }
  return { group: 'keep', reason: keepReason(entry, sessions, inactive, inactiveDays) };
}

function keepReason(entry: WorktreeEntry, sessions: WorktreeSessions, inactive: boolean, inactiveDays: number): string {
  if (sessions.busy > 0) return 'A session is working here';
  if (entry.uncommitted > 0) return plural(entry.uncommitted, 'uncommitted change', 'uncommitted changes');
  if (entry.isLocked) return 'Locked by git';
  if (entry.unpushed > 0) return entry.unpushed === 1 ? "1 commit isn't pushed anywhere" : `${entry.unpushed} commits aren't pushed anywhere`;
  if (!entry.underClaudeDir) return 'Outside .claude/worktrees';
  if (!inactive) return `Active in the last ${inactiveDays} days`;
  return 'Not merged';
}

/** Every worktree with its group, reason and whether it can be picked, in the table's order (main first, then by group, newest first). */
export function worktreeRows(entries: readonly WorktreeEntry[], sessionsOf: (entry: WorktreeEntry) => WorktreeSessions, now: number): WorktreeRow[] {
  const rows = entries.map((entry) => {
    const sessions = sessionsOf(entry);
    return { entry, ...classify(entry, sessions, now), locked: lockReason(entry, sessions), sessions };
  });
  return rows.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || (b.entry.lastActivity ?? 0) - (a.entry.lastActivity ?? 0));
}

/** The groups that have rows, in order. */
export function groupRows(rows: readonly WorktreeRow[]): { group: WorktreeGroup; rows: WorktreeRow[] }[] {
  return GROUP_ORDER.map((group) => ({ group, rows: rows.filter((r) => r.group === group) })).filter((g) => g.rows.length > 0);
}

/** What starts picked: everything safe to remove, and stale entries. */
export function defaultSelection(rows: readonly WorktreeRow[]): Set<string> {
  return new Set(rows.filter((r) => !r.locked && (r.group === 'safe' || r.group === 'stale')).map((r) => r.entry.path));
}

/** Drops picks that can't be picked any more (a session started there, a file changed) or are gone. */
export function validSelection(selected: ReadonlySet<string>, rows: readonly WorktreeRow[]): Set<string> {
  const pickable = new Set(rows.filter((r) => !r.locked).map((r) => r.entry.path));
  return new Set([...selected].filter((path) => pickable.has(path)));
}

/**
 * A click on a row's checkbox. With shift, every pickable row from the last one clicked (`anchor`) to this one takes
 * the state this one gets; without, only this one flips. Rows that can't be picked are never added.
 */
export function toggleSelection(selected: ReadonlySet<string>, order: readonly WorktreeRow[], path: string, anchor: string | null, range: boolean): Set<string> {
  const next = new Set(selected);
  const on = !selected.has(path);
  const from = anchor ? order.findIndex((r) => r.entry.path === anchor) : -1;
  const to = order.findIndex((r) => r.entry.path === path);
  const span = range && from !== -1 && to !== -1 ? order.slice(Math.min(from, to), Math.max(from, to) + 1) : order.filter((r) => r.entry.path === path);
  for (const row of span) {
    if (row.locked) continue;
    if (on) next.add(row.entry.path);
    else next.delete(row.entry.path);
  }
  return next;
}

/** What removing these frees, as far as it has been measured: bytes, and whether some sizes are still unknown. */
export function freedBytes(paths: Iterable<string>, sizes: ReadonlyMap<string, WorktreeSize>): { bytes: number; unknown: number } {
  let bytes = 0;
  let unknown = 0;
  for (const path of paths) {
    const size = sizes.get(path);
    if (size) bytes += size.bytes;
    else unknown++;
  }
  return { bytes, unknown };
}

/** The summary strip: worktrees besides the main checkout, their size on disk, and how many can go. */
export function worktreeSummary(rows: readonly WorktreeRow[], sizes: ReadonlyMap<string, WorktreeSize>) {
  const others = rows.filter((r) => r.group !== 'main');
  return {
    count: others.length,
    ...freedBytes(
      others.filter((r) => !r.entry.missing).map((r) => r.entry.path),
      sizes,
    ),
    safe: others.filter((r) => r.group === 'safe').length,
    stale: others.filter((r) => r.group === 'stale').length,
  };
}

/**
 * The main checkout's own size: `du` counts the worktrees under `.claude/worktrees` in it too, so theirs come off.
 * Null until every one of them has been measured.
 */
export function mainCheckoutBytes(rows: readonly WorktreeRow[], sizes: ReadonlyMap<string, WorktreeSize>): number | null {
  const main = rows.find((r) => r.group === 'main');
  const total = main && sizes.get(main.entry.path);
  if (!main || !total) return null;
  const nested = rows.filter((r) => r !== main && !r.entry.missing && isSameOrInside(r.entry.path, main.entry.path));
  const { bytes, unknown } = freedBytes(
    nested.map((r) => r.entry.path),
    sizes,
  );
  return unknown ? null : Math.max(0, total.bytes - bytes);
}

/** Bytes as Finder shows them (decimal): "0 B", "612 MB", "3.7 GB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value >= 100 || unit < 2 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, '')} ${units[unit]}`;
}

/** The Sessions column: "2 working", "1 needs you", "1 session, idle", "2 sessions, done", or null for none. */
export function sessionsLabel(s: WorktreeSessions): { text: string; tone: 'working' | 'needs-you' | 'idle' } | null {
  if (s.needsYou > 0) return { text: `${s.needsYou} ${s.needsYou === 1 ? 'needs' : 'need'} you`, tone: 'needs-you' };
  if (s.busy > 0) return { text: `${s.busy} working`, tone: 'working' };
  if (s.total === 0) return null;
  return { text: `${plural(s.total, 'session', 'sessions')}, ${s.open > 0 ? 'idle' : 'done'}`, tone: 'idle' };
}

/** The Merged / PR column: "merged", "PR #41 merged", "PR #38 open", "PR #12 closed", or null. */
export function mergeLabel(entry: WorktreeEntry): { text: string; tone: 'ok' | 'link' | 'muted' } | null {
  if (entry.isMain) return null;
  if (entry.pr?.state === 'merged') return { text: `PR #${entry.pr.number} merged`, tone: 'ok' };
  if (entry.merged) return { text: 'merged', tone: 'ok' };
  if (entry.pr?.state === 'open') return { text: `PR #${entry.pr.number} open`, tone: 'link' };
  if (entry.pr?.state === 'closed') return { text: `PR #${entry.pr.number} closed`, tone: 'muted' };
  return null;
}

/** The Ahead column: "3 ↑ · not pushed", "4 ↑ · pushed", "0", or null ("—") for the main checkout and merged branches. */
export function aheadLabel(entry: WorktreeEntry): { text: string; caution: boolean } | null {
  if (entry.isMain || entry.missing || entry.ahead === null || entry.merged) return null;
  if (entry.ahead === 0) return { text: '0', caution: false };
  if (entry.unpushed > 0) return { text: `${entry.ahead} ↑ · not pushed`, caution: true };
  return { text: `${entry.ahead} ↑${entry.pushed ? ' · pushed' : ''}`, caution: false };
}

/** The "Also delete their branches" default and its note: on only when every picked branch is merged. */
export function branchChoice(entries: readonly WorktreeEntry[]): { defaultOn: boolean; note: string | null } {
  const withBranch = entries.filter((e) => e.branch);
  if (withBranch.length === 0) return { defaultOn: false, note: null };
  const notMerged = withBranch.filter((e) => !isMerged(e) && e.ahead !== 0).length;
  return { defaultOn: notMerged === 0, note: notMerged === 0 ? 'all merged' : `${notMerged} not merged` };
}

/** "Ignored files that will be deleted: a, b, c, d, e and 3 more". */
export function ignoredLine(files: readonly string[], total: number, shown = 5): string {
  const list = files.slice(0, shown).join(', ');
  const more = total - Math.min(files.length, shown);
  return more > 0 ? `${list} and ${more} more` : list;
}

/** The toast after a clean-up: "Removed 3 worktrees, freed 1.2 GB". */
export function removedMessage(removed: number, bytes: number): string {
  const what = `Removed ${plural(removed, 'worktree', 'worktrees')}`;
  return bytes > 0 ? `${what}, freed ${formatBytes(bytes)}` : what;
}
