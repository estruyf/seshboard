/**
 * Update when it's idle, asked by another computer (`app.update.install` with `idle`): the update starts once none of
 * this computer's sessions works, or not at all after Cancel update. Kept in memory: the restart it leads to is what
 * ends it. Pure, with tests; the hub says when sessions changed.
 */
export class IdleUpdate {
  /** Who asked (the computer's name), while it waits. */
  private by: string | null = null;

  constructor(
    private readonly options: {
      /** How many sessions work here now (working, waiting on someone, or with a background task). */
      working(): number;
      /** Updates now, for `by`. */
      start(by: string): void;
      /** Whether it waits changed: the computers hear it. */
      changed(): void;
    },
  ) {}

  get waiting(): boolean {
    return this.by !== null;
  }

  /** Waits for idle, or starts at once when nothing works. A second ask replaces the first. */
  wait(by: string): void {
    this.by = by;
    if (!this.check()) this.options.changed();
  }

  /** Cancel update: stops the wait. False when it wasn't waiting. */
  cancel(): boolean {
    if (!this.by) return false;
    this.by = null;
    this.options.changed();
    return true;
  }

  /** Sessions changed: once none works, the update starts. True when it did. */
  check(): boolean {
    if (!this.by || this.options.working() > 0) return false;
    const by = this.by;
    this.by = null;
    this.options.changed();
    this.options.start(by);
    return true;
  }
}
