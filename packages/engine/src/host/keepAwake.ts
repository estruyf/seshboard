import type { SessionHostInfo } from '@seshboard/protocol';

/** The part of a session's state that says whether it still has work to do. */
export type AwakeState = Pick<SessionHostInfo, 'state' | 'backgroundTasks' | 'queue' | 'queueHold' | 'compacting'>;

/**
 * Whether a session has nothing left to do: its process ended, or it is idle with no background task (shell command,
 * subagent or workflow), no compact, and nothing in Up next that sends by itself. Waiting on you (a permission or a
 * question) is not done: a paired phone can still answer it, and Claude goes on.
 */
export function sessionDone(info: AwakeState): boolean {
  if (info.state === 'closed' || info.state === 'error') return true;
  if (info.state !== 'idle') return false;
  return info.backgroundTasks.length === 0 && info.compacting !== true && (info.queue.length === 0 || info.queueHold !== null);
}

/**
 * How long a session stays done before its flag goes. A background task that ends hands Claude its result, and the
 * turn that follows starts a moment after the task list empties: without the wait, the flag would go in between.
 */
export const KEEP_AWAKE_GRACE_MS = 15_000;

export interface SessionsAwakeOptions {
  /** Whether any session holds sleep off changed. */
  onChange(on: boolean): void;
  /** A session's flag went by itself: it finished, or its process ended. */
  onCleared(sessionId: string): void;
  graceMs?: number;
}

/**
 * `waiting`: flagged while it had nothing to do, so it holds nothing until you send it something. `holding`: it works.
 * `finishing`: it is done, for the grace period.
 */
type Phase = 'waiting' | 'holding' | 'finishing';

/**
 * Keep awake until done (#241): the sessions that hold sleep off until they finish, background tasks included. A flag
 * goes by itself once its session is done after it worked, so nothing is left holding the computer awake.
 */
export class SessionsAwake {
  readonly #sessions = new Map<string, { phase: Phase; timer: ReturnType<typeof setTimeout> | null }>();
  readonly #options: SessionsAwakeOptions;
  #active = false;

  constructor(options: SessionsAwakeOptions) {
    this.#options = options;
  }

  /** Whether any session holds sleep off now. */
  get active(): boolean {
    return this.#active;
  }

  has(sessionId: string): boolean {
    return this.#sessions.has(sessionId);
  }

  /** Turns the flag on or off for a session, given its state now. A session whose process ended can't take it. */
  set(sessionId: string, on: boolean, info: AwakeState): boolean {
    this.#drop(sessionId);
    if (on) {
      if (info.state === 'closed' || info.state === 'error') return false;
      this.#sessions.set(sessionId, { phase: sessionDone(info) ? 'waiting' : 'holding', timer: null });
    }
    this.#changed();
    return true;
  }

  /** A session's state changed (every host update goes through here; sessions without the flag are ignored). */
  update(sessionId: string, info: AwakeState): void {
    const entry = this.#sessions.get(sessionId);
    if (!entry) return;
    if (info.state === 'closed' || info.state === 'error') {
      this.#clear(sessionId);
      return;
    }
    if (!sessionDone(info)) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = null;
      entry.phase = 'holding';
    } else if (entry.phase === 'holding') {
      entry.phase = 'finishing';
      entry.timer = setTimeout(() => this.#clear(sessionId), this.#options.graceMs ?? KEEP_AWAKE_GRACE_MS);
      entry.timer.unref?.();
    }
    this.#changed();
  }

  /** On shutdown: no timer outlives the engine. */
  dispose(): void {
    for (const id of [...this.#sessions.keys()]) this.#drop(id);
    this.#changed();
  }

  #clear(sessionId: string): void {
    if (!this.#sessions.has(sessionId)) return;
    this.#drop(sessionId);
    this.#changed();
    this.#options.onCleared(sessionId);
  }

  #drop(sessionId: string): void {
    const entry = this.#sessions.get(sessionId);
    if (entry?.timer) clearTimeout(entry.timer);
    this.#sessions.delete(sessionId);
  }

  #changed(): void {
    const active = [...this.#sessions.values()].some((e) => e.phase !== 'waiting');
    if (active === this.#active) return;
    this.#active = active;
    this.#options.onChange(active);
  }
}
