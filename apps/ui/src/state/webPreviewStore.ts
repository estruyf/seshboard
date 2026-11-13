import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { agentsToggleStep } from './agentsPanel.ts';
import { usePreferences } from './preferencesStore.ts';
import { frontTab as frontRightTab, useRightPanel } from './rightPanelStore.ts';
import {
  BROWSER_OWNER,
  closeTab,
  dropOwner,
  frontTab,
  moveTab,
  stepTab,
  NO_TABS,
  openTab,
  ownerTabs,
  pinTab,
  rememberClosed,
  restore,
  takeClosed,
  showTab,
  unpinTab,
  updateTab,
  cleanTabName,
  type BrowserTab,
  type SavedTab,
  type TabsState,
} from '../components/webPreview/browserTabs.ts';

/** One session's web preview as another window takes it over: the page in front and whether it is at phone width. */
export interface SessionWeb {
  url: string | null;
  phone: boolean;
  /** Goes up when something asks the page to load `url` (an offer, the address bar), so the same address loads again. */
  seq: number;
}

/** A session's Browser panel as its view shows it: the tab in front (none on a panel of pinned tabs not shown yet) and its tabs in order. */
export interface PanelWeb {
  tab: BrowserTab | null;
  tabs: readonly BrowserTab[];
  /** The panel takes the whole session area instead of the side. */
  full: boolean;
}

/** Settings › General › Enable browser: any web page, tabs and pins. Off, one local page per session, as before. */
export const browserOn = (): boolean => usePreferences.getState().prefs.browserEnabled;

/** A web page may show at all: the browser is on, or Settings › General › New sessions › Allow browser previews. */
export const previewAllowed = (): boolean => usePreferences.getState().prefs.browserEnabled || usePreferences.getState().prefs.webPreview;

/** `previewAllowed`, for a view: the Web button and the Open preview offers show only then. */
export function usePreviewAllowed(): boolean {
  return usePreferences((s) => s.prefs.browserEnabled || s.prefs.webPreview);
}

interface WebPreviewState extends TabsState {
  /** The sessions whose Browser (Web) panel is open; it may sit behind another tab. */
  panels: ReadonlySet<string>;
  /** Sessions whose panel takes the whole session area. */
  full: ReadonlySet<string>;
  /** Goes up when the palette asks a tab's page to reload. */
  reloads: ReadonlyMap<string, number>;
  /** Opens a session's panel in front; on `url` when given (a tab on it), else on the tab it had. */
  open(sessionId: string, url?: string | null): void;
  /** Closes a session's panel. With the browser on its pinned tabs stay and the others close; off, its page goes. */
  close(sessionId: string): void;
  /** Hides a session's panel (its Browser button, Escape): every tab stays as it was, for when it is shown again. */
  hide(sessionId: string): void;
  /** Opens `url` (null: an empty tab) for an owner, or shows the tab it has on that address. The tab's id. */
  openTab(owner: string, url: string | null, options?: { focus?: boolean }): string;
  selectTab(id: string): void;
  closeTab(id: string): void;
  /** The pinned tab asked to close once (a middle click, its ×, ⌘W), for `CONFIRM_CLOSE_MS`: the next ask closes it. */
  confirming: string | null;
  /** Closes a tab, but a pinned one only when asked twice: the first ask marks it (`confirming`). */
  askClose(id: string): void;
  /** Tabs closed lately, newest last, for ⌘⇧T. */
  closed: readonly BrowserTab[];
  /** Opens the tab closed last again (of `owner` when given); the owner it opened for, or null with none. */
  reopenTab(owner?: string): string | null;
  pin(id: string): void;
  unpin(id: string): void;
  move(id: string, index: number): void;
  /** Moves a tab one place earlier (-1) or later (1), inside its group (⌥ and an arrow on the tab). */
  step(id: string, step: 1 | -1): void;
  /** Asks a tab's page to load `url` (the address bar). */
  navigate(id: string, url: string): void;
  /** The page moved on by itself (a link, back): remembered, not loaded again. */
  shown(id: string, url: string): void;
  titled(id: string, title: string): void;
  /** Gives a tab a name of your own (Rename tab); empty gives it the page's title again. */
  rename(id: string, name: string): void;
  iconed(id: string, favicon: string | null): void;
  setPhone(id: string, phone: boolean): void;
  /** A tab's zoom (a factor, 1 is 100%), kept with the tab. */
  zoomTo(id: string, zoom: number): void;
  setMuted(id: string, muted: boolean): void;
  /** Its page started or stopped playing sound (main, `audio`). */
  heard(id: string, audible: boolean): void;
  setFull(sessionId: string, full: boolean): void;
  /** The palette: the front page of a session's panel reloads. */
  reload(sessionId: string): void;
  /** The pinned tabs the engine kept, added without loading their pages. */
  restorePinned(saved: readonly SavedTab[]): void;
  /** A session deleted: its tabs and panel go. */
  forget(sessionId: string): void;
  /** Another window hands over a session's panel (`sessionView.ts`); null closes it. */
  handOver(sessionId: string, web: SessionWeb | null): void;
}

