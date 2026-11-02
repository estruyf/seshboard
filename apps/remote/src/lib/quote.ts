/** A box on screen, in CSS pixels from the top left of the viewport. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Room kept between the pill and the screen's edges, and between the pill and the selection. */
const EDGE = 8;
const GAP = 10;

/**
 * Where the Quote pill over a selection goes: under the selection's last line, centred on it, so the phone's own menu
 * (Copy, Look Up), which shows above a selection, stays clear. When there is no room under it (the selection ends near
 * the bottom, or the keyboard is up), it goes above the first line. Always kept on screen.
 */
export function quotePillPlace(first: Box, last: Box, pill: { width: number; height: number }, viewport: { width: number; height: number }): { left: number; top: number } {
  const centre = last.left + last.width / 2;
  const left = Math.min(Math.max(EDGE, centre - pill.width / 2), Math.max(EDGE, viewport.width - pill.width - EDGE));
  const below = last.top + last.height + GAP;
  const top = below + pill.height <= viewport.height - EDGE ? below : Math.max(EDGE, first.top - GAP - pill.height);
  return { left, top };
}

/** What a selection quotes: its text without the blank lines around it; null when that leaves nothing. */
export function quotedText(selected: string): string | null {
  const text = selected.replace(/\r\n?/g, '\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
  return text.trim() ? text : null;
}
