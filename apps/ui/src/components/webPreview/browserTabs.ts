/*
 * The browser's tabs (Settings › General › Enable browser), as plain data: each belongs to an owner, a session (its
 * id) or the Browser view (`BROWSER_OWNER`), and each owner has the one in front. Pure, so the rules (open or show,
 * which tab comes forward on close, pinned tabs first) are tested on their own; `webPreviewStore.ts` holds the state.
 */

/** The Browser view's tabs, which belong to no session. */
export const BROWSER_OWNER = 'browser';

/** At most this many pages are live, the ones shown most recently; an older one loads again when it is shown. */
export const LIVE_PAGES = 8;

export interface BrowserTab {
  id: string;
  /** A session's id, or `BROWSER_OWNER`. */
  owner: string;
  /** The address it shows; null for a new tab before an address is typed. */
  url: string | null;
  /** The page's title, or the address until the page says. */
  title: string;
  /** The name you gave it (Rename tab), shown in place of `title`; null for none. */
  name: string | null;
  /** The page's icon, when it has one. */
  favicon: string | null;
  pinned: boolean;
  /**
   * The favourite it was opened from (a tile in the Browser view's sidebar): it shows in that tile, not in the list of
   * tabs, and the tile brings it back however far it browsed. Null for any other tab.
   */
  favoriteId: string | null;
  /** Its place among its owner's tabs, pinned ones first. */
  position: number;
  /** When it was last in front; 0 for a tab restored at start and not shown yet, which has no page until then. */
  lastShownAt: number;
  /** Shown at phone width. */
  phone: boolean;
  /** Its zoom, as a factor (1 is 100%): kept with the tab, not with the site, and set again on each page it shows. */
  zoom: number;
  /** Muted: its page plays no sound. */
  muted: boolean;
  /** Its page plays sound now. */
  audible: boolean;
  /** Goes up when something asks the page to load `url` (an offer, the address bar), so the same address loads again. */
  seq: number;
}

export interface TabsState {
  tabs: readonly BrowserTab[];
  /** Each owner's tab in front. */
  active: ReadonlyMap<string, string>;
}

export const NO_TABS: TabsState = { tabs: [], active: new Map() };

/** A pinned tab as the engine keeps it. */
export interface SavedTab {
  id: string;
  owner: string;
  url: string;
  title: string;
  name?: string | null;
  favicon?: string | null;
  position: number;
}

/** How long a tab's name may be. */
export const TAB_NAME_MAX = 200;

/** What a tab is called: the name you gave it, else the page's title. */
export const tabName = (tab: Pick<BrowserTab, 'name' | 'title'>): string => tab.name || tab.title;

/** A name typed for a tab, as kept: spaces folded, cut to `TAB_NAME_MAX`; empty is no name (the page's title again). */
export function cleanTabName(text: string): string | null {
  const name = text.replace(/\s+/g, ' ').trim().slice(0, TAB_NAME_MAX);
  return name || null;
}

/** The same page for Open: same origin and path, whatever the `#` (and the query) says. */
export function sameAddress(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname;
  } catch {
    return a === b;
  }
}

/** An owner's tabs in order: pinned ones first, each group in its own order. */
export function ownerTabs(state: TabsState, owner: string): BrowserTab[] {
  return state.tabs.filter((t) => t.owner === owner).sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.position - b.position);
}

/** The tabs an owner lists: its tabs in order, less those a favourite's tile shows. */
export function listedTabs(state: TabsState, owner: string): BrowserTab[] {
  return ownerTabs(state, owner).filter((t) => !t.favoriteId);
}

/** The tab a favourite's tile shows, if it is open. */
export function favoriteTab(state: TabsState, favoriteId: string): BrowserTab | undefined {
  return state.tabs.find((t) => t.favoriteId === favoriteId);
}

/** A tab becomes a favourite's (its page stays as it is), or no longer one (null). */
export function linkFavorite(state: TabsState, id: string, favoriteId: string | null): TabsState {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab || tab.favoriteId === favoriteId) return state;
  return { tabs: state.tabs.map((t) => (t.id === id ? { ...t, favoriteId, pinned: favoriteId ? false : t.pinned } : t)), active: state.active };
}

/** An owner's tab in front, if it has one. */
export function frontTab(state: TabsState, owner: string): BrowserTab | undefined {
  const id = state.active.get(owner);
  return id ? state.tabs.find((t) => t.id === id) : undefined;
}

/** Numbers an owner's tabs 0, 1, 2… in the order given, pinned ones first. */
function renumber(tabs: readonly BrowserTab[], owner: string, order: readonly BrowserTab[]): BrowserTab[] {
  const sorted = [...order].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  const place = new Map(sorted.map((t, i) => [t.id, i]));
  return tabs.map((t) => (t.owner === owner && place.has(t.id) ? (t.position === place.get(t.id) ? t : { ...t, position: place.get(t.id)! }) : t));
}

const withActive = (active: ReadonlyMap<string, string>, owner: string, id: string | null) => {
  const next = new Map(active);
  if (id) next.set(owner, id);
  else next.delete(owner);
  return next;
};

