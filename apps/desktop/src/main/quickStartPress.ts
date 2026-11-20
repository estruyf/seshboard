/** How long a press waits for a panel made just now before it gives up or shows it as it is. */
export const QUICK_START_READY_TIMEOUT_MS = 3_000;

/** What a press fixes at the moment it happens: whether what was typed stays, and where the window goes (the screen with the cursor then). */
export interface Press<Bounds> {
  keepDraft: boolean;
  bounds: Bounds;
}

/** What the press logic asks of Electron, so the cases can be tested without a window. */
export interface PressHost<Panel, Bounds> {
  /** The page said its field is mounted and can take the focus. */
  isReady(panel: Panel): boolean;
  /** The page has not finished loading. */
  isLoading(panel: Panel): boolean;
  /** The window is on screen. */
  isVisible(panel: Panel): boolean;
  /**
   * The window is taken (shown and focused, invisibly where the system would refuse the focus to a window that shows later)
   * and put where `press.bounds` says. Called at the press; on macOS it does nothing before the reveal.
   */
  prepare(panel: Panel, press: Press<Bounds>): void;
  /** The window is made visible. */
  reveal(panel: Panel, press: Press<Bounds>): void;
  /** Tells the page it was shown, so it focuses its field. */
  sendShown(panel: Panel, keepDraft: boolean): void;
  /** Takes a prepared window back (a press that was dropped or taken back). */
  abandon(panel: Panel): void;
  log(message: string): void;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
}

/**
 * A press of Quick start's shortcut. With the panel ready it shows at once. With one made just now, the press waits for the
 * page's own signal (its field is mounted), so keys typed before go to the app in front and not into a blank window. A press
 * that waits longer than `QUICK_START_READY_TIMEOUT_MS` shows the window if the page has finished loading, and is dropped
 * (and logged) if it has not. A signal that comes after that still reaches a panel that is on screen.
 */
export class QuickStartPress<Panel, Bounds> {
  #pending: { panel: Panel; press: Press<Bounds>; timer: unknown } | null = null;
  /** What the last shown press said, for a signal that comes late. */
  #lastKeepDraft = false;

  constructor(private readonly host: PressHost<Panel, Bounds>) {}

  /** A press waits for its panel. */
  get pending(): boolean {
    return this.#pending !== null;
  }

  press(panel: Panel, press: Press<Bounds>): void {
    this.#clear();
    this.host.prepare(panel, press);
    if (this.host.isReady(panel)) return this.#show(panel, press);
    this.#pending = { panel, press, timer: this.host.setTimer(() => this.#timedOut(), QUICK_START_READY_TIMEOUT_MS) };
  }

  /** The page of `panel` said its field is mounted. */
  ready(panel: Panel): void {
    const pending = this.#pending;
    if (pending && pending.panel === panel) {
      this.#clear();
      return this.#show(panel, pending.press);
    }
    // A press that showed the window before the page was up (it was loaded by then): the page learns of it now.
    if (!pending && this.host.isVisible(panel)) this.host.sendShown(panel, this.#lastKeepDraft);
  }

  /** The press is taken back (the shortcut again, Esc): nothing shows. */
  takeBack(): void {
    const pending = this.#pending;
    if (!pending) return;
    this.#clear();
    this.host.abandon(pending.panel);
  }

  /** The panel's window is gone. */
  closed(panel: Panel): void {
    if (this.#pending?.panel === panel) this.#clear();
  }

  #show(panel: Panel, press: Press<Bounds>): void {
    this.#lastKeepDraft = press.keepDraft;
    this.host.reveal(panel, press);
    this.host.sendShown(panel, press.keepDraft);
  }

  #timedOut(): void {
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = null;
    if (this.host.isLoading(pending.panel)) {
      this.host.log('[quick start] the panel was still loading after 3 s; the press was dropped');
      this.host.abandon(pending.panel);
      return;
    }
    // The page loaded but has not said it is ready: show the window, and the page focuses its field when it does.
    this.#lastKeepDraft = pending.press.keepDraft;
    this.host.reveal(pending.panel, pending.press);
  }

  #clear(): void {
    if (this.#pending) this.host.clearTimer(this.#pending.timer);
    this.#pending = null;
  }
}
