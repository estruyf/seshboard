import { create } from 'zustand';
import type { PaletteMode } from '../components/palette/paletteState.ts';
import type { SheetMode } from '../components/shortcuts/shortcutSheet.ts';

const WRAP_KEY = 'ui.diffWrap';
const writeFlag = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Remembering is a convenience.
  }
};
const readFlag = (key: string) => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

/** Full-window overlays (search, command palette), and cross-component requests. */
interface OverlayState {
  /** `tools`: the current session's MCP servers, skills, agents and plugins. `shortcuts`: the shortcuts sheet (⌘/). */
  open: 'search' | 'palette' | 'tools' | 'shortcuts' | null;
  /** Set by search: the session view scrolls to this message and highlights it once. */
  focusMessage: { sessionId: string; messageUuid: string } | null;
  /** Wrap long lines in diffs instead of scrolling sideways, remembered across launches. */
  diffWrap: boolean;
  /** The palette asks the session's actions bar to run an action (so confirm and trust prompts apply). */
  actionRequest: { id: string; nonce: number } | null;
  /** The mode the command palette opens in (⌘K and ⌘⇧P: commands, ⌘P: go to), and a count that resets it when it opens again. */
  palette: { mode: PaletteMode; nonce: number };
  /** The shortcuts sheet's All or Here, kept while the window is open. */
  shortcutsMode: SheetMode;
  /** What search opens on: everything, or only memory (Search memory…). */
  searchMode: 'all' | 'memory';
  /** Opens search on memory only. */
  searchMemory(): void;
  show(which: 'search' | 'palette' | 'tools' | 'shortcuts'): void;
  /** Opens the shortcuts sheet, or closes it when it's open (⌘/, Help › Keyboard Shortcuts). */
  toggleShortcuts(): void;
  setShortcutsMode(mode: SheetMode): void;
  /** Opens the palette in a mode; the same shortcut again closes it, another one switches mode. */
  togglePalette(mode: PaletteMode): void;
  close(): void;
  focus(target: { sessionId: string; messageUuid: string } | null): void;
  toggleDiffWrap(): void;
  requestAction(id: string | null): void;
}

export const useOverlay = create<OverlayState>()((set) => ({
  open: null,
  focusMessage: null,
  diffWrap: readFlag(WRAP_KEY),
  actionRequest: null,
  palette: { mode: 'commands', nonce: 0 },
  shortcutsMode: 'all',
  searchMode: 'all',
  searchMemory: () => set({ open: 'search', searchMode: 'memory' }),
  show: (open) => set(open === 'search' ? { open, searchMode: 'all' } : { open }),
  toggleShortcuts: () => set((s) => ({ open: s.open === 'shortcuts' ? null : 'shortcuts' })),
  setShortcutsMode: (shortcutsMode) => set({ shortcutsMode }),
  togglePalette: (mode) =>
    set((s) => (s.open === 'palette' && s.palette.mode === mode ? { open: null } : { open: 'palette', palette: { mode, nonce: s.palette.nonce + 1 } })),
  close: () => set({ open: null }),
  focus: (focusMessage) => set({ focusMessage }),
  toggleDiffWrap: () =>
    set((s) => {
      writeFlag(WRAP_KEY, !s.diffWrap);
      return { diffWrap: !s.diffWrap };
    }),
  requestAction: (id) => set({ actionRequest: id ? { id, nonce: Date.now() } : null }),
}));
