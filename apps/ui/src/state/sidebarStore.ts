import { useEffect } from 'react';
import { create } from 'zustand';
import { useEngineConnection } from '../engine/useEngine.ts';
import { usePreferences } from './preferencesStore.ts';
import { clampSidebarWidth, fitSidebar, parseSidebarState, SIDEBAR_DEFAULT_WIDTH, toggledState, type SidebarSnap, type SidebarState } from './sidebarWidth.ts';

const SIDEBAR_KEY = 'ui.sidebar';

interface SidebarStore {
  /** The open width: kept while the sidebar is minimal or closed, so opening it again restores it. */
  width: number;
  state: SidebarState;
  /** The window's width in CSS pixels (fewer when zoomed in), which can narrow what shows (`fitSidebar`). */
  viewport: number;
  setWidth(width: number): void;
  setState(state: SidebarState): void;
  setViewport(viewport: number): void;
  /** ⌘B: open goes to what "When collapsed" says in Settings, minimal or closed opens. */
  toggle(): void;
}

export const useSidebar = create<SidebarStore>()((set) => ({
  width: SIDEBAR_DEFAULT_WIDTH,
  state: 'open',
  viewport: window.innerWidth,
  setWidth: (width) => set({ width: clampSidebarWidth(width) }),
  setState: (state) => set({ state }),
  setViewport: (viewport) => set({ viewport }),
  // Shown as the rail only because the window is too small, there is no room to open it: ⌘B hides it.
  toggle: () => set((s) => (fitSidebar(s.state, s.width, s.viewport).state !== s.state ? { state: 'closed' } : { state: toggledState(s.state, usePreferences.getState().prefs.sidebarCollapsed) })),
}));

/** How the sidebar shows right now: the saved state and width, narrowed to fit the window (`fitSidebar`). */
export function useShownSidebar(): SidebarSnap {
  const state = useSidebar((s) => s.state);
  const width = useSidebar((s) => s.width);
  const viewport = useSidebar((s) => s.viewport);
  return fitSidebar(state, width, viewport);
}

/** Restores the sidebar's width and state from the engine's app state and saves them (debounced) when they change. */
export function useSidebarSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const width = useSidebar((s) => s.width);
  const state = useSidebar((s) => s.state);
  const shown = useShownSidebar().state;

  // Resizing the window and zooming both change its width in CSS pixels.
  useEffect(() => {
    const onResize = () => useSidebar.getState().setViewport(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!client) return;
    void client.call('appState.get', { key: SIDEBAR_KEY }).then(({ value }) => {
      const stored = value as { width?: unknown; state?: unknown } | null;
      if (typeof stored?.width === 'number') useSidebar.getState().setWidth(stored.width);
      if (stored && 'state' in stored) useSidebar.getState().setState(parseSidebarState(stored.state));
    });
  }, [client]);

  useEffect(() => {
    if (!client) return;
    const timer = setTimeout(() => void client.call('appState.set', { key: SIDEBAR_KEY, value: { width, state } }), 300);
    return () => clearTimeout(timer);
  }, [client, width, state]);

  // The traffic lights move into the rail while it shows, and back for the open sidebar and the headers.
  useEffect(() => window.seshboard?.setWindowButtons?.(shown === 'minimal' ? 'rail' : 'default'), [shown]);
}
