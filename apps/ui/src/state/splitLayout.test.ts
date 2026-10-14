import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORIENTATION,
  DRAG_THRESHOLD,
  dragStarted,
  dropTarget,
  effectiveOrientation,
  otherOrientation,
  paneAt,
  paneElements,
  parseOrientation,
  shownOrientation,
  STACKED_MIN_PANE_HEIGHT,
  stackedBlocked,
  swapSlots,
  type Rect,
} from './splitLayout.ts';

describe('parseOrientation', () => {
  it('reads what was saved', () => {
    expect(parseOrientation({ orientation: 'stacked' })).toBe('stacked');
    expect(parseOrientation({ orientation: 'side' })).toBe('side');
  });

  it('is side by side for anything else', () => {
    expect(DEFAULT_ORIENTATION).toBe('side');
    for (const value of [null, undefined, 'stacked', 7, {}, { orientation: 'rows' }, { orientation: null }]) expect(parseOrientation(value)).toBe('side');
  });
});

describe('otherOrientation', () => {
  it('flips between the two', () => {
    expect(otherOrientation('side')).toBe('stacked');
    expect(otherOrientation('stacked')).toBe('side');
  });
});

describe('effectiveOrientation', () => {
  it('stacks when each pane gets its minimum height', () => {
    expect(stackedBlocked(2 * STACKED_MIN_PANE_HEIGHT)).toBe(false);
    expect(effectiveOrientation('stacked', 2 * STACKED_MIN_PANE_HEIGHT)).toBe('stacked');
  });

  it('goes side by side while the area is too short, without forgetting the choice', () => {
    expect(stackedBlocked(2 * STACKED_MIN_PANE_HEIGHT - 1)).toBe(true);
    expect(effectiveOrientation('stacked', 2 * STACKED_MIN_PANE_HEIGHT - 1)).toBe('side');
    expect(effectiveOrientation('stacked', 900)).toBe('stacked');
  });

  it('keeps side by side whatever the height, and waits for a measurement', () => {
    expect(effectiveOrientation('side', 100)).toBe('side');
    expect(effectiveOrientation('side', null)).toBe('side');
    expect(effectiveOrientation('stacked', null)).toBe('stacked');
    expect(stackedBlocked(null)).toBe(false);
  });
});

describe('shownOrientation', () => {
  it('shows side by side only while stacking is blocked', () => {
    expect(shownOrientation('stacked', true)).toBe('side');
    expect(shownOrientation('stacked', false)).toBe('stacked');
    expect(shownOrientation('side', true)).toBe('side');
  });
});

describe('swapSlots', () => {
  it('trades the two sessions and keeps the active pane with its session', () => {
    expect(swapSlots({ mainId: 'a', splitId: 'b', activePane: 'main' })).toEqual({ mainId: 'b', splitId: 'a', activePane: 'split' });
    expect(swapSlots({ mainId: 'a', splitId: 'b', activePane: 'split' })).toEqual({ mainId: 'b', splitId: 'a', activePane: 'main' });
  });

  it('is its own inverse', () => {
    const slots = { mainId: 'a', splitId: 'b', activePane: 'split' as const };
    expect(swapSlots(swapSlots(slots))).toEqual(slots);
  });

  it('does nothing with one pane', () => {
    const one = { mainId: 'a', splitId: null, activePane: 'main' as const };
    expect(swapSlots(one)).toBe(one);
  });
});

describe('paneElements', () => {
  it('has nothing without a session and one unnamed pane with one', () => {
    expect(paneElements(null, null)).toEqual([]);
    expect(paneElements('a', null)).toEqual([{ id: 'a', pane: null, position: 0 }]);
    expect(paneElements('a', 'a')).toEqual([{ id: 'a', pane: null, position: 0 }]);
  });

  it('keeps the same element order before and after a swap, so no pane is moved in the DOM', () => {
    const before = paneElements('a', 'b');
    const after = paneElements('b', 'a');
    expect(before.map((p) => p.id)).toEqual(['a', 'b']);
    expect(after.map((p) => p.id)).toEqual(['a', 'b']);
    expect(before.map((p) => p.position)).toEqual([0, 1]);
    expect(after.map((p) => p.position)).toEqual([1, 0]);
    expect(after.map((p) => p.pane)).toEqual(['split', 'main']);
  });

  it('orders by id whichever session is in the first pane', () => {
    expect(paneElements('z', 'c').map((p) => [p.id, p.position])).toEqual([
      ['c', 1],
      ['z', 0],
    ]);
  });
});

const rects: Record<'main' | 'split', Rect> = {
  main: { left: 0, top: 0, right: 100, bottom: 200 },
  split: { left: 100, top: 0, right: 200, bottom: 200 },
};

describe('dragStarted', () => {
  it('needs the pointer to move a few pixels, so a click is not a drag', () => {
    expect(dragStarted({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(false);
    expect(dragStarted({ x: 10, y: 10 }, { x: 12, y: 12 })).toBe(false);
    expect(dragStarted({ x: 10, y: 10 }, { x: 10 + DRAG_THRESHOLD, y: 10 })).toBe(true);
    expect(dragStarted({ x: 10, y: 10 }, { x: 10, y: 10 - DRAG_THRESHOLD })).toBe(true);
  });
});

describe('paneAt and dropTarget', () => {
  it('finds the pane under the pointer, edges included on the near side', () => {
    expect(paneAt({ x: 50, y: 50 }, rects)).toBe('main');
    expect(paneAt({ x: 100, y: 50 }, rects)).toBe('split');
    expect(paneAt({ x: 199, y: 199 }, rects)).toBe('split');
    expect(paneAt({ x: 200, y: 50 }, rects)).toBeNull();
    expect(paneAt({ x: -1, y: 50 }, rects)).toBeNull();
  });

  it('drops onto the other pane only', () => {
    expect(dropTarget('main', { x: 150, y: 10 }, rects)).toBe('split');
    expect(dropTarget('split', { x: 20, y: 10 }, rects)).toBe('main');
    expect(dropTarget('main', { x: 20, y: 10 }, rects)).toBeNull();
    expect(dropTarget('main', { x: 500, y: 10 }, rects)).toBeNull();
  });

  it('works for panes stacked in rows', () => {
    const rows = { main: { left: 0, top: 0, right: 300, bottom: 100 }, split: { left: 0, top: 100, right: 300, bottom: 200 } };
    expect(dropTarget('main', { x: 150, y: 150 }, rows)).toBe('split');
    expect(dropTarget('split', { x: 150, y: 50 }, rows)).toBe('main');
  });
});
