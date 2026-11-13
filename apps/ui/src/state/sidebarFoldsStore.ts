import { create } from 'zustand';

const FOLDS_KEY = 'ui.sidebarFolds';

/** The folded projects as saved: a list of project keys (folders, or a remote project's key). Anything else reads as none. */
export function parseFolds(value: string | null): Set<string> {
  try {
    const parsed: unknown = value ? JSON.parse(value) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string' && key.length > 0 && key.length <= 4096).slice(0, 500) : []);
  } catch {
    return new Set();
  }
}

const read = (): Set<string> => {
  try {
    return parseFolds(localStorage.getItem(FOLDS_KEY));
  } catch {
    return new Set();
  }
};
const write = (folded: ReadonlySet<string>) => {
  try {
    localStorage.setItem(FOLDS_KEY, JSON.stringify([...folded]));
  } catch {
    // Remembering is a convenience.
  }
};

/**
 * Which projects are folded while the sidebar groups by project, kept per project in this computer's storage. ⌥-click
 * (and Collapse all projects) folds or unfolds them all: `all` lists the projects on screen.
 */
interface FoldsStore {
  folded: ReadonlySet<string>;
  setFolded(key: string, folded: boolean): void;
  toggle(key: string): void;
  /** Every project in `all` follows `key`: folded when it was open, open when it was folded. */
  toggleAll(key: string, all: readonly string[]): void;
  /** Collapse all projects, or Expand all projects when they are all folded. */
  foldAll(all: readonly string[], folded: boolean): void;
}

const save = (folded: Set<string>) => (write(folded), { folded });

export const useSidebarFolds = create<FoldsStore>()((set) => ({
  folded: read(),
  setFolded: (key, folded) =>
    set((s) => {
      if (s.folded.has(key) === folded) return {};
      const next = new Set(s.folded);
      if (folded) next.add(key);
      else next.delete(key);
      return save(next);
    }),
  toggle: (key) =>
    set((s) => {
      const next = new Set(s.folded);
      if (!next.delete(key)) next.add(key);
      return save(next);
    }),
  toggleAll: (key, all) =>
    set((s) => {
      const fold = !s.folded.has(key);
      const next = new Set(s.folded);
      for (const k of all) {
        if (fold) next.add(k);
        else next.delete(k);
      }
      return save(next);
    }),
  foldAll: (all, folded) =>
    set((s) => {
      const next = new Set(s.folded);
      for (const k of all) {
        if (folded) next.add(k);
        else next.delete(k);
      }
      return save(next);
    }),
}));
