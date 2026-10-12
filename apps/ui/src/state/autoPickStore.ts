import { create } from 'zustand';

const STORAGE_KEY = 'switchboard.autoSuggest';

/** Sessions where a stronger model was suggested: `shown` until you answer it, then `answered`. Kept across restarts. */
type Suggested = Record<string, 'shown' | 'answered'>;

function readSuggested(): Suggested {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown;
    return raw && typeof raw === 'object' ? (raw as Suggested) : {};
  } catch {
    return {};
  }
}

interface AutoPickState {
  /** The "Auto picked Sonnet" popover: its session and where it opens (above or below that point). */
  popover: { sessionId: string; x: number; y: number; above: boolean } | null;
  openPopover(sessionId: string, anchor: DOMRect): void;
  closePopover(): void;
  suggested: Suggested;
  /** The suggestion showed in this session; it stays until answered, and never comes back after. */
  markSuggested(sessionId: string, state: 'shown' | 'answered'): void;
}

export const useAutoPick = create<AutoPickState>((set, get) => ({
  popover: null,
  // Above the chip at the bottom of the window; below the Why link near the top.
  openPopover: (sessionId, anchor) => {
    const above = anchor.top > window.innerHeight / 2;
    set({ popover: { sessionId, x: anchor.left, y: above ? anchor.top - 6 : anchor.bottom + 6, above } });
  },
  closePopover: () => set({ popover: null }),
  suggested: readSuggested(),
  markSuggested: (sessionId, state) => {
    if (get().suggested[sessionId] === state) return;
    const suggested = { ...get().suggested, [sessionId]: state };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(suggested));
    set({ suggested });
  },
}));
