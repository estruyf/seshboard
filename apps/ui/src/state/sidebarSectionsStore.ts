import { useEffect } from 'react';
import { create } from 'zustand';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useHosts } from './hostsStore.ts';
import { usePipelineTree } from './pipelineTreeStore.ts';
import { usePreferences } from './preferencesStore.ts';
import { toRows, useSessions } from './sessionsStore.ts';
import { useSidebar } from './sidebarStore.ts';
import { sectionOfSession } from './sidebarRows.ts';
import { DEFAULT_SECTIONS, isSectionKey, parseSections, toggleAllSections, type SectionKey, type SectionsOpen } from './sidebarSections.ts';

const SECTIONS_KEY = 'ui.sidebarSections';

interface SectionsStore {
  open: SectionsOpen;
  /** The saved state has been read: until then nothing is written back. */
  loaded: boolean;
  /** The open sidebar should scroll its list to this section's header (from the rail). */
  reveal: { section: SectionKey; seq: number } | null;
  setOpen(section: SectionKey, open: boolean): void;
  toggle(section: SectionKey): void;
  /** ⌥-click: every section follows the clicked one. */
  toggleAll(clicked: SectionKey): void;
  /** Opens the sidebar (from the rail), the section, and scrolls to it. */
  showSection(section: SectionKey): void;
  load(open: SectionsOpen): void;
}

let reveals = 0;

export const useSidebarSections = create<SectionsStore>()((set) => ({
  open: DEFAULT_SECTIONS,
  loaded: false,
  reveal: null,
  setOpen: (section, open) => set((s) => (s.open[section] === open ? {} : { open: { ...s.open, [section]: open } })),
  toggle: (section) => set((s) => ({ open: { ...s.open, [section]: !s.open[section] } })),
  toggleAll: (clicked) => set((s) => ({ open: toggleAllSections(s.open, clicked) })),
  showSection: (section) => {
    set((s) => ({ open: { ...s.open, [section]: true }, reveal: { section, seq: ++reveals } }));
    useSidebar.getState().setState('open');
  },
  load: (open) => set({ open, loaded: true }),
}));

/**
 * Restores which sections are open and saves changes. Opening a session in a closed section (⌘P, ⌃⇥, a
 * notification, Home, the needs-you pill) opens that section, and opening a pipeline's sub-session opens its parent:
 * every way in goes through `select`, so this follows the selection rather than each of them.
 */
export function useSidebarSectionsSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const open = useSidebarSections((s) => s.open);
  const loaded = useSidebarSections((s) => s.loaded);

  useEffect(() => {
    if (!client) return;
    void client.call('appState.get', { key: SECTIONS_KEY }).then(
      ({ value }) => useSidebarSections.getState().load(parseSections(value)),
      () => useSidebarSections.getState().load(DEFAULT_SECTIONS),
    );
  }, [client]);

  useEffect(() => {
    if (client && loaded) void client.call('appState.set', { key: SECTIONS_KEY, value: { open } });
  }, [client, loaded, open]);

  useEffect(
    () =>
      useSessions.subscribe((state, previous) => {
        const id = state.selectedId;
        if (!id || id === previous.selectedId) return;
        const rows = toRows(state.sessions, state.live, useHosts.getState().hosts);
        const section = sectionOfSession(rows, id, Date.now(), usePreferences.getState().prefs.archiveAfterDays);
        if (isSectionKey(section)) useSidebarSections.getState().setOpen(section, true);
        // A pipeline's sub-session opens its parent in the tree, so its row is in sight.
        const parentId = state.sessions.get(id)?.parentId;
        if (parentId) usePipelineTree.getState().setOpen(parentId, true);
      }),
    [],
  );
}
