import { create } from 'zustand';
import type { PreviewKind } from '@switchboard/protocol/client';

/** What the preview shows of a file: the rendered page, or its text. */
export type PreviewView = 'preview' | 'source';

const KEY = (kind: PreviewKind) => `ui.filePreviewView.${kind}`;

// Per window: kept in sessionStorage, so a reload keeps it and another window has its own.
// HTML opens on its source: a page can fail to render, its text always shows. Code has nothing to render.
const DEFAULT_VIEW: Record<PreviewKind, PreviewView> = { markdown: 'preview', html: 'source', code: 'source' };

const readView = (kind: PreviewKind): PreviewView => {
  try {
    const saved = sessionStorage.getItem(KEY(kind));
    return saved === 'source' || saved === 'preview' ? saved : DEFAULT_VIEW[kind];
  } catch {
    return DEFAULT_VIEW[kind];
  }
};

const WRAP_KEY = 'ui.filePreviewWrap';
const readWrap = (): boolean => {
  try {
    return sessionStorage.getItem(WRAP_KEY) !== 'off';
  } catch {
    return true;
  }
};

interface FilePreviewState {
  /** The absolute path of the file the preview shows; null while it is closed. */
  path: string | null;
  /** Preview | Source, remembered per kind of file for this window. */
  views: Record<PreviewKind, PreviewView>;
  /** Whether long lines of the source wrap (the default) rather than scroll sideways; one choice for every file in this window. */
  wrap: boolean;
  /** Opens the preview; one that is open shows this file instead. */
  open(path: string): void;
  close(): void;
  setWrap(wrap: boolean): void;
  setView(kind: PreviewKind, view: PreviewView): void;
}

export const useFilePreview = create<FilePreviewState>()((set) => ({
  path: null,
  views: { markdown: readView('markdown'), html: readView('html'), code: readView('code') },
  wrap: readWrap(),
  open: (path) => set({ path }),
  close: () => set({ path: null }),
  setWrap: (wrap) => {
    try {
      sessionStorage.setItem(WRAP_KEY, wrap ? 'on' : 'off');
    } catch {
      // Remembering is a convenience.
    }
    set({ wrap });
  },
  setView: (kind, view) => {
    try {
      sessionStorage.setItem(KEY(kind), view);
    } catch {
      // Remembering is a convenience.
    }
    set((s) => ({ views: { ...s.views, [kind]: view } }));
  },
}));
