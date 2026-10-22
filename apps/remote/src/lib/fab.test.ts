import { describe, expect, it } from 'vitest';
import { FAB_START, nextFab, type FabState } from './fab.ts';

const scroll = (ys: number[], from: FabState = FAB_START) => ys.reduce(nextFab, from);

describe('the floating New session button', () => {
  it('stays out until the list went down past the slack', () => {
    expect(scroll([4, 8, 12]).shown).toBe(true);
    expect(scroll([4, 8, 13]).shown).toBe(false);
  });

  it('comes back once you scroll up past the slack, counted from the lowest point', () => {
    const hidden = scroll([100, 300, 500]);
    expect(hidden).toEqual({ shown: false, anchor: 500 });
    expect(nextFab(hidden, 490).shown).toBe(false);
    expect(nextFab(hidden, 487).shown).toBe(true);
  });

  it('is always out at the top, and in a bounce over it', () => {
    expect(nextFab({ shown: false, anchor: 400 }, 0).shown).toBe(true);
    expect(nextFab({ shown: false, anchor: 400 }, -20).shown).toBe(true);
  });

  it('measures a slow scroll down from where it turned, not event by event', () => {
    const up = scroll([200, 400, 300]);
    expect(up.shown).toBe(true);
    expect(scroll([305, 310, 312], up).shown).toBe(true);
    expect(scroll([305, 310, 312, 313], up).shown).toBe(false);
  });
});
