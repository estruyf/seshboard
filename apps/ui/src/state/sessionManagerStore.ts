import { create } from 'zustand';
import { DEFAULT_FILTERS, type ManagerFilters } from '../components/sessions/sessionManager.ts';
import { useSessions } from './sessionsStore.ts';

/** A control on Settings › Sessions that an entry point asks to focus. */
export type SessionsFocus = 'archive' | 'delete';

interface SessionManagerState {
  /** The overview's filters; kept while the app runs, so the page opens as you left it. */
  filters: ManagerFilters;
  setFilters(patch: Partial<ManagerFilters>): void;
  /** Focus this control once the page shows (bumped `nonce`: asked again). */
  focus: { target: SessionsFocus; nonce: number } | null;
  clearFocus(): void;
}

let focusRequests = 0;

export const useSessionManager = create<SessionManagerState>()((set) => ({
  filters: DEFAULT_FILTERS,
  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  focus: null,
  clearFocus: () => set({ focus: null }),
}));

/**
 * Opens Settings › Sessions: from the Archived header's menu (with Archived picked), the palette, or the sidebar's
 * session count. `focus` puts the keyboard on the archive days or the delete switch.
 */
export function openSessionManager(options: { status?: ManagerFilters['status']; focus?: SessionsFocus } = {}): void {
  const store = useSessionManager.getState();
  // Opened to show Archived: the other filters would hide some of them.
  if (options.status) store.setFilters({ ...DEFAULT_FILTERS, status: options.status });
  if (options.focus) useSessionManager.setState({ focus: { target: options.focus, nonce: ++focusRequests } });
  useSessions.getState().openSettings('sessions');
}