/** A tab comes to the front: it is the owner's active one and was shown now. */
export function showTab(state: TabsState, id: string, now: number): TabsState {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return state;
  return { tabs: state.tabs.map((t) => (t.id === id ? { ...t, lastShownAt: now } : t)), active: withActive(state.active, tab.owner, id) };
}

export interface OpenOptions {
  /** Bring it to the front (the default). */
  focus?: boolean;
  /** The new tab's id. */
  id: string;
  now: number;
  /** The load number for the new address (`BrowserTab.seq`). */
  seq: number;
  /** Opened from this favourite: the tab it already has comes forward, wherever it is now. */
  favoriteId?: string | null;
}

/**
 * Opens `url` for an owner, or shows the tab it already has on that address (`sameAddress`) instead of opening another.
 * A null `url` always opens a new, empty tab. Returns the tab that shows it.
 */
export function openTab(state: TabsState, owner: string, url: string | null, options: OpenOptions): { state: TabsState; id: string } {
  const focus = options.focus ?? true;
  const favoriteId = options.favoriteId ?? null;
  const existing = favoriteId
    ? state.tabs.find((t) => t.owner === owner && t.favoriteId === favoriteId)
    : url
      ? ownerTabs(state, owner).find((t) => !t.favoriteId && sameAddress(t.url, url))
      : undefined;
  if (existing) return { state: focus ? showTab(state, existing.id, options.now) : state, id: existing.id };
  const own = ownerTabs(state, owner);
  const tab: BrowserTab = { id: options.id, owner, url, title: url ?? 'New tab', name: null, favicon: null, pinned: false, favoriteId, position: own.length, lastShownAt: focus ? options.now : 0, phone: false, zoom: 1, muted: false, audible: false, seq: options.seq };
  const tabs = [...state.tabs, tab];
  return { state: { tabs, active: focus || !state.active.has(owner) ? withActive(state.active, owner, tab.id) : state.active }, id: tab.id };
}

/** Closes a tab. If it was in front, the tab to its right comes forward, else the one to its left, else none. */
export function closeTab(state: TabsState, id: string): TabsState {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return state;
  const own = ownerTabs(state, tab.owner);
  const index = own.findIndex((t) => t.id === id);
  const rest = own.filter((t) => t.id !== id);
  const tabs = renumber(state.tabs.filter((t) => t.id !== id), tab.owner, rest);
  if (state.active.get(tab.owner) !== id) return { tabs, active: state.active };
  const next = own[index + 1] ?? own[index - 1] ?? null;
  return { tabs, active: withActive(state.active, tab.owner, next?.id ?? null) };
}

/** Pins a tab: it goes to the end of its owner's pinned tabs. */
export function pinTab(state: TabsState, id: string): TabsState {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab || tab.pinned) return state;
  const own = ownerTabs(state, tab.owner);
  const pinned = own.filter((t) => t.pinned);
  const order = [...pinned, { ...tab, pinned: true }, ...own.filter((t) => !t.pinned && t.id !== id)];
  return { tabs: renumber(state.tabs.map((t) => (t.id === id ? { ...t, pinned: true } : t)), tab.owner, order), active: state.active };
}

/** Unpins a tab: it goes first among its owner's other tabs. */
export function unpinTab(state: TabsState, id: string): TabsState {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab?.pinned) return state;
  const own = ownerTabs(state, tab.owner);
  const order = [...own.filter((t) => t.pinned && t.id !== id), { ...tab, pinned: false }, ...own.filter((t) => !t.pinned)];
  return { tabs: renumber(state.tabs.map((t) => (t.id === id ? { ...t, pinned: false } : t)), tab.owner, order), active: state.active };
}

/** Moves a tab to `index` among its owner's listed tabs (`listedTabs`), kept inside its group: pinned tabs always come first. */
export function moveTab(state: TabsState, id: string, index: number): TabsState {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return state;
  // `index` counts the listed tabs: a favourite's tab is in its tile, so it keeps its place after them.
  const own = listedTabs(state, tab.owner).filter((t) => t.id !== id);
  const tiles = ownerTabs(state, tab.owner).filter((t) => t.favoriteId && t.id !== id);
  const pinnedCount = own.filter((t) => t.pinned).length;
  const [low, high] = tab.pinned ? [0, pinnedCount] : [pinnedCount, own.length];
  const at = Math.min(Math.max(index, low), high);
  own.splice(at, 0, tab);
  return { tabs: renumber(state.tabs, tab.owner, [...own, ...tiles]), active: state.active };
}

/** Moves a tab one place earlier (-1) or later (1) among its owner's listed tabs; at the end of its group it stays. */
export function stepTab(state: TabsState, id: string, step: 1 | -1): TabsState {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return state;
  const index = listedTabs(state, tab.owner).findIndex((t) => t.id === id);
  return moveTab(state, id, index + step);
}

/** A dragged tab lands only among tabs of its own kind: pinned among pinned, the others among the others. */
export const sameGroup = (a: Pick<BrowserTab, 'pinned'> | undefined, b: Pick<BrowserTab, 'pinned'> | undefined): boolean => !!a && !!b && a.pinned === b.pinned;

