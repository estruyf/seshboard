import { queueStates as sharedQueueStates, type LaterDraft, type LaterItem, type QueueInputs as SharedQueueInputs, type QueueSession, type QueueSummary, type QueueWaitFor } from '@seshboard/protocol/client';
import type { SessionRowData } from './sessionsStore.ts';
import { rowStatus } from './sidebarRows.ts';

// The queue's states as the UI shows them. The rules are shared with the engine (`queueStates` in the protocol), which
// starts the items that start by themselves; this side maps the sidebar's rows onto them, and says when an item
// turned ready because a session finished (the "project is free" toast).

export {
  autoStartBlock,
  FOCUS_HELD_LABEL,
  projectOf,
  promptLabel,
  queueRowLabel,
  type QueueEntry,
  type QueueSession,
  type QueueStateKind,
  type QueueSummary,
} from '@seshboard/protocol/client';
import { projectOf, promptLabel, type QueueEntry } from '@seshboard/protocol/client';

export interface QueueInputs extends Omit<SharedQueueInputs, 'sessions'> {
  /** The sessions the sidebar lists, with their live state. */
  rows: readonly SessionRowData[];
}

/** Starting, running or waiting for you: what the sidebar shows under Needs you and Working. */
export const isBusy = (row: SessionRowData) => {
  const status = rowStatus(row);
  return status === 'running' || status === 'needs-you';
};

/**
 * A row as the queue sees it. A session Claude Code runs outside Seshboard (the terminal, another app) is
 * `elsewhere`: Seshboard sees it go idle, but not how its turn ended.
 */
export function queueSession(row: SessionRowData): QueueSession {
  const origin = row.remote ? null : row.live?.origin;
  return { id: row.id, title: row.title, projectRoot: row.projectRoot, busy: isBusy(row), elsewhere: !origin || origin === 'app' ? null : origin === 'cli' ? 'terminal' : 'app' };
}

const quoted = (text: string) => `“${text}”`;
const sessionTitle = (row: SessionRowData | undefined) => promptLabel(row?.title || 'Untitled session');

/** Every item's state, in queue order, with how many are ready and the first of them. */
export function queueStates(inputs: QueueInputs): QueueSummary {
  const { rows, ...rest } = inputs;
  return sharedQueueStates({ ...rest, sessions: rows.map(queueSession) });
}

/** An item that turned ready because a session it waited on finished. */
export interface ReadyTransition {
  entry: QueueEntry;
  /** The session that finished (the first, when several did at once). */
  finishedId: string;
}

/**
 * Items that went from waiting to ready since `before` because a session they waited on is no longer busy. An
 * item turns ready once per transition: it has to wait again before it can say so again. Items new to the queue,
 * items you changed to wait for something free, items that wait for nothing and items that start by themselves
 * never count.
 */
export function readyTransitions(before: ReadonlyMap<string, QueueEntry> | null, after: readonly QueueEntry[], rows: readonly SessionRowData[]): ReadyTransition[] {
  if (!before) return [];
  const busy = new Set(rows.filter(isBusy).map((row) => row.id));
  return after.flatMap((entry) => {
    const was = before.get(entry.item.id);
    // An item that starts by itself says so through the engine's notifications, not "Start it".
    if (entry.autoStart) return [];
    if (!was || was.state !== 'waiting' || entry.state !== 'ready') return [];
    const finished = was.blockers.find((id) => !busy.has(id));
    return finished ? [{ entry, finishedId: finished }] : [];
  });
}

/** The toast for items that turned ready: one item names its project and what finished; several share one. */
export type QueueToast =
  | { kind: 'one'; title: string; body: string; itemId: string; finishedId: string }
  | { kind: 'many'; title: string; body: string; itemIds: string[] };

export function queueToast(transitions: readonly ReadyTransition[], inputs: Pick<QueueInputs, 'rows' | 'projectName'>): QueueToast | null {
  if (transitions.length === 0) return null;
  if (transitions.length === 1) {
    const { entry, finishedId } = transitions[0]!;
    const finished = inputs.rows.find((row) => row.id === finishedId);
    return {
      kind: 'one',
      title: `${inputs.projectName(entry.item.cwd)} is free`,
      body: `${quoted(sessionTitle(finished))} finished. Next in the queue: ${promptLabel(entry.item.prompt, 80)}`,
      itemId: entry.item.id,
      finishedId,
    };
  }
  const names = [...new Set(transitions.map((t) => inputs.projectName(t.entry.item.cwd)))];
  return {
    kind: 'many',
    title: `${transitions.length} queued items are ready`,
    body: names.length === 1 ? `${names[0]} is free.` : `${names.slice(0, -1).join(', ')} and ${names.at(-1)} are free.`,
    itemIds: transitions.map((t) => t.entry.item.id),
  };
}

