/** A list's usual height (`max-h-72`). */
const LIST_HEIGHT = 288;
/** The window's drag strip above the view: a list there couldn't be clicked. */
const TOP = 60;
const EDGE = 12;

export interface PaletteRoom {
  below: boolean;
  height: number;
}

/**
 * Where a list opens for a box at `box` in a window this tall: above it, as in a session, while it fits there. Otherwise
 * on the side with more room, no taller than that room.
 */
export function paletteRoom(box: { top: number; bottom: number }, windowHeight: number): PaletteRoom {
  const above = box.top - TOP;
  const below = windowHeight - box.bottom - EDGE;
  if (above >= LIST_HEIGHT || above >= below) return { below: false, height: Math.min(LIST_HEIGHT, Math.max(0, above)) };
  return { below: true, height: Math.min(LIST_HEIGHT, below) };
}
