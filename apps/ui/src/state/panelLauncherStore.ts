import { create } from 'zustand';

/**
 * The sessions whose side panel is open with nothing in it (the rail's Show panel, or Show side panel in the palette),
 * per session like Agents and Commands. Not kept across restarts, as the other panels aren't. The session view clears it
 * once a tool opens on the side, so closing that tool closes the side as before.
 */
export const usePanelLauncher = create<{ open: ReadonlySet<string>; set(sessionId: string, open: boolean): void }>()((set) => ({
  open: new Set(),
  set: (sessionId, open) =>
    set((s) => {
      if (s.open.has(sessionId) === open) return s;
      const next = new Set(s.open);
      if (open) next.add(sessionId);
      else next.delete(sessionId);
      return { open: next };
    }),
}));

export const openPanelLauncher = (sessionId: string) => usePanelLauncher.getState().set(sessionId, true);
export const closePanelLauncher = (sessionId: string) => usePanelLauncher.getState().set(sessionId, false);
