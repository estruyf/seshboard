import type { HostState } from '@seshboard/protocol/client';

/** Where `whenIdle` reads a session's state: its current one, and a way to hear when it changes. */
export interface HostStateSource {
  state(): HostState | undefined;
  /** Calls `listener` on every change; returns how to stop. */
  subscribe(listener: () => void): () => void;
}

/**
 * Waits until a session has worked and is idle again (a `/compact` it was sent has finished). True when it went
 * idle; false when it closed, failed, went away or `ms` passed. A session still idle from before it got the message
 * doesn't count: it has to be seen busy first.
 */
export function whenIdle(source: HostStateSource, ms = 180_000): Promise<boolean> {
  return new Promise((resolve) => {
    let seenBusy = false;
    let done = false;
    let stop: () => void = () => {};
    const finish = (idle: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop();
      resolve(idle);
    };
    const timer = setTimeout(() => finish(false), ms);
    const check = () => {
      const state = source.state();
      if (state === 'running' || state === 'starting' || state === 'needs-you') seenBusy = true;
      else if (state === 'idle') {
        if (seenBusy) finish(true);
      } else finish(false);
    };
    stop = source.subscribe(check);
    if (done) stop();
    check();
  });
}
