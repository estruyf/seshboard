import { create } from 'zustand';
import { agentsToggleStep } from './agentsPanel.ts';
import { frontTab, useRightPanel } from './rightPanelStore.ts';

/** One session's web preview: the page it shows (null before one is picked) and whether it is at phone width. */
export interface SessionWeb {
  url: string | null;
  phone: boolean;
  /** Goes up when something asks the page to load `url` (an offer, the address bar), so the same address loads again. */
  seq: number;
}

interface WebPreviewState {
  /** The sessions whose Web tab is open (it may sit behind another tab). */
  sessions: ReadonlyMap<string, SessionWeb>;
  /** Goes up when the palette asks a session's page to reload. */
  reloads: ReadonlyMap<string, number>;
  /** Opens the tab in front; on `url` when given, else on the page it had. */
  open(sessionId: string, url?: string | null): void;
  close(sessionId: string): void;
  /** The page moved on by itself (a link, back): remembered, not loaded again. */
  shown(sessionId: string, url: string): void;
  setPhone(sessionId: string, phone: boolean): void;
  reload(sessionId: string): void;
}

let seq = 0;

export const useWebPreview = create<WebPreviewState>()((set) => ({
  sessions: new Map(),
  reloads: new Map(),
  open: (sessionId, url) => {
    set((s) => {
      const before = s.sessions.get(sessionId);
      const next: SessionWeb = url ? { url, phone: before?.phone ?? false, seq: ++seq } : (before ?? { url: null, phone: false, seq: ++seq });
      return { sessions: new Map(s.sessions).set(sessionId, next) };
    });
    useRightPanel.getState().setTab(sessionId, 'web');
  },
  close: (sessionId) =>
    set((s) => {
      if (!s.sessions.has(sessionId)) return s;
      const sessions = new Map(s.sessions);
      sessions.delete(sessionId);
      return { sessions };
    }),
  shown: (sessionId, url) =>
    set((s) => {
      const before = s.sessions.get(sessionId);
      return !before || before.url === url ? s : { sessions: new Map(s.sessions).set(sessionId, { ...before, url }) };
    }),
  setPhone: (sessionId, phone) =>
    set((s) => {
      const before = s.sessions.get(sessionId);
      return !before ? s : { sessions: new Map(s.sessions).set(sessionId, { ...before, phone }) };
    }),
  reload: (sessionId) => set((s) => ({ reloads: new Map(s.reloads).set(sessionId, (s.reloads.get(sessionId) ?? 0) + 1) })),
}));

/** A session's web preview, as it shows it; null while its tab is closed. */
export function useSessionWeb(sessionId: string): SessionWeb | null {
  return useWebPreview((s) => s.sessions.get(sessionId)) ?? null;
}

export const isWebOpen = (sessionId: string | null) => !!sessionId && useWebPreview.getState().sessions.has(sessionId);

/** The header's Web button, its shortcut and the palette: open, bring to the front, or close. `othersOpen`: another right panel is open too. */
export function toggleWebPanel(sessionId: string, othersOpen: boolean, url?: string | null): void {
  const step = agentsToggleStep(isWebOpen(sessionId), frontTab(sessionId) === 'web', othersOpen);
  if (step === 'close') useWebPreview.getState().close(sessionId);
  else useWebPreview.getState().open(sessionId, isWebOpen(sessionId) ? null : url);
}
