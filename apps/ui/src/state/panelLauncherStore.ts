import { create } from 'zustand';

/**
 * The sessions whose side panel is open with nothing in it (the rail's Show panel, or Show side panel in the palette),
 * per session like Agents and Commands. Not kept across restarts, as the other panels aren't. The session view clears it
 * once a tool opens on the side, so closing that tool closes the side as before.
 */
export const usePanelLauncher = create<{
  open: ReadonlySet<string>;
  /** Opened without taking the focus (a new session, where the message box keeps it). */
  quiet: ReadonlySet<string>;
  set(sessionId: string, open: boolean, quiet?: boolean): void;
}>()((set) => ({
  open: new Set(),
  quiet: new Set(),
  set: (sessionId, open, quiet = false) =>
    set((s) => {
      if (s.open.has(sessionId) === open && s.quiet.has(sessionId) === (open && quiet)) return s;
      const next = new Set(s.open);
      const nextQuiet = new Set(s.quiet);
      if (open) next.add(sessionId);
      else next.delete(sessionId);
      if (open && quiet) nextQuiet.add(sessionId);
      else nextQuiet.delete(sessionId);
      return { open: next, quiet: nextQuiet };
    }),
}));

/** Opens the empty side panel; `quiet` leaves the focus where it is. */
export const openPanelLauncher = (sessionId: string, options: { quiet?: boolean } = {}) => usePanelLauncher.getState().set(sessionId, true, options.quiet);
export const closePanelLauncher = (sessionId: string) => usePanelLauncher.getState().set(sessionId, false);