/** How long a pinned tab waits for the second ask that closes it. */
export const CONFIRM_CLOSE_MS = 3_000;

let seq = 0;
let ids = 0;
let unconfirm: ReturnType<typeof setTimeout> | undefined;
const newId = () => `tab-${Date.now().toString(36)}-${(++ids).toString(36)}`;

const without = <T>(set: ReadonlySet<T>, value: T) => {
  if (!set.has(value)) return set;
  const next = new Set(set);
  next.delete(value);
  return next;
};
const withValue = <T>(set: ReadonlySet<T>, value: T) => (set.has(value) ? set : new Set(set).add(value));

export const useWebPreview = create<WebPreviewState>()((set, get) => {
  const tabs = (change: (state: TabsState) => TabsState) =>
    set((s) => {
      const next = change(s);
      return next === s ? s : { tabs: next.tabs, active: next.active };
    });
  return {
    ...NO_TABS,
    closed: [],
    confirming: null,
    panels: new Set(),
    full: new Set(),
    reloads: new Map(),
    open: (sessionId, url) => {
      if (!previewAllowed()) return;
      const front = frontTab(get(), sessionId);
      if (!browserOn()) {
        // One page per session, as the web preview always had: a new address loads in it.
        if (front && url) get().navigate(front.id, url);
        else if (!front) get().openTab(sessionId, url ?? null);
      } else if (url) get().openTab(sessionId, url);
      else if (!front) {
        // Pinned tabs not shown yet: the first comes forward; none at all, an empty tab.
        const first = ownerTabs(get(), sessionId)[0];
        if (first) get().selectTab(first.id);
        else get().openTab(sessionId, null);
      } else get().selectTab(front.id);
      set((s) => ({ panels: withValue(s.panels, sessionId) }));
      useRightPanel.getState().setTab(sessionId, 'web');
    },
    close: (sessionId) => {
      if (!browserOn()) tabs((s) => dropOwner(s, sessionId));
      else {
        // The tabs you didn't pin go with the panel (⌘⇧T brings one back); pinned ones stay for next time.
        const loose = get().tabs.filter((t) => t.owner === sessionId && !t.pinned);
        set((s) => ({ closed: loose.reduce(rememberClosed, s.closed) }));
        tabs((s) => loose.reduce((state, t) => closeTab(state, t.id), s));
      }
      set((s) => ({ panels: without(s.panels, sessionId), full: without(s.full, sessionId) }));
    },
    hide: (sessionId) => set((s) => ({ panels: without(s.panels, sessionId), full: without(s.full, sessionId) })),
    openTab: (owner, url, options = {}) => {
      let id = '';
      tabs((s) => {
        const result = openTab(s, owner, url, { id: newId(), now: Date.now(), seq: ++seq, focus: options.focus });
        id = result.id;
        return result.state;
      });
      return id;
    },
    selectTab: (id) => tabs((s) => showTab(s, id, Date.now())),
    closeTab: (id) => {
      const tab = get().tabs.find((t) => t.id === id);
      if (tab) set((s) => ({ closed: rememberClosed(s.closed, tab) }));
      tabs((s) => closeTab(s, id));
      // The last tab of a session's panel closes the panel.
      if (tab && tab.owner !== BROWSER_OWNER && !get().tabs.some((t) => t.owner === tab.owner)) get().close(tab.owner);
    },
    askClose: (id) => {
      const tab = get().tabs.find((t) => t.id === id);
      clearTimeout(unconfirm);
      if (tab?.pinned && get().confirming !== id) {
        set({ confirming: id });
        unconfirm = setTimeout(() => set((s) => (s.confirming === id ? { confirming: null } : s)), CONFIRM_CLOSE_MS);
        return;
      }
      set({ confirming: null });
      get().closeTab(id);
    },
    reopenTab: (owner) => {
      const { tab, closed } = takeClosed(get().closed, owner);
      if (!tab?.url) return null;
      set({ closed });
      const had = new Set(get().tabs.map((t) => t.id));
      const id = get().openTab(tab.owner, tab.url);
      // A tab already on that address is only brought forward, as it is; a new one gets back what the closed one had.
      if (!had.has(id)) {
        tabs((s) => updateTab(s, id, { title: tab.title, name: tab.name, favicon: tab.favicon }));
        if (tab.pinned) get().pin(id);
      }
      // A session's tab comes back in its panel.
      if (tab.owner !== BROWSER_OWNER) set((s) => ({ panels: withValue(s.panels, tab.owner) }));
      return tab.owner;
    },
    pin: (id) => tabs((s) => pinTab(s, id)),
    unpin: (id) => tabs((s) => unpinTab(s, id)),
    move: (id, index) => tabs((s) => moveTab(s, id, index)),
    step: (id, step) => tabs((s) => stepTab(s, id, step)),
    navigate: (id, url) => tabs((s) => showTab(updateTab(s, id, { url, title: url, favicon: null, seq: ++seq }), id, Date.now())),
    shown: (id, url) => tabs((s) => updateTab(s, id, { url })),
    titled: (id, title) => tabs((s) => updateTab(s, id, { title })),
    rename: (id, name) => tabs((s) => updateTab(s, id, { name: cleanTabName(name) })),
    iconed: (id, favicon) => tabs((s) => updateTab(s, id, { favicon })),
    setPhone: (id, phone) => tabs((s) => updateTab(s, id, { phone })),
    zoomTo: (id, zoom) => tabs((s) => updateTab(s, id, { zoom })),
    setMuted: (id, muted) => tabs((s) => updateTab(s, id, { muted })),
    heard: (id, audible) => tabs((s) => updateTab(s, id, { audible })),
    setFull: (sessionId, full) => set((s) => ({ full: full ? withValue(s.full, sessionId) : without(s.full, sessionId) })),
    reload: (sessionId) => {
      const front = frontTab(get(), sessionId);
      if (front) set((s) => ({ reloads: new Map(s.reloads).set(front.id, (s.reloads.get(front.id) ?? 0) + 1) }));
    },
    restorePinned: (saved) => tabs((s) => restore(s, saved)),
    forget: (sessionId) => {
      tabs((s) => dropOwner(s, sessionId));
      set((s) => ({ panels: without(s.panels, sessionId), full: without(s.full, sessionId) }));
    },
    handOver: (sessionId, web) => {
      if (!web) {
        get().close(sessionId);
        return;
      }
      const id = web.url ? get().openTab(sessionId, web.url) : (frontTab(get(), sessionId)?.id ?? get().openTab(sessionId, null));
      get().setPhone(id, web.phone);
      set((s) => ({ panels: withValue(s.panels, sessionId) }));
    },
  };
});