/** Changes what a tab shows (its address, title, name, icon, width) without moving it. */
export function updateTab(state: TabsState, id: string, change: Partial<Pick<BrowserTab, 'url' | 'title' | 'name' | 'favicon' | 'phone' | 'zoom' | 'muted' | 'audible' | 'seq'>>): TabsState {
  let changed = false;
  const tabs = state.tabs.map((t) => {
    if (t.id !== id) return t;
    const next = { ...t, ...change };
    changed = (Object.keys(change) as Array<keyof typeof change>).some((key) => next[key] !== t[key]);
    return changed ? next : t;
  });
  return changed ? { tabs, active: state.active } : state;
}

/** Adds the pinned tabs kept by the engine, without a page (they load when first shown). Tabs already here stay as they are. */
export function restore(state: TabsState, saved: readonly SavedTab[]): TabsState {
  const have = new Set(state.tabs.map((t) => t.id));
  const added: BrowserTab[] = [...saved]
    .filter((s) => !have.has(s.id))
    .sort((a, b) => a.position - b.position)
    .map((s) => ({ id: s.id, owner: s.owner, url: s.url, title: s.title || s.url, name: s.name ?? null, favicon: s.favicon ?? null, pinned: true, favoriteId: null, position: s.position, lastShownAt: 0, phone: false, zoom: 1, muted: false, audible: false, seq: 0 }));
  if (!added.length) return state;
  let tabs = [...state.tabs, ...added];
  for (const owner of new Set(added.map((t) => t.owner))) tabs = renumber(tabs, owner, ownerTabs({ tabs, active: state.active }, owner));
  return { tabs, active: state.active };
}

/** Drops every tab of an owner (a session deleted). */
export function dropOwner(state: TabsState, owner: string): TabsState {
  if (!state.tabs.some((t) => t.owner === owner)) return state;
  return { tabs: state.tabs.filter((t) => t.owner !== owner), active: withActive(state.active, owner, null) };
}

/** Which tabs `livePages` may give a page, and which it must. */
export interface LiveOptions {
  /** Tabs on screen now (each open panel's tab in front): live first, whenever they were last picked. */
  keep?: readonly string[];
  /** Tabs that may have a page in this window (not one a pop-out shows, not an outside page with the browser off). */
  allowed?: (tab: BrowserTab) => boolean;
}

/**
 * The tabs that have a live page: those on screen, then the ones shown most recently, `limit` in all. Tabs never shown
 * have none, and neither do tabs without an address.
 */
export function livePages(state: TabsState, limit = LIVE_PAGES, options: LiveOptions = {}): string[] {
  const allowed = (t: BrowserTab) => !!t.url && (options.allowed?.(t) ?? true);
  const keep = new Set(options.keep ?? []);
  const onScreen = state.tabs.filter((t) => keep.has(t.id) && allowed(t));
  const recent = state.tabs.filter((t) => !keep.has(t.id) && t.lastShownAt > 0 && allowed(t)).sort((a, b) => b.lastShownAt - a.lastShownAt);
  return [...onScreen, ...recent].slice(0, limit).map((t) => t.id);
}

/** Chrome's zoom steps: a page zooms from one to the next. */
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5] as const;

/** The zoom a step in (1) or out (-1) from `zoom` gives, or 100% (0); at either end it stays. */
export function nextZoom(zoom: number, step: 1 | -1 | 0): number {
  if (step === 0) return 1;
  const at = ZOOM_STEPS.findIndex((z) => z >= zoom - 0.001);
  const index = at < 0 ? ZOOM_STEPS.length - 1 : ZOOM_STEPS[at]! > zoom + 0.001 && step > 0 ? at - 1 : at;
  return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + step))]!;
}

/** A zoom as the toolbar shows it: "110%". */
export const zoomLabel = (zoom: number): string => `${Math.round(zoom * 100)}%`;

/** How many closed tabs ⌘⇧T can bring back. */
export const CLOSED_TABS = 25;

/** A tab closed: remembered for Reopen, newest last. An empty tab is not worth reopening. */
export function rememberClosed(closed: readonly BrowserTab[], tab: BrowserTab): readonly BrowserTab[] {
  if (!tab.url) return closed;
  return [...closed.filter((t) => t.id !== tab.id), tab].slice(-CLOSED_TABS);
}

/** The tab ⌘⇧T brings back: the last one closed, of `owner` when given. The rest stay for the next press. */
export function takeClosed(closed: readonly BrowserTab[], owner?: string): { tab: BrowserTab | null; closed: readonly BrowserTab[] } {
  const index = closed.findLastIndex((t) => owner === undefined || t.owner === owner);
  if (index < 0) return { tab: null, closed };
  return { tab: closed[index]!, closed: closed.filter((_, i) => i !== index) };
}

/** What a session's row says is open, in this order: a terminal, a browser (one mark however many tabs). */
export function rowIndicators(open: { terminal: boolean; tabs: number }): Array<'terminal' | 'browser'> {
  return [...(open.terminal ? (['terminal'] as const) : []), ...(open.tabs > 0 ? (['browser'] as const) : [])];
}
