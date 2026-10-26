export type QuitAnswer = 'quit' | 'cancel';

export interface QuitGuardOptions {
  /** Shows the "Quit Seshboard?" prompt. The answer comes back through `answer()`. */
  ask(): void;
  quit(): void;
}

/**
 * Guards ⌘Q against accidental presses: the first press asks, a second press
 * while the prompt is open quits. Other ways of quitting (Dock, logout) skip it.
 */
export class QuitGuard {
  #asking = false;

  constructor(private readonly options: QuitGuardOptions) {}

  get asking(): boolean {
    return this.#asking;
  }

  /** ⌘Q was pressed. */
  request(): void {
    if (this.#asking) {
      this.#asking = false;
      this.options.quit();
      return;
    }
    this.#asking = true;
    this.options.ask();
  }

  /** The prompt was answered (button, Enter or Esc). Late answers after quitting are ignored. */
  answer(answer: QuitAnswer): void {
    if (!this.#asking) return;
    this.#asking = false;
    if (answer === 'quit') this.options.quit();
  }
}