/** A session's Browser panel as its view shows it; null while the panel is closed. */
export function useSessionWeb(sessionId: string): PanelWeb | null {
  const open = useWebPreview((s) => s.panels.has(sessionId));
  // Only this session's tabs, and only while its panel is open: another tab's title as it changes re-renders nothing here.
  const own = useWebPreview(useShallow((s) => (s.panels.has(sessionId) ? ownerTabs(s, sessionId) : NO_OWN)));
  const active = useWebPreview((s) => s.active.get(sessionId));
  const full = useWebPreview((s) => s.full.has(sessionId));
  if (!open) return null;
  return { tab: own.find((t) => t.id === active) ?? null, tabs: own, full };
}

const NO_OWN: BrowserTab[] = [];


/** How many tabs an owner has (a session's row shows a globe for any). */
export function useTabCount(owner: string): number {
  return useWebPreview((s) => s.tabs.reduce((n, t) => n + (t.owner === owner ? 1 : 0), 0));
}

export const isWebOpen = (sessionId: string | null) => !!sessionId && useWebPreview.getState().panels.has(sessionId);

/** Each session's panel as another window takes it over: the tab in front, for the panels that are open. */
export function sessionWebs(state: Pick<WebPreviewState, 'panels' | 'tabs' | 'active'>): ReadonlyMap<string, SessionWeb> {
  const out = new Map<string, SessionWeb>();
  for (const sessionId of state.panels) {
    const front = frontTab(state, sessionId);
    out.set(sessionId, { url: front?.url ?? null, phone: front?.phone ?? false, seq: front?.seq ?? 0 });
  }
  return out;
}

/**
 * The header's Browser button, its shortcut and the palette: open, bring to the front, or hide. Hidden, its tabs stay
 * as they were for the next open; the panel's × closes them. `othersOpen`: another right panel is open too.
 */
export function toggleWebPanel(sessionId: string, othersOpen: boolean, url?: string | null): void {
  const step = agentsToggleStep(isWebOpen(sessionId), frontRightTab(sessionId) === 'web', othersOpen);
  if (step === 'close') useWebPreview.getState().hide(sessionId);
  else showWebPanel(sessionId, url);
}

/** Opens a session's panel as it was left; one with no tabs yet opens on `offer` (a server running in the session). */
export function showWebPanel(sessionId: string, offer?: string | null): void {
  const state = useWebPreview.getState();
  const kept = state.panels.has(sessionId) || state.tabs.some((t) => t.owner === sessionId);
  state.open(sessionId, kept ? null : offer);
}
