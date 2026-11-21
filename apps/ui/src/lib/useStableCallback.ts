import { useCallback, useInsertionEffect, useRef } from 'react';

/**
 * A function that is the same on every render and calls the latest `fn`: an event handler for a memoised child (the
 * message box, the side panels) that reads this render's state without its own list of dependencies. Only for handlers
 * called after rendering (a click, a key, a submit): one called while the child renders (a render prop) needs
 * `useCallback` with its dependencies.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn);
  // Before any layout effect or event can run, so a handler never calls the version from a render before.
  useInsertionEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: A) => latest.current(...args), []);
}

/**
 * An object of handlers that is the same on every render, each calling the latest one (see `useStableCallback`). The
 * object must have the same keys on every render.
 */
export function useStableHandlers<T extends { [K in keyof T]: (...args: never[]) => unknown }>(handlers: T): T {
  const latest = useRef(handlers);
  useInsertionEffect(() => {
    latest.current = handlers;
  });
  const stable = useRef<T | null>(null);
  stable.current ??= Object.fromEntries(Object.keys(handlers).map((key) => [key, (...args: never[]) => (latest.current[key as keyof T] as (...a: never[]) => unknown)(...args)])) as T;
  return stable.current;
}
