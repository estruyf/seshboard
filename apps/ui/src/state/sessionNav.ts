import { create } from 'zustand';
import { useHosts } from './hostsStore.ts';
import { usePreferences } from './preferencesStore.ts';
import { useProjects } from './projectsStore.ts';
import { toRows, useSessions } from './sessionsStore.ts';
import { useSidebar } from './sidebarStore.ts';
import { nextNeedsYou, sidebarGroups, sidebarOrder, stepSession } from './sidebarOrder.ts';
import { inScope } from './sidebarRows.ts';

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
 * The sessions in the sidebar's order, as ⌃⇥ walks them. With the sidebar open, the list you see (its
 * search and project filter apply); minimal or closed, every session in scope, as the rail shows them.
 */
function currentOrder() {
  const { sessions, live, filter } = useSessions.getState();
  const scope = usePreferences.getState().prefs.sessionScope;
  const rows = toRows(sessions, live, useHosts.getState().hosts).filter((row) => inScope(row, scope));
  const open = useSidebar.getState().state === 'open';
  return sidebarOrder(sidebarGroups(rows, { now: Date.now(), archiveAfterDays: usePreferences.getState().prefs.archiveAfterDays, search: open ? filter : '', project: open ? useProjects.getState().filter : null }));
}

function land(id: string, order: readonly { id: string }[]) {
  useSessions.getState().select(id);
  // The open sidebar shows where you are already; collapsed, the HUD says it.
  if (useSidebar.getState().state !== 'open') useHud.getState().show({ kind: 'session', id, position: order.findIndex((row) => row.id === id) + 1, total: order.length });
}

/** ⌃⇥ / ⌃⇧⇥: the next or previous session in the sidebar's order, wrapping at the ends and skipping archived ones. */
export function goToAdjacentSession(direction: 1 | -1): void {
  const order = currentOrder();
  const { selectedId, view } = useSessions.getState();
  const id = stepSession(
    order.map((row) => row.id),
    view === 'session' ? selectedId : null,
    direction,
  );
  if (id) land(id, order);
}

/** ⌘⇧U: the next session that needs you. With nothing waiting it stays put and the HUD says so. */
export function goToNextNeedsYou(): void {
  const order = currentOrder();
  const { selectedId, view } = useSessions.getState();
  const id = nextNeedsYou(order, view === 'session' ? selectedId : null);
  if (id) land(id, order);
  else useHud.getState().show({ kind: 'note', text: 'Nothing needs you' });
}
