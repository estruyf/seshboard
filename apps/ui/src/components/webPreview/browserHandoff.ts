import { dropOwner, frontTab, ownerTabs, type BrowserTab, type TabsState } from './browserTabs.ts';

/*
 * A session's browser tabs as they move to its browser window and back (main passes them on as plain data). Every tab
 * goes, with its pin, name, browser profile, zoom, phone width and place, and which one is in front. Pages can't move
 * between windows, so each loads again where it lands. Pure, so the rules are tested on their own.
 */

/** One session's tabs on their way to another window. */
export interface BrowserHandoff {
  tabs: BrowserTab[];
  /** The tab in front, or null. */
  active: string | null;
}

/** A session's tabs as this window has them. */
export function handoffOf(state: TabsState, owner: string): BrowserHandoff {
  return { tabs: ownerTabs(state, owner).map((t) => ({ ...t, audible: false })), active: frontTab(state, owner)?.id ?? null };
}

/** A session's tabs as this window has them, and the state without them (they leave this window). */
export function takeTabs(state: TabsState, owner: string): { handoff: BrowserHandoff; state: TabsState } {
  return { handoff: handoffOf(state, owner), state: dropOwner(state, owner) };
}

const isString = (value: unknown): value is string => typeof value === 'string';
const orNull = (value: unknown): string | null => (isString(value) ? value : null);

/** One tab from another window, checked: null when it isn't one. Its owner is the session it is handed to. */
function parseTab(value: unknown, owner: string): BrowserTab | null {
  if (!value || typeof value !== 'object') return null;
  const t = value as Record<string, unknown>;
  if (!isString(t.id) || !t.id || (t.url !== null && !isString(t.url))) return null;
  const number = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    id: t.id,
    owner,
    url: t.url as string | null,
    title: isString(t.title) ? t.title : ((t.url as string | null) ?? ''),
    name: orNull(t.name),
    favicon: orNull(t.favicon),
    pinned: t.pinned === true,
    favoriteId: orNull(t.favoriteId),
    position: number(t.position, 0),
    lastShownAt: number(t.lastShownAt, 0),
    phone: t.phone === true,
    zoom: number(t.zoom, 1),
    muted: t.muted === true,
    audible: false,
    seq: number(t.seq, 0),
    profileId: orNull(t.profileId),
  };
}

/** Tabs from another window (checked first): null when it isn't a handoff. Tabs that aren't tabs are left out. */
export function parseHandoff(value: unknown, owner: string): BrowserHandoff | null {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { tabs?: unknown }).tabs)) return null;
  const raw = value as { tabs: unknown[]; active?: unknown };
  const tabs = raw.tabs.map((t) => parseTab(t, owner)).filter((t): t is BrowserTab => t !== null);
  const active = isString(raw.active) && tabs.some((t) => t.id === raw.active) ? raw.active : null;
  return { tabs, active };
}

/**
 * Puts a session's tabs as another window had them, in place of the ones it has here. The tab in front counts as shown
 * `now`, so it gets a page first; the others keep when they were last shown, so they load as before (the most recent ones).
 */
export function adoptTabs(state: TabsState, owner: string, handoff: BrowserHandoff, now: number): TabsState {
  const base = dropOwner(state, owner);
  if (!handoff.tabs.length) return base;
  const active = handoff.active ?? handoff.tabs[0]!.id;
  const tabs = [...handoff.tabs]
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.position - b.position)
    .map((t, position) => ({ ...t, owner, position, audible: false, lastShownAt: t.id === active ? now : t.lastShownAt }));
  // Another session's tab with the same id can't be: ids are made once. Still, one already here stays and the new one goes.
  const have = new Set(base.tabs.map((t) => t.id));
  const added = tabs.filter((t) => !have.has(t.id));
  if (!added.length) return base;
  const front = added.some((t) => t.id === active) ? active : added[0]!.id;
  return { tabs: [...base.tabs, ...added], active: new Map(base.active).set(owner, front) };
}
