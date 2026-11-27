/** Sidebar width limits: wide enough for titles at the minimum, and the session view keeps its room at the maximum. */
export const SIDEBAR_DEFAULT_WIDTH = 320;
export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 520;
/** Dragged narrower than this, the panel closes; wider, it opens (at SIDEBAR_MIN_WIDTH until the pointer passes it). */
export const SNAP_OPEN = 160;
/** One press of ← or → on the resize edge. */
export const SIDEBAR_KEY_STEP = 16;

/** Open (the list beside the nav rail) or closed (not shown). */
export type SidebarState = 'open' | 'closed';
export const SIDEBAR_STATES: readonly SidebarState[] = ['open', 'closed'];

/** Rounds and clamps a dragged or stored width; anything that isn't a finite number falls back to the default. */
export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.round(Math.min(Math.max(width, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH));
}

/** A stored state, or open for anything else. The 80px rail of earlier versions ('minimal') loads as closed: the nav rail took its place. */
export const parseSidebarState = (value: unknown): SidebarState => (value === 'minimal' ? 'closed' : SIDEBAR_STATES.includes(value as SidebarState) ? (value as SidebarState) : 'open');

/** Where the panel is and how wide it shows (0 closed, the open width open). */
export interface SidebarSnap {
  state: SidebarState;
  width: number;
}

/** Where a drag of the edge to `dragX` (the width the pointer asks for) lands: closed under 160, else open at that width (240 at least). */
export function snapWidth(dragX: number): SidebarSnap {
  if (!(dragX >= SNAP_OPEN)) return { state: 'closed', width: 0 };
  return { state: 'open', width: clampSidebarWidth(dragX) };
}

/**
 * Where a drag that started closed lands. Opening goes back to a width you chose before: the minimum width, or the
 * last open width when the pointer is closer to it.
 */
export function snapFromCollapsed(dragX: number, lastOpenWidth: number): SidebarSnap {
  const snap = snapWidth(dragX);
  if (snap.state !== 'open') return snap;
  const last = clampSidebarWidth(lastOpenWidth);
  return { state: 'open', width: Math.abs(dragX - last) < Math.abs(dragX - SIDEBAR_MIN_WIDTH) ? last : SIDEBAR_MIN_WIDTH };
}

/** How wide the panel shows in a state, given the open width it keeps. */
export function shownWidth(state: SidebarState, openWidth: number): number {
  return state === 'open' ? clampSidebarWidth(openWidth) : 0;
}

/**
 * The room the main area keeps next to the open panel, in CSS pixels: enough for the session header
 * (the title, the git button, ⋯ and close) and the message box with Send.
 */
export const MAIN_MIN_WIDTH = 560;

/**
 * How the panel shows in a window `viewportWidth` CSS pixels wide (fewer when zoomed in; the caller leaves out the nav
 * rail). Open, it narrows so the main area keeps MAIN_MIN_WIDTH, and when even its minimum width doesn't fit it closes.
 * Only what shows changes: the saved state and width come back as the window grows.
 */
export function fitSidebar(state: SidebarState, openWidth: number, viewportWidth: number): SidebarSnap {
  const width = shownWidth(state, openWidth);
  if (state !== 'open' || !Number.isFinite(viewportWidth)) return { state, width };
  const room = Math.floor(viewportWidth - MAIN_MIN_WIDTH);
  if (room < SIDEBAR_MIN_WIDTH) return { state: 'closed', width: 0 };
  return { state: 'open', width: Math.min(width, room) };
}

/**
 * ← or → on the resize edge. Open, they change the width in steps; ← at the minimum closes the panel, → opens it again
 * at the last open width. The open width only changes while open.
 */
export function stepState(current: { state: SidebarState; width: number }, direction: 'left' | 'right'): { state: SidebarState; width: number } {
  const width = clampSidebarWidth(current.width);
  if (current.state === 'open') {
    if (direction === 'right') return { state: 'open', width: clampSidebarWidth(width + SIDEBAR_KEY_STEP) };
    return width <= SIDEBAR_MIN_WIDTH ? { state: 'closed', width } : { state: 'open', width: clampSidebarWidth(width - SIDEBAR_KEY_STEP) };
  }
  return { state: direction === 'right' ? 'open' : 'closed', width };
}

/** ⌘B, the title bar's Panel button: open closes, closed opens. */
export const toggledState = (state: SidebarState): SidebarState => (state === 'open' ? 'closed' : 'open');
