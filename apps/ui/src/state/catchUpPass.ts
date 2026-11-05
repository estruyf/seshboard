import { useMemo } from 'react';
import { create } from 'zustand';
import { advancePass, passPosition, type PassState } from '../components/catchUp/catchUpModel.ts';
import { useCatchUp } from './catchUpStore.ts';
import { useHosts } from './hostsStore.ts';
import { popoutSession } from './popoutsStore.ts';
import { currentOrder } from './sessionNav.ts';
import { useSessions } from './sessionsStore.ts';
import { triageOrder } from './sidebarRows.ts';
import { openRow } from './useRemoteRows.ts';

/**
 * Going through sessions in catch-up: the footer's "N open" starts a pass, Skip (S) and Done (E) move it on. Only for this
 * window and until you go somewhere else; the sessions themselves don't change by being skipped.
 */
export const useCatchUpPass = create<{ pass: PassState | null; set(pass: PassState | null): void }>()((set) => ({
  pass: null,
  set: (pass) => set({ pass }),
}));

// Opening another session (or Home) by hand ends the pass: its skipped sessions are only remembered while it lasts.
useSessions.subscribe((state, previous) => {
  const pass = useCatchUpPass.getState().pass;
  if (pass && state.selectedId !== previous.selectedId && state.selectedId !== pass.current) useCatchUpPass.getState().set(null);
});

/** The sessions a pass goes through now: To review, then Open, as the sidebar lists them (its search and filter apply). */
export const passOrderNow = (): string[] => triageOrder(currentOrder()).map((row) => row.id);

/** Opens a session of the pass with its catch-up in full (when it has one), so Skip and Done are in sight. */
function openInPass(id: string): void {
  openRow(id);
  const card = useCatchUp.getState().cards.get(id);
  if (card) useCatchUp.getState().setCollapsed(card, false);
}

/** The footer's "N open": a new pass, from the first session to go through. False when there is none. */
export function startPass(): boolean {
  const first = passOrderNow()[0];
  if (!first) return false;
  useCatchUpPass.getState().set({ current: first, skipped: new Set(), handled: 0 });
  openInPass(first);
  return true;
}

/**
 * Skip (S) or Done (E) in a catch-up: on to the next session to go through, or Home when none is left. `order` is read
 * before Done archives the session, while it is still listed. A pop-out shows one session: Done closes it instead.
 */
export function moveOn(rowId: string, how: 'skip' | 'done', order: readonly string[] = passOrderNow()): void {
  const pass = advancePass(useCatchUpPass.getState().pass, rowId, how, order);
  useCatchUpPass.getState().set(popoutSession ? null : pass);
  if (pass && !popoutSession) openInPass(pass.current);
  else useSessions.getState().goHome();
}

/** "2 of 7" for the catch-up's header while a pass is on this session; null otherwise. */
export function usePassPosition(rowId: string): { position: number; total: number } | null {
  const pass = useCatchUpPass((s) => s.pass);
  // The order follows the sessions: these make it worth working out again.
  const sessions = useSessions((s) => s.sessions);
  const live = useSessions((s) => s.live);
  const hosts = useHosts((s) => s.hosts);
  return useMemo(() => (pass?.current === rowId ? passPosition(pass, rowId, passOrderNow()) : null), [pass, rowId, sessions, live, hosts]);
}
