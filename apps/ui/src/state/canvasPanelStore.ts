import { create } from 'zustand';
import { toggleCanvas } from '../components/canvas/canvasPanel.ts';

/**
 * Which of the project's canvases each session has open in its side panel (docs/canvases.md), and each session's folder,
 * which is where its canvases run. Not kept across restarts.
 */
interface CanvasPanels {
  open: Map<string, string[]>;
  /** The folder of each session with a canvas open, for telling the engine what this window uses. */
  folders: Map<string, string>;
  setOpen(sessionId: string, canvasId: string, on: boolean, cwd?: string): void;
  closeAll(sessionId: string): void;
}

const NONE: string[] = [];

export const useCanvasPanels = create<CanvasPanels>()((set) => ({
  open: new Map(),
  folders: new Map(),
  setOpen: (sessionId, canvasId, on, cwd) =>
    set((s) => {
      const next = toggleCanvas(s.open.get(sessionId) ?? NONE, canvasId, on);
      return { open: new Map(s.open).set(sessionId, next), folders: cwd ? new Map(s.folders).set(sessionId, cwd) : s.folders };
    }),
  closeAll: (sessionId) =>
    set((s) => {
      if (!s.open.get(sessionId)?.length) return s;
      const open = new Map(s.open);
      open.delete(sessionId);
      return { open };
    }),
}));

/** The canvases a session has open, in the order they were opened. */
export const useOpenCanvases = (sessionId: string): string[] => useCanvasPanels((s) => s.open.get(sessionId) ?? NONE);

/** What this window has open, for the engine: each folder and canvas once, as `cwd\nid`. Pure, for its test. */
export function viewedCanvases(open: ReadonlyMap<string, readonly string[]>, folders: ReadonlyMap<string, string>): Set<string> {
  const viewed = new Set<string>();
  for (const [sessionId, ids] of open) {
    const cwd = folders.get(sessionId);
    if (cwd) for (const id of ids) viewed.add(`${cwd}\n${id}`);
  }
  return viewed;
}
