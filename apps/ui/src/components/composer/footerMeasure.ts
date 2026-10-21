/**
 * The room the footer's left side takes besides its chip row: the attach buttons, the thin line and the margins and
 * gaps around them. The row fills what is left (`flex-1`), so this is the side's width minus the row's, which counts
 * what summing the children's boxes leaves out. Zero without a chip row.
 */
export function besideChipRow(start: HTMLElement): number {
  const row = start.querySelector<HTMLElement>('[data-composer-chips]');
  return row ? Math.max(0, start.getBoundingClientRect().width - row.getBoundingClientRect().width) : 0;
}
