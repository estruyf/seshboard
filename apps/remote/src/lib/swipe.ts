/**
 * Swipe actions on a session row: right for Mark as read, left for Archive. A short swipe shows the action's button,
 * a long one (past 60% of the row) does it at once. Pure, with tests; `SwipeRow.tsx` follows the finger.
 */

/** The width of the button a short swipe shows. */
export const ACTION_WIDTH = 88;
/** Past this share of the row's width, letting go does the action. */
export const COMMIT_SHARE = 0.6;
/** A flick this fast (px/ms) shows the button even when it moved less than half of it. */
export const FLICK = 0.4;

export type SwipeAction = 'read' | 'archive';

/** Right is Mark as read, left is Archive. */
export const actionFor = (dx: number): SwipeAction | null => (dx > 0 ? 'read' : dx < 0 ? 'archive' : null);

/**
 * Where the row sits for a finger `dx` px from where it started (plus where it was, `start`, when a button showed).
 * Towards an action the row can't take (Mark as read on a read session), it barely moves, so it reads as stuck.
 */
export function swipeOffset(start: number, dx: number, width: number, allowed: Record<SwipeAction, boolean>): number {
  const raw = start + dx;
  const action = actionFor(raw);
  if (!action) return 0;
  if (!allowed[action]) return Math.sign(raw) * Math.min(16, Math.abs(raw) * 0.15);
  return Math.max(-width, Math.min(width, raw));
}

export type SwipeOutcome = { kind: 'close' } | { kind: 'reveal'; action: SwipeAction } | { kind: 'commit'; action: SwipeAction };

/**
 * What happens when the finger lifts with the row at `offset`: past 60% of the row the action happens; past half the
 * button's width (or a flick that way) the button stays out; anything less goes back.
 */
export function swipeOutcome(offset: number, width: number, velocity: number, allowed: Record<SwipeAction, boolean>): SwipeOutcome {
  const action = actionFor(offset);
  if (!action || !allowed[action]) return { kind: 'close' };
  const distance = Math.abs(offset);
  if (width > 0 && distance > width * COMMIT_SHARE) return { kind: 'commit', action };
  // A flick back the other way closes it.
  if (velocity * Math.sign(offset) <= -FLICK) return { kind: 'close' };
  if (distance > ACTION_WIDTH / 2 || velocity * Math.sign(offset) >= FLICK) return { kind: 'reveal', action };
  return { kind: 'close' };
}

/** Where a row rests after a swipe: closed, or with its button out on the action's side. */
export const restingOffset = (outcome: SwipeOutcome) => (outcome.kind === 'reveal' ? (outcome.action === 'read' ? ACTION_WIDTH : -ACTION_WIDTH) : 0);
