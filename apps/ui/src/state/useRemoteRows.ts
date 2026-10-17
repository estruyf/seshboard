import { useMemo } from 'react';
import type { Computer } from '@switchboard/protocol/client';
import { useComputers } from './computersStore.ts';
import { selectionOf } from './remoteSelection.ts';
import { remoteRows, THIS_COMPUTER } from './remoteRows.ts';
import { useSessions, type SessionRowData } from './sessionsStore.ts';

const NONE: Computer[] = [];

/** Every remote session as a sidebar row (`remoteRows`), from the computers' last lists. */
export function useRemoteRows(): SessionRowData[] {
  const computers = useComputers((s) => s.status?.computers ?? NONE);
  const lists = useComputers((s) => s.lists);
  return useMemo(() => remoteRows(computers, lists), [computers, lists]);
}

/** The same, read once (for keys and palette commands). */
export function currentRemoteRows(): SessionRowData[] {
  const { status, lists } = useComputers.getState();
  return remoteRows(status?.computers ?? NONE, lists);
}

/** What the sidebar's filter can choose from: this computer, then each paired one. Only this computer without a pairing. */
export function useSources(): string[] {
  const computers = useComputers((s) => s.status?.computers ?? NONE);
  return useMemo(() => [THIS_COMPUTER, ...computers.map((c) => c.id)], [computers]);
}

/** The sidebar row of the session in the active pane, local or remote (its id is the row's); null on Home and other views. */
export function useShownRowId(): string | null {
  const view = useSessions((s) => (s.view === 'settings' ? s.settingsFrom : s.view));
  const selectedId = useSessions((s) => s.selectedId);
  return view === 'session' ? selectedId : null;
}

/** The same, read once. */
export function shownRowId(): string | null {
  const s = useSessions.getState();
  const view = s.view === 'settings' ? s.settingsFrom : s.view;
  return view === 'session' ? s.selectedId : null;
}

/** Opens a sidebar row's session in the active pane, or with `beside` in a new pane next to it; local and remote alike. */
export function openRow(id: string, options?: { beside?: boolean }): void {
  const selection = selectionOf(id);
  if (selection.kind === 'remote') useComputers.getState().openSession(selection, options);
  else if (options?.beside) useSessions.getState().openBeside(selection.sessionId);
  else useSessions.getState().select(selection.sessionId);
}
