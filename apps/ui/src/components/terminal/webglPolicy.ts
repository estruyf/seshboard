/** How many times a terminal may lose its WebGL context within `LOSS_WINDOW_MS` before it stays on the DOM renderer. */
export const MAX_LOSSES = 3;
export const LOSS_WINDOW_MS = 5 * 60_000;

/** What a terminal remembers about its WebGL going wrong (a lost context, or one that would not start). */
export interface WebglHistory {
  /** When each recent loss happened (ms), oldest first; only those inside the window are kept. */
  losses: number[];
  /** Too many losses in a short time: the DOM renderer for good, so a failing driver isn't tried over and over. */
  gaveUp: boolean;
}

export const NO_LOSSES: WebglHistory = { losses: [], gaveUp: false };

/** The history after a loss at `now`. Reaching `MAX_LOSSES` inside the window gives up for the rest of the terminal's life. */
export function recordLoss(history: WebglHistory, now: number): WebglHistory {
  const losses = [...history.losses.filter((at) => now - at < LOSS_WINDOW_MS), now];
  return { losses, gaveUp: history.gaveUp || losses.length >= MAX_LOSSES };
}

/** Whether a terminal that is on screen should try WebGL now. */
export function mayUseWebgl(history: WebglHistory): boolean {
  return !history.gaveUp;
}
