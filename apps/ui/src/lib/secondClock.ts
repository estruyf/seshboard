import { useSyncExternalStore } from 'react';

/**
 * One clock for the whole window that ticks once a second, only while something shows it: every working line (one
 * per session in split view) reads the same tick instead of running a timer of its own.
 */

const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, 1_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const idle = () => () => {};
const read = () => now;
const zero = () => 0;

/** The time, updated each second while `active`; 0 while not, so nothing ticks. */
export function useSecondClock(active: boolean): number {
  return useSyncExternalStore(active ? subscribe : idle, active ? read : zero);
}
