import type { BranchEntry } from '@switchboard/protocol/client';
import { basename } from '../../lib/format.ts';

// The branch overview's decisions, without React or the stores: which group each branch is in, which copies of it
// (here, on the remote) can be deleted and why not, what starts picked, and the words the table and its summary use.

/** No commit for this many days, and a branch that isn't merged counts as inactive. */
export const INACTIVE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The table's groups, in the order they show. */
export type BranchGroup = 'in-use' | 'safe' | 'gone' | 'inactive' | 'active';
export const GROUP_ORDER: readonly BranchGroup[] = ['in-use', 'safe', 'gone', 'inactive', 'active'];

export const GROUP_LABEL: Record<BranchGroup, string> = { 'in-use': 'In use', safe: 'Safe to delete', gone: 'Deleted on the remote', inactive: 'Inactive', active: 'Active' };
export const GROUP_NOTE: Record<BranchGroup, string> = {
  'in-use': 'the base branch, or checked out',
  safe: 'merged, or no commits of its own',
  gone: 'its upstream is gone; often squash-merged',
  inactive: `no commits for ${INACTIVE_DAYS}+ days`,
  active: '',
};

export interface BranchRow {
  /** The row's key: the local branch's name, or the remote ref for a branch only on a remote. */
  key: string;
  entry: BranchEntry;
  group: BranchGroup;
  /** Why the local copy can't be deleted; null when it can, or when there is none. */
  localLock: string | null;
  /** Why the remote copy can't be deleted; null when it can, or when there is none. */
  remoteLock: string | null;
  /** Neither copy can be deleted: why, for the lock in place of the checkbox. */
  locked: string | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const branchKey = (entry: BranchEntry) => (entry.local ? entry.name : (entry.remote?.ref ?? entry.name));

/** Merged by ancestry, or its pull request was merged (a squash merge leaves the branch's own commits behind). */
export const isMerged = (entry: BranchEntry) => entry.merged || entry.pr?.state === 'merged';

/** Everything on it is in the base: deleting it loses nothing. */
export const isSafe = (entry: BranchEntry) => !entry.isBase && (isMerged(entry) || entry.local?.neverCommitted === true) && (entry.local?.unpushed ?? 0) === 0;

/** Why the local copy can't go. The engine refuses the same. */
export function localLock(entry: BranchEntry): string | null {
  if (!entry.local) return null;
  if (entry.isBase) return 'The base branch is never deleted';
  if (entry.local.checkedOutIn) return `Checked out in ${basename(entry.local.checkedOutIn)}`;
  return null;
}

/** Why the copy on the remote can't go. The engine refuses the same. */
export function remoteLock(entry: BranchEntry, base: string | null): string | null {
  if (!entry.remote) return null;
  if (entry.isBase || entry.remote.isDefault || entry.remote.ref.slice(entry.remote.remote.length + 1) === base) return "The remote's default branch is never deleted";
  if (entry.pr?.state === 'open') return `PR #${entry.pr.number} is open; deleting the branch would close it`;
  return null;
}

/** Which group a branch belongs in. */
export function classify(entry: BranchEntry, now: number, inactiveDays = INACTIVE_DAYS): BranchGroup {
  if (entry.isBase || entry.local?.checkedOutIn) return 'in-use';
  if (isSafe(entry)) return 'safe';
  if (entry.local?.upstreamGone) return 'gone';
  if (entry.lastCommitAt !== null && now - entry.lastCommitAt >= inactiveDays * DAY_MS) return 'inactive';
  return 'active';
}

/** Every branch with its group and locks, in the table's order (by group, newest commit first). */
export function branchRows(entries: readonly BranchEntry[], base: string | null, now: number): BranchRow[] {
  const rows = entries.map((entry): BranchRow => {
    const local = localLock(entry);
    const remote = remoteLock(entry, base);
    // A copy that is missing counts as locked: there is nothing of it to delete.
    const localOut = !entry.local || local !== null;
    const remoteOut = !entry.remote || remote !== null;
    return { key: branchKey(entry), entry, group: classify(entry, now), localLock: local, remoteLock: remote, locked: localOut && remoteOut ? (local ?? remote ?? 'Nothing to delete') : null };
  });
  return rows.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || (b.entry.lastCommitAt ?? 0) - (a.entry.lastCommitAt ?? 0));
}

/** The groups that have rows, in order. */
export function groupRows(rows: readonly BranchRow[]): { group: BranchGroup; rows: BranchRow[] }[] {
  return GROUP_ORDER.map((group) => ({ group, rows: rows.filter((r) => r.group === group) })).filter((g) => g.rows.length > 0);
}