/** The busy sessions in an item's project: what "Wait for…" offers besides the project, the item above and nothing. */
export function busyInProject(rows: readonly SessionRowData[], cwd: string): SessionRowData[] {
  const root = projectOf(cwd);
  return rows.filter((row) => isBusy(row) && projectOf(row.projectRoot) === root);
}

/** Whether two waits are the same choice (the check in "Wait for…"). */
export function sameWait(a: QueueWaitFor, b: QueueWaitFor): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'session' && b.kind === 'session') return a.sessionId === b.sessionId;
  if (a.kind === 'item' && b.kind === 'item') return a.itemId === b.itemId;
  return true;
}

/** Whether an item already holds this prompt and these choices (New session saves edits to a queued item only when they differ). */
export function sameDraft(item: LaterItem, draft: LaterDraft): boolean {
  return (
    item.cwd === draft.cwd &&
    item.prompt === draft.prompt.trim() &&
    item.model === (draft.model ?? null) &&
    item.effort === (draft.effort ?? null) &&
    item.permissionMode === (draft.permissionMode ?? 'default') &&
    item.workspace === (draft.workspace ?? 'current') &&
    item.baseRef === (draft.baseRef ?? 'fresh') &&
    item.branch === (draft.branch ?? null) &&
    item.profileId === (draft.profileId ?? null) &&
    // A draft that doesn't say whether it starts by itself keeps the item's.
    (draft.autoStart === undefined || item.autoStart === draft.autoStart) &&
    sameImages(item.attachments, draft.attachments ?? []) &&
    item.typed === (draft.typed ?? null) &&
    JSON.stringify(item.context) === JSON.stringify(draft.context ?? [])
  );
}

/** The same images in the same order (a pasted image is new data, so comparing the data is enough). */
const sameImages = (a: readonly { data: string }[], b: readonly { data: string }[]) => a.length === b.length && a.every((image, i) => image.data === b[i]!.data);

/** The index an item moves to with ⌥↑ / ⌥↓ (-1 / 1) or Move to top ('top'); null when it can't move that way. */
export function moveTarget(ids: readonly string[], id: string, move: -1 | 1 | 'top'): number | null {
  const from = ids.indexOf(id);
  if (from === -1) return null;
  const to = move === 'top' ? 0 : from + move;
  return to < 0 || to >= ids.length || to === from ? null : to;
}

/** The queue as the sidebar lists it: the project filter applies, and search looks at the prompt and the folder. */
export function queueInList<T extends { item: LaterItem }>(entries: readonly T[], options: { search: string; project: string | null }): T[] {
  const needle = options.search.trim().toLowerCase();
  return entries.filter(
    ({ item }) => (!options.project || item.cwd === options.project) && (!needle || item.prompt.toLowerCase().includes(needle) || item.cwd.toLowerCase().includes(needle)),
  );
}

/**
 * Where a dragged item lands, as `later.reorder`'s index (in the queue without it): before or after the item it
 * was dropped on. Null when it wouldn't move.
 */
export function dropIndex(ids: readonly string[], sourceId: string, targetId: string, after: boolean): number | null {
  const from = ids.indexOf(sourceId);
  const target = ids.indexOf(targetId);
  if (from === -1 || target === -1 || sourceId === targetId) return null;
  const to = target - (from < target ? 1 : 0) + (after ? 1 : 0);
  return to === from ? null : to;
}

/**
 * The items that start by themselves once `sessionId` finishes, for the band above its message box: the first in
 * queue order, and how many more follow it in a chain ("+1 after it"). Items that also wait on other sessions (a
 * busy project) are left out: "after this one" wouldn't be the whole story. Null when nothing starts after it.
 */
export function startsAfter(entries: readonly QueueEntry[], sessionId: string): { first: QueueEntry; more: number } | null {
  const next = entries.filter((e) => e.autoStart && e.state === 'waiting' && e.hold === null && e.blockers.length === 1 && e.blockers[0] === sessionId);
  if (next.length === 0) return null;
  // Items that start by themselves after one of these, and after those, in a chain.
  const chained = new Set(next.map((e) => e.item.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of entries) {
      if (!e.autoStart || chained.has(e.item.id) || e.item.waitFor.kind !== 'item' || !chained.has(e.item.waitFor.itemId)) continue;
      chained.add(e.item.id);
      grew = true;
    }
  }
  return { first: next[0]!, more: chained.size - 1 };
}
