/**
 * Whether someone uses this computer now, for paired phones: a device can ask for some notifications only while you
 * are away, so the engine holds those back while you sit here. Pure (Electron's `powerMonitor` comes in as a
 * function), with tests.
 */

/** `powerMonitor.getSystemIdleState`'s answer. */
export type IdleState = 'active' | 'idle' | 'locked' | 'unknown';

/** No keyboard or mouse for this long counts as away. */
export const AWAY_AFTER_SECONDS = 5 * 60;
/** How often it looks: coming back counts within this time. */
export const PRESENCE_POLL_MS = 10_000;

export class Presence {
  private present: boolean | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly options: {
      /** `powerMonitor.getSystemIdleState(seconds)`. */
      idleState: (seconds: number) => IdleState;
      /** Called once at the start and on each change. */
      send: (present: boolean) => void;
    },
  ) {}

  start(): void {
    this.check();
    this.timer ??= setInterval(() => this.check(), PRESENCE_POLL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Locked or asleep: away now, without waiting for the next look. */
  away(): void {
    this.set(false);
  }

  /**
   * Looks now (also after an unlock or a wake). Only `active` counts as here: `unknown` (where the system can't tell)
   * pushes as before.
   */
  check(): void {
    this.set(this.options.idleState(AWAY_AFTER_SECONDS) === 'active');
  }

  private set(present: boolean): void {
    if (present === this.present) return;
    this.present = present;
    this.options.send(present);
  }
}
