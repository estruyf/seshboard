import { trimTrailingSeparators, type LaterDraft, type LaterItem, type QueueStarted, type QueueWaitFor } from '@switchboard/protocol/client';
import type { SessionRowData } from './sessionsStore.ts';
import { rowStatus } from './sidebarRows.ts';

// The queue's states, without React or the stores: what each item waits for, whether that is busy, and when an
// item turned ready because a session finished (the "project is free" toast). Nothing here starts anything:
// ready only means the item says so.

/** How a queued item stands. `queued` is an item that waits for nothing: never ready, always startable. */
export type QueueStateKind = 'ready' | 'waiting' | 'queued';

export interface QueueEntry {
  item: LaterItem;
  state: QueueStateKind;
  /**
   * In a few words, for the sidebar: why it is ready ("switchboard is free"), what it waits for ("after “Fix
   * the parser”", "after the item above", "switchboard has a session working"); null while queued.
   */
  label: string | null;
  /** The same for Home's longer line: "Ready: switchboard is free", "Waits for “Fix the parser”". Null while queued. */
  detail: string | null;
  /** The busy sessions it waits on: when one of them finishes and the item turns ready, that one is "the finished session". */
  blockers: string[];
}

export interface QueueInputs {
  /** The queue in order. */
  items: readonly LaterItem[];
  /** Started items and their sessions. */
  started: readonly QueueStarted[];
  /** The sessions the sidebar lists, with their live state. */
  rows: readonly SessionRowData[];
  /** A project's name for a folder. */
  projectName(root: string): string;
}

export interface QueueSummary {
  entries: QueueEntry[];
  readyCount: number;
  /** The first ready item in queue order, for "Start next in queue". */
  firstReady: QueueEntry | null;
}

/** A worktree inside a project (`<root>/.claude/worktrees/<name>/…`) counts as the project. */
export const projectOf = (path: string) => trimTrailingSeparators(path.replace(/[\\/]\.claude[\\/]worktrees[\\/][^\\/]+.*$/, ''));

/** Starting, running or waiting for you: what the sidebar shows under Needs you and Working. */
export const isBusy = (row: SessionRowData) => {
  const status = rowStatus(row);
  return status === 'running' || status === 'needs-you';
};

/** A prompt's first line, shortened for a label. */
export function promptLabel(prompt: string, max = 48): string {
  const line = prompt.trim().split('\n')[0]!.trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

const quoted = (text: string) => `“${text}”`;
const sessionTitle = (row: SessionRowData | undefined) => promptLabel(row?.title || 'Untitled session');

/** Every item's state, in queue order, with how many are ready and the first of them. */
export function queueStates(inputs: QueueInputs): QueueSummary {
  const byId = new Map(inputs.rows.map((row) => [row.id, row]));
  const busyIn = new Map<string, SessionRowData[]>();
  for (const row of inputs.rows) {
    if (!isBusy(row)) continue;
    // A session in a worktree of the project counts for the project.
    const root = projectOf(row.projectRoot);
    const list = busyIn.get(root);
    if (list) list.push(row);
    else busyIn.set(root, [row]);
  }
  const startedAs = new Map(inputs.started.map((s) => [s.itemId, s.sessionId]));
  const index = new Map(inputs.items.map((item, i) => [item.id, i]));

  const entries = inputs.items.map((item, i): QueueEntry => {
    const name = inputs.projectName(item.cwd);
    const wait: QueueWaitFor = item.waitFor;
    const ready = (label: string): QueueEntry => ({ item, state: 'ready', label, detail: `Ready: ${label}`, blockers: [] });
    const onSession = (sessionId: string): QueueEntry => {
      const row = byId.get(sessionId);
      if (!row || !isBusy(row)) return ready(row ? `${quoted(sessionTitle(row))} finished` : `${name} is free`);
      const title = quoted(sessionTitle(row));
      return { item, state: 'waiting', label: `after ${title}`, detail: `Waits for ${title}`, blockers: [sessionId] };
    };
    switch (wait.kind) {
      case 'none':
        return { item, state: 'queued', label: null, detail: null, blockers: [] };
      case 'project': {
        const busy = busyIn.get(projectOf(item.cwd)) ?? [];
        if (busy.length === 0) return ready(`${name} is free`);
        const label = busy.length === 1 ? `${name} has a session working` : `${name} has ${busy.length} sessions working`;
        const detail = busy.length === 1 ? `Waits for ${quoted(sessionTitle(busy[0]))}` : `Waits for ${busy.length} sessions in ${name}`;
        return { item, state: 'waiting', label, detail, blockers: busy.map((row) => row.id) };
      }
      case 'session':
        return onSession(wait.sessionId);
      case 'item': {
        const at = index.get(wait.itemId);
        if (at !== undefined) {
          // Still queued: it hasn't started, so this one can't follow it yet.
          const above = at === i - 1;
          const target = above ? 'the item above' : quoted(promptLabel(inputs.items[at]!.prompt));
          return { item, state: 'waiting', label: `after ${target}`, detail: `Waits for ${target}`, blockers: [] };
        }
        const sessionId = startedAs.get(wait.itemId);
        // Removed without starting: there is nothing left to wait for.
        return sessionId ? onSession(sessionId) : ready('nothing to wait for');
      }
    }
  });
  const readyEntries = entries.filter((e) => e.state === 'ready');
  return { entries, readyCount: readyEntries.length, firstReady: readyEntries[0] ?? null };
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
 * items you changed to wait for something free, and items that wait for nothing never count.
 */
export function readyTransitions(before: ReadonlyMap<string, QueueEntry> | null, after: readonly QueueEntry[], rows: readonly SessionRowData[]): ReadyTransition[] {
  if (!before) return [];
  const busy = new Set(rows.filter(isBusy).map((row) => row.id));
  return after.flatMap((entry) => {
    const was = before.get(entry.item.id);
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
    sameImages(item.attachments, draft.attachments ?? [])
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
