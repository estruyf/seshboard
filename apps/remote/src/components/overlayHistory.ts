import { useEffect, useRef } from 'react';

/**
 * Overlays that the back gesture closes (sheets, the sessions drawer): each adds a history entry while open, and only
 * the top one takes Escape and the back gesture.
 */

/** Open overlays, so only the top one takes Escape and the back gesture. */
const stack: number[] = [];
let nextId = 1;
/**
 * An overlay closed by a button or Escape takes back its history entry with `history.back()`, which lands a moment
 * later. Until it has, its popstate is nobody's back gesture, and an overlay opening meanwhile (Changes, then Commit)
 * waits to add its own entry.
 */
let goingBack: Promise<void> | null = null;

function takeBackEntry(): void {
  goingBack = new Promise((resolve) => {
    const done = () => {
      window.removeEventListener('popstate', done);
      clearTimeout(timer);
      // After every popstate listener has seen it: theirs run after this one.
      setTimeout(() => {
        goingBack = null;
        resolve();
      });
    };
    // A browser that doesn't fire it (nothing to go back to) mustn't hold overlays back for ever.
    const timer = setTimeout(done, 500);
    window.addEventListener('popstate', done);
  });
  history.back();
}

/**
 * Runs once an overlay's history entry is gone: picking a session in the drawer replaces the entry under it, so it
 * must not replace the drawer's own.
 */
export function afterOverlays(run: () => void): void {
  if (goingBack) void goingBack.then(run);
  else run();
}

/** Whether this overlay is the top one. */
export const onTop = (id: number) => stack.at(-1) === id;

/**
 * While mounted: an entry in the stack and in the history (a tick later, so StrictMode's trial mount adds nothing).
 * The back gesture and Escape call `onClose` while it is on top; closed another way, it takes its entry back.
 * Returns its id, for `onTop`.
 */
export function useOverlayHistory(onClose: () => void, { escape = true }: { escape?: boolean } = {}): { current: number } {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const idRef = useRef(0);
  useEffect(() => {
    const id = nextId++;
    idRef.current = id;
    stack.push(id);
    let pushed = false;
    let cancelled = false;
    let viaHistory = false;
    const add = () => {
      if (cancelled) return;
      pushed = true;
      history.pushState({ ...(history.state as object | null), sheet: id }, '');
    };
    const push = setTimeout(() => (goingBack ? void goingBack.then(add) : add()));
    const onPop = () => {
      if (goingBack || !pushed || stack.at(-1) !== id) return;
      viaHistory = true;
      closeRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (!escape || event.key !== 'Escape' || stack.at(-1) !== id || event.defaultPrevented) return;
      event.preventDefault();
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey);
      clearTimeout(push);
      cancelled = true;
      stack.splice(stack.indexOf(id), 1);
      // Closed another way: take back the history entry it added.
      if (pushed && !viaHistory && (history.state as { sheet?: number } | null)?.sheet === id) takeBackEntry();
    };
  }, [escape]);
  return idRef;
}
