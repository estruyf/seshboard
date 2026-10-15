/** Where the terminal panel sits: under the conversation, or beside it on the right. */
export type TerminalDock = 'bottom' | 'right';

/** Docked below: the panel's height limits. */
export const PANEL_DEFAULT_HEIGHT = 280;
export const PANEL_MIN_HEIGHT = 120;
/** The most of the window's height the panel may take. */
export const PANEL_MAX_HEIGHT_SHARE = 0.75;
/** Docked right: room for an 80-column prompt at the minimum. */
export const PANEL_DEFAULT_WIDTH = 500;
export const PANEL_MIN_WIDTH = 360;
/** The most of the window's width the panel may take. */
export const PANEL_MAX_WIDTH_SHARE = 0.7;
/** Docked right, the conversation keeps at least this much: the message box with its buttons and Send. */
export const CHAT_MIN_WIDTH = 440;
/** Docked below, the conversation keeps at least this much height: the message box with a few lines above it. */
export const CHAT_MIN_HEIGHT = 220;
/** How far one arrow key moves the panel's edge. */
export const PANEL_KEY_STEP = 24;

const clamp = (value: number, fallback: number, min: number, max: number) => Math.round(Math.min(Math.max(Number.isFinite(value) ? value : fallback, min), Math.max(min, max)));

/** Rounds and clamps a dragged or stored height for a window `windowHeight` tall. Anything that isn't a number falls back to the default. */
export function clampPanelHeight(height: number, windowHeight: number): number {
  return clamp(height, PANEL_DEFAULT_HEIGHT, PANEL_MIN_HEIGHT, Math.floor(windowHeight * PANEL_MAX_HEIGHT_SHARE));
}

/** Rounds and clamps a dragged or stored width for a window `windowWidth` wide. A window too small for the minimum still gets the minimum. */
export function clampPanelWidth(width: number, windowWidth: number): number {
  return clamp(width, PANEL_DEFAULT_WIDTH, PANEL_MIN_WIDTH, Math.floor(windowWidth * PANEL_MAX_WIDTH_SHARE));
}

/**
 * The size after a resize key, or null for a key that doesn't resize this dock. The handle sits on the
 * edge facing the conversation: below, ↑ makes the panel taller; on the right, ← makes it wider.
 */
export function panelSizeForKey(dock: TerminalDock, key: string, size: number, window: { width: number; height: number }): number | null {
  if (dock === 'bottom') {
    const step = key === 'ArrowUp' ? PANEL_KEY_STEP : key === 'ArrowDown' ? -PANEL_KEY_STEP : null;
    return step === null ? null : clampPanelHeight(size + step, window.height);
  }
  const step = key === 'ArrowLeft' ? PANEL_KEY_STEP : key === 'ArrowRight' ? -PANEL_KEY_STEP : null;
  return step === null ? null : clampPanelWidth(size + step, window.width);
}

/** Why the terminal can't dock on the right just now, or null when it can. */
export type RightBlocked = 'changes' | 'ask' | 'agents' | 'narrow' | null;

/**
 * Whether the right side is free: the Changes, Ask and Agents panels also live there (they never stack with the terminal),
 * and the session view must fit the panel's minimum next to a usable conversation. `viewWidth` null: not measured yet.
 */
export function rightBlocked(onRight: 'changes' | 'ask' | 'agents' | null, viewWidth: number | null): RightBlocked {
  if (onRight) return onRight;
  if (viewWidth !== null && viewWidth < PANEL_MIN_WIDTH + CHAT_MIN_WIDTH) return 'narrow';
  return null;
}

/**
 * Docked below, the tallest the panel can be in a session view `viewHeight` tall and still leave the conversation its
 * minimum. A stacked pane is wide but short: without this the panel would push the message box out of it.
 * It never goes under the panel's own minimum height; null: not measured yet.
 */
export function maxBottomHeight(viewHeight: number | null): number {
  return viewHeight === null ? Number.POSITIVE_INFINITY : Math.max(PANEL_MIN_HEIGHT, Math.floor(viewHeight - CHAT_MIN_HEIGHT));
}

/** Docked right, the widest the panel can be in a session view `viewWidth` wide and still leave the conversation its minimum. */
export function maxRightWidth(viewWidth: number | null): number {
  return viewWidth === null ? Number.POSITIVE_INFINITY : Math.max(PANEL_MIN_WIDTH, Math.floor(viewWidth - CHAT_MIN_WIDTH));
}

/** Where the panel goes: where the user wants it, but below while the right side isn't free. */
export function effectiveDock(preferred: TerminalDock, blocked: RightBlocked): TerminalDock {
  return preferred === 'right' && blocked ? 'bottom' : preferred;
}

/** A stored dock setting, or the default for anything else. */
export function parseDock(value: unknown): TerminalDock {
  return value === 'right' ? 'right' : 'bottom';
}
