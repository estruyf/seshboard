/**
 * How long the hidden menu bar panel is kept before its window is destroyed. It is a whole renderer with its own
 * connection to the engine, about 100 MB, so one nobody has opened for an hour goes; the next click makes it again.
 * (Quick start's panel stays: a fast first press matters more there.)
 */
export const PANEL_IDLE_MS = 60 * 60_000;

/**
 * Counts how long a panel stays hidden and destroys it after `afterMs`. `hidden()` starts the count, `shown()` stops it;
 * a panel that is destroyed some other way needs `cancel()`.
 */
export class IdlePanel {
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly options: {
      afterMs: number;
      /** Destroys the panel, if it is still hidden (a smoke step may be holding it open). */
      destroy(): void;
    },
  ) {}

  /** The panel went out of sight (or was made and not shown): it goes after `afterMs` of that. */
  hidden(): void {
    this.cancel();
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.options.destroy();
    }, this.options.afterMs);
  }

  /** The panel shows: it stays. */
  shown(): void {
    this.cancel();
  }

  cancel(): void {
    if (this.#timer === null) return;
    clearTimeout(this.#timer);
    this.#timer = null;
  }
}
