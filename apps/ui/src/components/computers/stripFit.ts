/**
 * What the sidebar's Computers strip needs on its one line: This Mac's chip (`here`, which always shows), each paired
 * computer's chip at rest in order (`widths`) and with its name cut to `MIN_NAME` (`least`), the "+N" chip for the
 * ones left over (`plusWidth(n)`), and how much a chip grows while it is hovered or focused (`menuButton`, its ▾).
 */
export interface StripWidths {
  here: number;
  widths: readonly number[];
  least: readonly number[];
  plusWidth(hidden: number): number;
  menuButton: number;
}

/** The shortest a computer's name is cut to (3rem) on the last chip that shows, before that chip folds into "+N". */
export const MIN_NAME = 48;

/** The gap between the strip's chips (`gap-1`). */
export const STRIP_GAP = 4;

/**
 * How many paired computers' chips fit on the strip's line in `available` pixels; the rest fold into "+N". The last chip
 * that shows may cut its name down to `MIN_NAME` first, so one computer in a narrow sidebar keeps its chip rather than
 * turning into "+1". Room for one ▾ is kept while any computer's chip shows, so hovering one never pushes the line
 * over. The widths are the chips at rest, measured out of sight, so the answer doesn't depend on what shows now and
 * the strip can't flicker between two layouts. Zero means only "+N" follows This Mac. Pure, so it can be tested.
 */
export function fitComputerChips(available: number, { here, widths, least, plusWidth, menuButton }: StripWidths): number {
  const n = widths.length;
  for (let shown = n; shown > 0; shown--) {
    const hidden = n - shown;
    const last = Math.min(widths[shown - 1]!, least[shown - 1] ?? widths[shown - 1]!);
    const parts = [here, ...widths.slice(0, shown - 1), last, ...(hidden > 0 ? [plusWidth(hidden)] : [])];
    const need = parts.reduce((sum, w) => sum + w, 0) + STRIP_GAP * (parts.length - 1) + menuButton;
    // Half a pixel of slack: measured widths are fractional, and a line that fits exactly must not fold.
    if (need <= available + 0.5) return shown;
  }
  return 0;
}

/** The "+N" chip's accessible name: "2 more computers", and how many need you among them. */
export function moreLabel(hidden: number, waiting: number): string {
  const more = `${hidden} more ${hidden === 1 ? 'computer' : 'computers'}`;
  return waiting > 0 ? `${more}, ${waiting} need you` : more;
}