/** Rows whose name, remote ref or last commit's subject holds every word of `query`, case-insensitively. */
export function filterRows(rows: readonly BranchRow[], query: string): BranchRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...rows];
  return rows.filter((r) => {
    const text = `${r.entry.name} ${r.entry.remote?.ref ?? ''} ${r.entry.subject ?? ''} ${r.entry.author ?? ''}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** What starts picked: the local branches that are safe to delete. Copies on the remote are only deleted when you ask. */
export function defaultSelection(rows: readonly BranchRow[]): Set<string> {
  return new Set(rows.filter((r) => r.group === 'safe' && r.entry.local && !r.localLock).map((r) => r.key));
}

/** Drops picks that can't be picked any more, or are gone. */
export function validSelection(selected: ReadonlySet<string>, rows: readonly BranchRow[]): Set<string> {
  const pickable = new Set(rows.filter((r) => !r.locked).map((r) => r.key));
  return new Set([...selected].filter((key) => pickable.has(key)));
}

/**
 * A click on a row's checkbox. With shift, every pickable row from the last one clicked (`anchor`) to this one takes
 * the state this one gets; without, only this one flips.
 */
export function toggleSelection(selected: ReadonlySet<string>, order: readonly BranchRow[], key: string, anchor: string | null, range: boolean): Set<string> {
  const next = new Set(selected);
  const on = !selected.has(key);
  const from = anchor ? order.findIndex((r) => r.key === anchor) : -1;
  const to = order.findIndex((r) => r.key === key);
  const span = range && from !== -1 && to !== -1 ? order.slice(Math.min(from, to), Math.max(from, to) + 1) : order.filter((r) => r.key === key);
  for (const row of span) {
    if (row.locked) continue;
    if (on) next.add(row.key);
    else next.delete(row.key);
  }
  return next;
}

/** The summary strip: branches here, on the remote, and how many can go. */
export function branchSummary(rows: readonly BranchRow[]) {
  return {
    local: rows.filter((r) => r.entry.local).length,
    remote: rows.filter((r) => r.entry.remote).length,
    safe: rows.filter((r) => r.group === 'safe').length,
    gone: rows.filter((r) => r.group === 'gone').length,
  };
}

/** Which copies a deletion takes. */
export interface DeleteScope {
  local: boolean;
  remote: boolean;
}

/** What deleting these rows with `scope` does, per row: which copies go (a locked or missing copy never does). */
export function deletePlan(rows: readonly BranchRow[], scope: DeleteScope): { row: BranchRow; local: boolean; remote: boolean }[] {
  return rows
    .map((row) => ({ row, local: scope.local && !!row.entry.local && !row.localLock, remote: scope.remote && !!row.entry.remote && !row.remoteLock }))
    .filter((p) => p.local || p.remote);
}

/** Commits deleting this copy here would lose: none when they're merged or on a remote. */
export function localLoss(entry: BranchEntry): number {
  if (!entry.local || isMerged(entry)) return 0;
  return entry.local.unpushed;
}

/**
 * Commits deleting the copy on the remote could lose for everyone: those not in the base, when no local copy keeps
 * them (or the local copy goes too).
 */
export function remoteLoss(entry: BranchEntry, localGoesToo: boolean): number {
  if (!entry.remote || isMerged(entry)) return 0;
  // A local copy that stays and has every commit of the remote one keeps them.
  if (entry.local && !localGoesToo && (entry.local.sha === entry.remote.sha || (entry.local.upstream === entry.remote.ref && entry.local.behindUpstream === 0))) return 0;
  return entry.ahead ?? 0;
}

/** The Local column: "checked out", "2 not pushed", "upstream gone", "↑1 ↓2" against its upstream, "in sync", or null without a local copy. */
export function localLabel(entry: BranchEntry): { text: string; tone: 'muted' | 'caution' | 'ok' | 'default' } | null {
  const local = entry.local;
  if (!local) return null;
  if (local.checkedOutIn) return { text: 'checked out', tone: 'default' };
  if (local.unpushed > 0 && !isMerged(entry)) return { text: `${local.unpushed} not pushed`, tone: 'caution' };
  if (local.upstreamGone) return { text: 'upstream gone', tone: 'muted' };
  if (local.aheadOfUpstream || local.behindUpstream) return { text: [local.aheadOfUpstream ? `↑${local.aheadOfUpstream}` : '', local.behindUpstream ? `↓${local.behindUpstream}` : ''].filter(Boolean).join(' '), tone: 'default' };
  if (entry.remote) return { text: 'in sync', tone: 'ok' };
  return { text: 'local only', tone: 'muted' };
}

/** The "vs base" column: "merged", "PR #41 merged", "no commits", "3 ↑ 12 ↓", or null for the base. */
export function baseLabel(entry: BranchEntry): { text: string; tone: 'ok' | 'muted' | 'default' } | null {
  if (entry.isBase) return null;
  if (entry.pr?.state === 'merged') return { text: `PR #${entry.pr.number} merged`, tone: 'ok' };
  if (entry.merged) return { text: 'merged', tone: 'ok' };
  if (entry.local?.neverCommitted) return { text: 'no commits of its own', tone: 'muted' };
  if (entry.ahead === null) return null;
  return { text: `${entry.ahead} ↑${entry.behind ? ` ${entry.behind} ↓` : ''}`, tone: 'default' };
}

/** The PR column, for pull requests that aren't merged: "PR #38 open", "PR #12 closed". */
export function prLabel(entry: BranchEntry): { text: string; tone: 'link' | 'muted' } | null {
  if (entry.pr?.state === 'open') return { text: `PR #${entry.pr.number} open`, tone: 'link' };
  if (entry.pr?.state === 'closed') return { text: `PR #${entry.pr.number} closed`, tone: 'muted' };
  return null;
}

/** The toast after deleting: "Deleted 3 branches here and 2 on origin". */
export function deletedMessage(local: number, remote: number, remoteName: string): string {
  const parts = [local > 0 ? `${plural(local, 'branch', 'branches')} here` : '', remote > 0 ? `${local > 0 ? remote : plural(remote, 'branch', 'branches')} on ${remoteName}` : ''].filter(Boolean);
  return `Deleted ${parts.join(' and ')}`;
}
