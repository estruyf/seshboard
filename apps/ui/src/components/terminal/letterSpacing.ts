/**
 * Whether xterm's DOM renderer spaced its letters from 0px measurements. It gives each letter a letter-spacing of
 * the cell width minus the letter's measured width, and stores a default for the rows the same way. Measured
 * while the terminal is hidden, a letter is 0px wide and gets a whole cell of extra space ("r e a d y"). A letter
 * measured right is off by a fraction of a pixel, and wide characters come out negative, so half a cell or more
 * can only come from a 0px measurement.
 *
 * `spacings` are the CSS `letter-spacing` values of the rows' container and of their spans (`""` where a span has none).
 */
export function lettersSpread(cellWidth: number, spacings: Iterable<string>): boolean {
  if (!(cellWidth > 0)) return false;
  for (const value of spacings) {
    const px = Number.parseFloat(value);
    if (Number.isFinite(px) && px >= cellWidth / 2) return true;
  }
  return false;
}
