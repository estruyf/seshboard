/**
 * Keeps a view at its end while it follows the end, so what grew below (a streaming reply) comes into sight. Scrolled up
 * (not following), it stays where you are reading. True when it moved the view. Pure, with tests.
 */
export function followEnd(el: { scrollTop: number; scrollHeight: number } | null, following: boolean): boolean {
  if (!el || !following) return false;
  el.scrollTop = el.scrollHeight;
  return true;
}
