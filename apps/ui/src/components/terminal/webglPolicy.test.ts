import { describe, expect, it } from 'vitest';
import { LOSS_WINDOW_MS, MAX_LOSSES, mayUseWebgl, NO_LOSSES, recordLoss, type WebglHistory } from './webglPolicy.ts';

describe('webglPolicy', () => {
  it('lets a terminal that never lost its context use WebGL', () => {
    expect(mayUseWebgl(NO_LOSSES)).toBe(true);
  });

  it('tries again after a loss or two', () => {
    let history = recordLoss(NO_LOSSES, 1_000);
    expect(mayUseWebgl(history)).toBe(true);
    history = recordLoss(history, 2_000);
    expect(history.losses).toEqual([1_000, 2_000]);
    expect(mayUseWebgl(history)).toBe(true);
  });

  it('gives up at the third loss within the window', () => {
    let history: WebglHistory = NO_LOSSES;
    for (let i = 0; i < MAX_LOSSES; i++) history = recordLoss(history, i * 60_000);
    expect(mayUseWebgl(history)).toBe(false);
  });

  it('forgets losses that are older than the window', () => {
    const history = recordLoss(recordLoss(recordLoss(NO_LOSSES, 0), 60_000), LOSS_WINDOW_MS + 30_000);
    expect(history.losses).toEqual([60_000, LOSS_WINDOW_MS + 30_000]);
    expect(mayUseWebgl(history)).toBe(true);
  });

  it('keeps trying when the losses are spread out', () => {
    let history: WebglHistory = NO_LOSSES;
    for (let i = 0; i < 10; i++) history = recordLoss(history, i * LOSS_WINDOW_MS);
    expect(mayUseWebgl(history)).toBe(true);
  });

  it('stays on the DOM renderer once it has given up, even long after', () => {
    let history: WebglHistory = NO_LOSSES;
    for (let i = 0; i < MAX_LOSSES; i++) history = recordLoss(history, i);
    expect(mayUseWebgl(recordLoss(history, 10 * LOSS_WINDOW_MS))).toBe(false);
  });
});
