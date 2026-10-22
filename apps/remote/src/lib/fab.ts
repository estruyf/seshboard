/**
 * The floating New session button on a phone's Home: it slides away while you scroll down the list and comes back as
 * soon as you scroll up, or reach the top. Pure, with tests; `SessionList.tsx` feeds it the list's scroll position.
 */

/** How far the list has to move one way before the button follows, so a finger's jitter doesn't flip it. */
export const FAB_SLACK = 12;

/** Whether the button is out, and where the list was when that was last decided (or as far as it went since). */
export interface FabState {
  shown: boolean;
  anchor: number;
}

export const FAB_START: FabState = { shown: true, anchor: 0 };

/**
 * The button's state once the list scrolled to `y`. Down past the slack hides it, up past the slack shows it; at the
 * top (or over it, in a bounce) it is always out. While it keeps going the same way, the anchor follows, so turning
 * around counts from the farthest point.
 */
export function nextFab(state: FabState, y: number): FabState {
  if (y <= 0) return { shown: true, anchor: 0 };
  if (state.shown) {
    if (y - state.anchor > FAB_SLACK) return { shown: false, anchor: y };
    return y < state.anchor ? { shown: true, anchor: y } : state;
  }
  if (state.anchor - y > FAB_SLACK) return { shown: true, anchor: y };
  return y > state.anchor ? { shown: false, anchor: y } : state;
}
