/** The 10px slot at the left of a row in Minimal mode with nothing in it (a queued prompt), so titles line up with the state marks. */
export function EmptyRowSlot() {
  return <span className="flex h-3 w-2.5 shrink-0" aria-hidden data-row-leading="empty" />;
}
