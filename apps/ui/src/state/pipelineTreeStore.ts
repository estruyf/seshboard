import { useEffect } from 'react';
import { create } from 'zustand';
import { useSessions } from './sessionsStore.ts';

// Which parents list their sub-sessions in the sidebar (pipelines, #179). Closed by default, kept per window.

interface TreeState {
  open: ReadonlySet<string>;
  setOpen(id: string, open: boolean): void;
  toggle(id: string): void;
}

export const usePipelineTree = create<TreeState>()((set) => ({
  open: new Set(),
  setOpen: (id, open) =>
    set((s) => {
      if (s.open.has(id) === open) return {};
      const next = new Set(s.open);
      if (open) next.add(id);
      else next.delete(id);
      return { open: next };
    }),
  toggle: (id) => usePipelineTree.getState().setOpen(id, !usePipelineTree.getState().open.has(id)),
}));

/** Opening a sub-session (a click in the panel, a notification, a search) opens its parent in the list so its row is there. */
export function usePipelineTreeSync(): void {
  useEffect(
    () =>
      useSessions.subscribe((state, previous) => {
        const id = state.selectedId;
        if (!id || id === previous.selectedId) return;
        const parent = state.sessions.get(id)?.parentId;
        if (parent) usePipelineTree.getState().setOpen(parent, true);
      }),
    [],
  );
}
