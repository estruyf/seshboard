/**
 * Mods' status chips in the message box footer. Two fit at most; the rest go into a "+N" chip that opens the list.
 * They give way first: they fold into "+N" before anything else in the footer moves (the chip row keeps its full
 * size until the statuses have folded), so the footer never overflows. Pure, so it can be tested.
 */

/** The most status chips shown before "+N". */
export const MAX_STATUS_CHIPS = 2;

/**
 * How many status chips fit in `available` pixels: their `widths` in order, `gap` between chips, and the "+N" chip's
 * width for the ones left over (`plusWidth(n)`). Zero means only "+N" shows (or nothing, without statuses).
 */
export function fitStatuses(widths: readonly number[], available: number, plusWidth: (hidden: number) => number, gap = 4): number {
  const n = widths.length;
  for (let shown = Math.min(MAX_STATUS_CHIPS, n); shown > 0; shown--) {
    const hidden = n - shown;
    const chips = widths.slice(0, shown).reduce((sum, w) => sum + w, 0) + gap * (shown - 1);
    const need = chips + (hidden > 0 ? gap + plusWidth(hidden) : 0);
    if (need <= available + 0.5) return shown;
  }
  return 0;
}

/** The label of the chip that holds the rest. */
export const plusLabel = (hidden: number) => `+${hidden}`;

/** Who checks prompts, for the shield's tooltip: a mod's name when only one could be doing it. */
export function screenedBy(plugins: readonly string[]): string {
  return plugins.length === 1 ? plugins[0]! : 'a mod';
}
