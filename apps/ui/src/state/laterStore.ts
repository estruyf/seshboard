import { useEffect } from 'react';
import { create } from 'zustand';
import type { LaterDraft, LaterItem, QueueAuto, QueueStarted, QueueWaitFor } from '@switchboard/protocol/client';
import { engineConnection } from '../engine/connection.ts';
import { runOnce } from '../lib/inFlight.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { passFocusGate } from './focusGate.ts';
import { moveTarget } from './queue.ts';
import { useSessions } from './sessionsStore.ts';
import { toast } from './toastStore.ts';

// The queue. It keeps the name it started with (the Later list) inside: the RPCs, the table and this store.

interface LaterState {
  /** The queue in order, first to start first. */
  items: LaterItem[];
  /** Started items and their sessions, for the items still waiting on them. */
  started: QueueStarted[];
  /** What the engine knows about items that start by themselves: how sessions ended, and items held at the focus limit. */
  auto: QueueAuto;
  loaded: boolean;
  /**
   * New session should fill itself in from this item (a click on it, or Edit in New session). `asNew`: it left the
   * queue (Undo of Add to queue), and its prompt goes back into New session's box as a prompt of its own.
   */
  request: { item: LaterItem; asNew: boolean; seq: number } | null;
  replace(items: LaterItem[], started: QueueStarted[], auto: QueueAuto): void;
  /** Opens New session filled in from an item, so it can be checked (and changed) before it starts. */
  use(item: LaterItem, options?: { asNew?: boolean }): void;
  /** New session takes the request once. */
  take(): { item: LaterItem; asNew: boolean } | null;
}

let seq = 0;

export const useLater = create<LaterState>()((set, get) => ({
  items: [],
  started: [],
  auto: { outcomes: [], focusHeld: [] },
  loaded: false,
  request: null,
  replace: (items, started, auto) => set({ items, started, auto, loaded: true }),
  use: (item, options = {}) => {
    set({ request: { item, asNew: options.asNew ?? false, seq: ++seq } });
    useSessions.getState().openNewSession();
  },
  take: () => {
    const request = get().request;
    if (request) set({ request: null });
    return request ? { item: request.item, asNew: request.asNew } : null;
  },
}));

/** Loads the queue once per connection and follows changes from every window. */
export function useLaterSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    const off = client.on('later.changed', ({ items, started, auto }) => useLater.getState().replace(items, started, auto));
    void client.call('later.list', {}).then(({ items, started, auto }) => useLater.getState().replace(items, started, auto), () => {});
    return off;
  }, [client]);
}

const clientNow = () => {
  const state = engineConnection.getSnapshot();
  if (state.status !== 'connected') throw new Error('Not connected to the engine');
  return state.client;
};

/** Puts an item back where it was, as it was (Undo). */
const restore = (item: LaterItem, index = item.position) => {
  const { id, createdAt, position: _position, waitFor, ...draft } = item;
  return clientNow().call('later.add', { draft, id, createdAt, index, waitFor });
};

/**
 * Adds a prompt to the end of the queue and says so, with Undo (which takes it off again and brings the prompt back
 * into New session). `waitFor` defaults to any session in its project. `replacing`: an item edited in New session
 * and queued again keeps its place (and Undo puts back the item as it was).
 */
export async function addToQueue(draft: LaterDraft, options: { waitFor?: QueueWaitFor; replacing?: LaterItem | null } = {}): Promise<LaterItem> {
  const client = clientNow();
  const { replacing } = options;
  const index = replacing ? useLater.getState().items.findIndex((i) => i.id === replacing.id) : -1;
  const { item } = await client.call('later.add', {
    draft,
    ...(options.waitFor ? { waitFor: options.waitFor } : replacing ? { waitFor: replacing.waitFor } : {}),
    ...(replacing && index !== -1 ? { id: replacing.id, createdAt: replacing.createdAt, index } : {}),
  });
  toast(replacing && index !== -1 ? 'Updated in the queue' : 'Added to the queue', {
    icon: 'queue',
    undo: () => {
      if (replacing && index !== -1) void restore(replacing, index).catch(() => {});
      else {
        void client.call('later.remove', { id: item.id }).catch(() => {});
        useLater.getState().use(item, { asNew: true });
      }
    },
  });
  return item;
}

/**
 * Removes an item without asking; Undo puts it back in its place. `quiet` skips the toast. `startedAs`: it was
 * started from New session (after an edit) as this session, which items waiting on it now follow.
 */
export async function removeFromQueue(item: LaterItem, quiet = false, startedAs?: string): Promise<void> {
  const index = useLater.getState().items.findIndex((i) => i.id === item.id);
  await clientNow().call('later.remove', { id: item.id, ...(startedAs ? { startedAs } : {}) });
  if (quiet) return;
  toast('Removed from the queue', { undo: () => void restore(item, index === -1 ? item.position : index).catch(() => {}) });
}

/** ⌥↑ / ⌥↓ and Move to top. Nothing happens at the ends. */
export async function moveInQueue(item: LaterItem, move: -1 | 1 | 'top'): Promise<void> {
  const to = moveTarget(
    useLater.getState().items.map((i) => i.id),
    item.id,
    move,
  );
  if (to !== null) await clientNow().call('later.reorder', { id: item.id, toIndex: to });
}

/** Moves an item to a place in the whole queue (a drag). */
export async function reorderQueue(id: string, toIndex: number): Promise<void> {
  await clientNow().call('later.reorder', { id, toIndex });
}

/** Keeps the edits made to an item in New session: its prompt and choices, in its place. */
export async function updateQueued(id: string, draft: LaterDraft): Promise<void> {
  await clientNow().call('later.update', { id, draft });
}

export async function setWaitFor(item: LaterItem, waitFor: QueueWaitFor): Promise<void> {
  await clientNow().call('later.update', { id: item.id, waitFor });
}

/** Start by itself, on or off. The engine turns it off for an item that waits for nothing. */
export async function setAutoStart(item: LaterItem, autoStart: boolean): Promise<void> {
  await clientNow().call('later.update', { id: item.id, autoStart });
}

/** Queued items being started (from the gate until the engine answers), so each starts once. */
const starting = new Set<string>();

/**
 * Starts a queued item: the focus limit's gate first (at the limit it can only stay queued), then the session
 * starts from the item's draft and opens, and the item leaves the queue. Returns the session, or null when
 * nothing started. A failure is said in a toast and the item stays queued.
 */
export async function startQueued(item: LaterItem): Promise<string | null> {
  // A double click on Start (or Start then ⌘↵) starts it once: the second call would find it gone from the queue.
  const started = await runOnce(starting, item.id, async () => {
    const outcome = await passFocusGate({ saveForLater: async () => {}, saveLabel: 'Keep it queued' });
    if (outcome !== 'start') return null;
    try {
      const { sessionId } = await clientNow().call('later.start', { id: item.id });
      useSessions.getState().select(sessionId);
      return sessionId;
    } catch (error) {
      toast(`Couldn't start it: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  });
  return started ?? null;
}
