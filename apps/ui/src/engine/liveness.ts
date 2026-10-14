/**
 * Whether the engine still answers. A crashed engine is noticed at once (main restarts it and the window
 * reconnects), but a hung one (paused, or stuck in a long synchronous task) keeps its port open: every
 * call waits for the RPC timeout and the window shows nothing. So while connected, the window pings it
 * now and then and counts the pings that get no answer in time.
 */

/**
 * How often the window pings the engine while it is connected and visible. With the timeout and two misses,
 * a hang shows within about nine seconds; the engine answers a ping in well under a millisecond otherwise.
 */
export const LIVENESS_INTERVAL_MS = 3_000;
/** A ping without an answer after this long counts as a miss. */
export const LIVENESS_TIMEOUT_MS = 3_000;
/** Misses in a row before the engine counts as not answering. */
export const MISSES_TO_STALL = 2;

export interface Liveness {
  /** Pings in a row that got no answer in time. */
  misses: number;
  /** The engine isn't answering: said in the window until the next answer. */
  stalled: boolean;
}

export const ALIVE: Liveness = { misses: 0, stalled: false };

/** The next state after a ping was answered (even late) or missed. Any answer clears a stall. */
export function nextLiveness(state: Liveness, event: 'answer' | 'miss', missesToStall = MISSES_TO_STALL): Liveness {
  if (event === 'answer') return state.misses === 0 && !state.stalled ? state : ALIVE;
  const misses = state.misses + 1;
  return { misses, stalled: state.stalled || misses >= missesToStall };
}

export interface LivenessOptions {
  /** One round trip to the engine (`system.ping`). A rejection counts as nothing: only the timer decides a miss. */
  ping(): Promise<unknown>;
  /** Called when `stalled` changes. */
  onChange(stalled: boolean): void;
  /** No pings while this says the window is hidden (its timers are throttled then, and nobody is looking). */
  isHidden?(): boolean;
  intervalMs?: number;
  timeoutMs?: number;
  missesToStall?: number;
}

export interface LivenessMonitor {
  readonly stalled: boolean;
  /** Stops pinging; answers that arrive later are ignored. Doesn't call `onChange`. */
  stop(): void;
}

/**
 * Pings every `intervalMs` (the first one after a full interval), each raced against its own `timeoutMs`
 * timer. After `missesToStall` misses in a row it reports a stall; the next answer, even to an older ping,
 * clears it.
 */
export function startLivenessMonitor({
  ping,
  onChange,
  isHidden = () => false,
  intervalMs = LIVENESS_INTERVAL_MS,
  timeoutMs = LIVENESS_TIMEOUT_MS,
  missesToStall = MISSES_TO_STALL,
}: LivenessOptions): LivenessMonitor {
  let state = ALIVE;
  let stopped = false;
  let tickTimer: ReturnType<typeof setTimeout> | undefined;
  const missTimers = new Set<ReturnType<typeof setTimeout>>();

  const record = (event: 'answer' | 'miss') => {
    if (stopped) return;
    const next = nextLiveness(state, event, missesToStall);
    const changed = next.stalled !== state.stalled;
    state = next;
    if (changed) onChange(state.stalled);
  };

  const tick = () => {
    tickTimer = setTimeout(tick, intervalMs);
    if (isHidden()) return;
    let answered = false;
    const missTimer = setTimeout(() => {
      missTimers.delete(missTimer);
      if (!answered) record('miss');
    }, timeoutMs);
    missTimers.add(missTimer);
    ping().then(
      () => {
        answered = true;
        clearTimeout(missTimer);
        missTimers.delete(missTimer);
        record('answer');
      },
      () => {},
    );
  };
  tickTimer = setTimeout(tick, intervalMs);

  return {
    get stalled() {
      return state.stalled;
    },
    stop() {
      stopped = true;
      clearTimeout(tickTimer);
      for (const timer of missTimers) clearTimeout(timer);
      missTimers.clear();
    },
  };
}
