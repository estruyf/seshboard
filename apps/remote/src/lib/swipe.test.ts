import { describe, expect, it } from 'vitest';
import { ACTION_WIDTH, actionFor, restingOffset, swipeOffset, swipeOutcome } from './swipe.ts';

const BOTH = { read: true, archive: true };
const ROW = 390;

describe('swipe actions', () => {
  it('marks as read to the right and archives to the left', () => {
    expect(actionFor(30)).toBe('read');
    expect(actionFor(-30)).toBe('archive');
    expect(actionFor(0)).toBeNull();
  });

  it('shows the button after a short swipe, and goes back after a tiny one', () => {
    expect(swipeOutcome(60, ROW, 0, BOTH)).toEqual({ kind: 'reveal', action: 'read' });
    expect(swipeOutcome(-60, ROW, 0, BOTH)).toEqual({ kind: 'reveal', action: 'archive' });
    expect(swipeOutcome(20, ROW, 0, BOTH)).toEqual({ kind: 'close' });
  });

  it('acts at once past 60% of the row', () => {
    expect(swipeOutcome(ROW * 0.61, ROW, 0, BOTH)).toEqual({ kind: 'commit', action: 'read' });
    expect(swipeOutcome(-ROW * 0.7, ROW, 0, BOTH)).toEqual({ kind: 'commit', action: 'archive' });
    expect(swipeOutcome(ROW * 0.59, ROW, 0, BOTH)).toEqual({ kind: 'reveal', action: 'read' });
  });

  it('lets a flick show the button, or put it back', () => {
    expect(swipeOutcome(-25, ROW, -0.6, BOTH)).toEqual({ kind: 'reveal', action: 'archive' });
    expect(swipeOutcome(-80, ROW, 0.6, BOTH)).toEqual({ kind: 'close' });
  });

  it("doesn't take an action the row can't do: Mark as read on a read session", () => {
    const readOnly = { read: false, archive: true };
    expect(swipeOutcome(300, ROW, 0, readOnly)).toEqual({ kind: 'close' });
    expect(Math.abs(swipeOffset(0, 200, ROW, readOnly))).toBeLessThanOrEqual(16);
    expect(swipeOffset(0, -200, ROW, readOnly)).toBe(-200);
  });

  it('follows the finger from where the button left the row', () => {
    expect(swipeOffset(-ACTION_WIDTH, -20, ROW, BOTH)).toBe(-ACTION_WIDTH - 20);
    expect(swipeOffset(0, 900, ROW, BOTH)).toBe(ROW);
  });

  it('rests with the button out on its side', () => {
    expect(restingOffset({ kind: 'reveal', action: 'read' })).toBe(ACTION_WIDTH);
    expect(restingOffset({ kind: 'reveal', action: 'archive' })).toBe(-ACTION_WIDTH);
    expect(restingOffset({ kind: 'close' })).toBe(0);
  });
});
