import type { MainWindowRequest, SessionView } from '@seshboard/protocol/bridge';
import { create } from 'zustand';

/** The session this window shows on its own when it is a pop-out; null in the main window. */
export const popoutSession: string | null = typeof window === 'undefined' ? null : (window.seshboard?.popout ?? null);

/** The session whose browser this window shows on its own when it is a browser window (`?browserpopout=<id>`); null elsewhere. */
export const browserPopoutSession: string | null = typeof window === 'undefined' ? null : (window.seshboard?.browserPopout ?? null);

/** This window is the menu bar's panel (`?menubar=1`). */
export const menuBarWindow: boolean = typeof window === 'undefined' ? false : (window.seshboard?.menuBar ?? false);

/** This window is the quick start panel (`?quickstart=1`), which the global shortcut opens over any app. */
export const quickStartWindow: boolean = typeof window === 'undefined' ? false : (window.seshboard?.quickStart ?? false);

/**
 * Not the main window: a pop-out, a browser window, the menu bar's panel or the quick start panel. Such a window saves nothing of the
 * main window's (its selection, the sidebar's filter, the terminal panel) and does none of its app-wide work.
 */
export const secondaryWindow: boolean = popoutSession !== null || browserPopoutSession !== null || menuBarWindow || quickStartWindow;

interface PopoutsState {
  /** Sessions shown in a window of their own, as main reports them (`onPopoutsChanged`). */
  ids: ReadonlySet<string>;
  setIds(ids: readonly string[]): void;
}

export const usePopouts = create<PopoutsState>()((set) => ({
  ids: new Set(typeof window === 'undefined' ? [] : (window.seshboard?.popouts ?? [])),
  setIds: (ids) => set({ ids: new Set(ids) }),
}));

interface BrowserPopoutsState {
  /** Sessions whose browser is in a window of its own, with how many tabs it has, as main reports them (`onBrowserPopoutsChanged`). */
  tabs: ReadonlyMap<string, number>;
  setTabs(tabs: Readonly<Record<string, number>>): void;
  /** A session's browser leaves this window now, before main says so: its tabs go at once. */
  leaving(sessionId: string, count: number): void;
}

export const useBrowserPopouts = create<BrowserPopoutsState>()((set) => ({
  tabs: new Map(Object.entries(typeof window === 'undefined' ? {} : (window.seshboard?.browserPopouts ?? {}))),
  setTabs: (tabs) => set({ tabs: new Map(Object.entries(tabs)) }),
  leaving: (sessionId, count) => set((s) => ({ tabs: new Map(s.tabs).set(sessionId, count) })),
}));

/** A session's browser is in a window of its own (never true in that window itself). */
export function browserElsewhere(sessionId: string): boolean {
  if (browserPopoutSession) return false;
  return useBrowserPopouts.getState().tabs.has(sessionId);
}

/**
 * A session shown in another window than this one: its pop-out, or (from a pop-out) any other session, which
 * lives in the main window.
 */
export function shownElsewhere(id: string): boolean {
  if (popoutSession) return id !== popoutSession;
  return usePopouts.getState().ids.has(id);
}

/**
 * In a pop-out, asks the main window to show a view this window doesn't have (Settings, Usage, a project, New
 * session) and returns true, so the caller stops. In the main window it does nothing and returns false.
 */
export function showInMain(request: MainWindowRequest): boolean {
  if (!popoutSession) return false;
  window.seshboard?.showInMain(request);
  return true;
}

/** How this window has a session's panels, set by `useSessionViewHandoff` (the panel stores import this file, so it can't import them). */
let readView: ((sessionId: string) => SessionView) | null = null;

export function provideSessionView(read: ((sessionId: string) => SessionView) | null): void {
  readView = read;
}

/**
 * Shows a session in a window of its own (or brings its pop-out to the front). Unsent text is relayed to the
 * pop-out by main, and the session's open panels go with it (a pop-out that exists keeps its own); the panes here
 * close it when main says it is out (`usePopoutsSync`).
 */
export function popOut(id: string): void {
  window.seshboard?.popOut(id, readView?.(id));
}
