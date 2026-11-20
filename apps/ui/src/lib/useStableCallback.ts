import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * A function that is the same object on every render but always runs the latest `fn`: for the handlers a long list of
 * memoised rows takes as props (a click, a menu), which close over state that changes with every render of the list.
 * Call it from events, never while rendering.
 */
export function useStableCallback<Args extends unknown[], Result>(fn: (...args: Args) => Result): (...args: Args) => Result {
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}
