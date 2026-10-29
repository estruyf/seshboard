import { create } from 'zustand';
import type { PreviewKind } from '@seshboard/protocol/client';
import { useRightPanel } from './rightPanelStore.ts';

/** What the preview shows of a file: the rendered page, or its text. */
export type PreviewView = 'preview' | 'source';
/** Where a file opens: in the session's side panel (a tab beside Changes and Ask), or in a dialog over the window. */
export type PreviewPlacement = 'panel' | 'dialog';

const KEY = (kind: PreviewKind) => `ui.filePreviewView.${kind}`;
const WRAP_KEY = 'ui.filePreviewWrap';
const PLACEMENT_KEY = 'ui.filePreviewPlacement';

// Per window: kept in sessionStorage, so a reload keeps it and another window has its own.
// HTML opens on its source: a page can fail to render, its text always shows. Code has nothing to render.
const DEFAULT_VIEW: Record<PreviewKind, PreviewView> = { markdown: 'preview', html: 'source', code: 'source' };

const read = (key: string): string | null => {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Remembering is a convenience.
  }
};

const readView = (kind: PreviewKind): PreviewView => {
  const saved = read(KEY(kind));
  return saved === 'source' || saved === 'preview' ? saved : DEFAULT_VIEW[kind];
};

/** A file on show, and the lines a link pointed at. */
export interface PreviewTarget {
  /** Absolute. */
  path: string;
  /** The line to scroll to and mark, from 1. */
  line?: number;
  /** The last line marked, for a range (`a.ts:10-14`). */
  endLine?: number;
  /** The session it was opened from: its side panel shows it, and the dialog can go back there. Null outside a session. */
  sessionId: string | null;
  /** Goes up on every open, so opening the same file at the same line again scrolls back to it. */
  seq: number;
}

/** What opens a file: its path and, when the link named them, its lines. */
export interface OpenRequest {
  sessionId?: string | null;
  line?: number;
  endLine?: number;
}

interface FilePreviewState {
  /** The file in the dialog; null while it is closed. */
  dialog: PreviewTarget | null;
  /** The file in each session's side panel, while it is open there (it may sit behind another tab). */
  panels: ReadonlyMap<string, PreviewTarget>;
  /** Where a file opened from a session goes; one outside a session always opens in the dialog. */
  placement: PreviewPlacement;
  /** Preview | Source, remembered per kind of file for this window. */
  views: Record<PreviewKind, PreviewView>;
  /** Whether long lines of the source wrap (the default) rather than scroll sideways; one choice for every file in this window. */
  wrap: boolean;
  /** Opens a file where `placement` says (the dialog without a session); one that is open there shows this file instead. */
  open(path: string, request?: OpenRequest): void;
  /** Opens a file in the dialog, whatever `placement` says. */
  openDialog(path: string, request?: OpenRequest): void;
  close(): void;
  closePanel(sessionId: string): void;
  /** The session's panel moves to the dialog, and files open there from now on. */
  detach(sessionId: string): void;
  /** The dialog moves to the side panel of the session it came from, and files open there from now on. */
  dock(): void;
  setWrap(wrap: boolean): void;
  setView(kind: PreviewKind, view: PreviewView): void;
}

let seq = 0;
const target = (path: string, { sessionId = null, line, endLine }: OpenRequest = {}): PreviewTarget => ({
  path,
  sessionId,
  seq: ++seq,
  ...(line ? { line } : {}),
  ...(line && endLine && endLine > line ? { endLine } : {}),
});

const withPanel = (panels: ReadonlyMap<string, PreviewTarget>, sessionId: string, next: PreviewTarget | null) => {
  const copy = new Map(panels);
  if (next) copy.set(sessionId, next);
  else copy.delete(sessionId);
  return copy;
};

export const useFilePreview = create<FilePreviewState>()((set, get) => ({
  dialog: null,
  panels: new Map(),
  placement: read(PLACEMENT_KEY) === 'dialog' ? 'dialog' : 'panel',
  views: { markdown: readView('markdown'), html: readView('html'), code: readView('code') },
  wrap: read(WRAP_KEY) !== 'off',
  open: (path, request = {}) => {
    const { sessionId } = request;
    if (!sessionId || get().placement === 'dialog') return get().openDialog(path, request);
    set((s) => ({ panels: withPanel(s.panels, sessionId, target(path, request)) }));
    // Opened, it comes in front of the other tabs.
    useRightPanel.getState().setTab(sessionId, 'preview');
  },
  openDialog: (path, request) => set({ dialog: target(path, request) }),
  close: () => set({ dialog: null }),
  closePanel: (sessionId) => set((s) => ({ panels: withPanel(s.panels, sessionId, null) })),
  detach: (sessionId) => {
    const shown = get().panels.get(sessionId);
    write(PLACEMENT_KEY, 'dialog');
    set((s) => ({ placement: 'dialog', panels: withPanel(s.panels, sessionId, null), ...(shown ? { dialog: { ...shown, seq: ++seq } } : {}) }));
  },
  dock: () => {
    const shown = get().dialog;
    write(PLACEMENT_KEY, 'panel');
    set({ placement: 'panel' });
    if (!shown?.sessionId) return;
    set((s) => ({ dialog: null, panels: withPanel(s.panels, shown.sessionId!, { ...shown, seq: ++seq }) }));
    useRightPanel.getState().setTab(shown.sessionId, 'preview');
  },
  setWrap: (wrap) => {
    write(WRAP_KEY, wrap ? 'on' : 'off');
    set({ wrap });
  },
  setView: (kind, view) => {
    write(KEY(kind), view);
    set((s) => ({ views: { ...s.views, [kind]: view } }));
  },
}));

/** The file in a session's side panel, as it shows it; null while the panel is closed. */
export function useSessionPreview(sessionId: string): PreviewTarget | null {
  return useFilePreview((s) => s.panels.get(sessionId)) ?? null;
}
