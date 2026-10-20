import { create } from 'zustand';
import { quickInfoOf, useCatchUp } from './catchUpStore.ts';
import { useHosts } from './hostsStore.ts';
import { usePreferences } from './preferencesStore.ts';
import { useProjects } from './projectsStore.ts';
import { toRows, useSessions } from './sessionsStore.ts';
import { useSidebar } from './sidebarStore.ts';
import { nextNeedsYou, sidebarGroups, sidebarOrder, stepSession } from './sidebarOrder.ts';
import { inScope } from './sidebarRows.ts';
import { useComputers } from './computersStore.ts';
import { filterBySource } from './remoteRows.ts';
import { currentRemoteRows, openRow, shownRowId } from './useRemoteRows.ts';

/** What the HUD says after a jump: where you landed ("2 of 6"), or that there was nowhere to go. */
export type HudMessage = { kind: 'session'; id: string; position: number; total: number } | { kind: 'note'; text: string };

interface HudState {
  message: HudMessage | null;
  /** Bumped on every jump, so the same message shows (and fades) again. */
  nonce: number;
  show(message: HudMessage): void;
  clear(): void;
}

export const useHud = create<HudState>()((set) => ({
  message: null,
  nonce: 0,
  show: (message) => set((s) => ({ message, nonce: s.nonce + 1 })),
  clear: () => set({ message: null }),
}));

/**
 * The sessions in the sidebar's order, as ⌃⇥ walks them, other computers' too (the Computers filter applies). With the
 * sidebar open, the list you see (its search and project filter apply); minimal or closed, every session in scope, as
 * the rail shows them.
 */
export function currentOrder() {
  const { sessions, live, filter } = useSessions.getState();
  const { sessionScope: scope, archiveAfterDays, sidebarSort: sort } = usePreferences.getState().prefs;
  const local = toRows(sessions, live, useHosts.getState().hosts).filter((row) => inScope(row, scope));
  const rows = filterBySource([...local, ...currentRemoteRows()], useComputers.getState().hidden);
  const open = useSidebar.getState().state === 'open';
  const quick = quickInfoOf(useCatchUp.getState().cards);
  return sidebarOrder(sidebarGroups(rows, { now: Date.now(), archiveAfterDays, search: open ? filter : '', project: open ? useProjects.getState().filter : null, sort, quick }));
}

function land(id: string, order: readonly { id: string }[]) {
  openRow(id);
  // The open sidebar shows where you are already; collapsed, the HUD says it.
  if (useSidebar.getState().state !== 'open') useHud.getState().show({ kind: 'session', id, position: order.findIndex((row) => row.id === id) + 1, total: order.length });
}

/** ⌃⇥ / ⌃⇧⇥: the next or previous session in the sidebar's order, wrapping at the ends and skipping archived ones. */
export function goToAdjacentSession(direction: 1 | -1): void {
  const order = currentOrder();
  const id = stepSession(
    order.map((row) => row.id),
    shownRowId(),
    direction,
  );
  if (id) land(id, order);
}

/**
 * ⌘⇧U: the next session that needs you, quickest to unblock first, on this computer or another. With nothing waiting it
 * stays put and the HUD says so.
 */
export function goToNextNeedsYou(): void {
  const order = currentOrder();
  const id = nextNeedsYou(order, shownRowId(), quickInfoOf(useCatchUp.getState().cards));
  if (id) land(id, order);
  else useHud.getState().show({ kind: 'note', text: 'Nothing needs you' });
}
