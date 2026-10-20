import { create } from 'zustand';
import type { PreviewKind } from '@switchboard/protocol/client';

/** What the preview shows of a file: the rendered page, or its text. */
export type PreviewView = 'preview' | 'source';

const KEY = (kind: PreviewKind) => `ui.filePreviewView.${kind}`;

// Per window: kept in sessionStorage, so a reload keeps it and another window has its own.
const readView = (kind: PreviewKind): PreviewView => {
  try {
    return sessionStorage.getItem(KEY(kind)) === 'source' ? 'source' : 'preview';
  } catch {
    return 'preview';
  }
};

interface FilePreviewState {
  /** The absolute path of the file the preview shows; null while it is closed. */
  path: string | null;
  /** Preview | Source, remembered per kind of file for this window. */
  views: Record<PreviewKind, PreviewView>;
  /** Opens the preview; one that is open shows this file instead. */
  open(path: string): void;
  close(): void;
  setView(kind: PreviewKind, view: PreviewView): void;
}

export const useFilePreview = create<FilePreviewState>()((set) => ({
  path: null,
  views: { markdown: readView('markdown'), html: readView('html') },
  open: (path) => set({ path }),
  close: () => set({ path: null }),
  setView: (kind, view) => {
    try {
      sessionStorage.setItem(KEY(kind), view);
    } catch {
      // Remembering is a convenience.
    }
    set((s) => ({ views: { ...s.views, [kind]: view } }));
  },
}));
