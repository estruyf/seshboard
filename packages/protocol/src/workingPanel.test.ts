import { describe, expect, it } from 'vitest';
import { FREE_JACK_CELLS, jackCell, jackDelayMs, WORKING_FADE, WORKING_HOLD, WORKING_ROUND_MS, WORKING_TAIL } from './workingPanel.ts';

describe('the working light', () => {
  it('visits top middle, top right, middle left, centre and bottom right, once every 1.5 seconds', () => {
    expect(FREE_JACK_CELLS.map(jackCell)).toEqual([
      { row: 0, col: 1 },
      { row: 0, col: 2 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
      { row: 2, col: 2 },
    ]);
    expect(WORKING_ROUND_MS).toBe(1500);
    // The lit jack is full and the two before it fade: the tail is over two jacks long and under three.
    expect(WORKING_TAIL).toBeGreaterThan(2);
    expect(WORKING_TAIL).toBeLessThan(3);
    expect(WORKING_HOLD).toBeCloseTo(0.2);
    expect(WORKING_FADE).toBeCloseTo(WORKING_TAIL / 5);
  });

  it('puts each jack a fifth of a round after the one before, on the page clock', () => {
    const step = WORKING_ROUND_MS / FREE_JACK_CELLS.length;
    // Started at 0: the first jack is at the start of its round, the second a fifth of a round before its own.
    expect(jackDelayMs(0, 0)).toBe(0);
    expect(jackDelayMs(1, 0)).toBe(-(WORKING_ROUND_MS - step));
    // Two panels mounted at different times show the same frame: where each is in its round, at the same moment.
    const phase = (index: number, startedAt: number, now: number) => (((now - startedAt - jackDelayMs(index, startedAt)) % WORKING_ROUND_MS) + WORKING_ROUND_MS) % WORKING_ROUND_MS;
    for (let i = 0; i < FREE_JACK_CELLS.length; i++) expect(phase(i, 120, 5000)).toBeCloseTo(phase(i, 3333.5, 5000));
    for (const startedAt of [0, 77, 1499, 20_000.25]) {
      for (let i = 0; i < FREE_JACK_CELLS.length; i++) {
        expect(jackDelayMs(i, startedAt)).toBeLessThanOrEqual(0);
        expect(jackDelayMs(i, startedAt)).toBeGreaterThan(-WORKING_ROUND_MS);
      }
    }
  });
});
