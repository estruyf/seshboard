import { describe, expect, it } from 'vitest';
import { placeToolbar, selectionLines, type Rect } from './selectionToolbar.ts';

const rect = (left: number, top: number, width: number, height = 20): Rect => ({ left, top, right: left + width, bottom: top + height });
/** The transcript: 600px wide, its top at 100px. */
const bounds = rect(0, 100, 600, 700);
const size = { width: 240, height: 30 };

describe('placeToolbar', () => {
  it('sits above the first line with an 8px gap, centred on it', () => {
    const line = rect(200, 300, 100);
    expect(placeToolbar({ first: line, last: line, bounds, ...size })).toEqual({ left: 130, top: 262, side: 'above' });
  });

  it('flips under the last line when there is no room above', () => {
    const first = rect(200, 110, 100);
    const last = rect(40, 170, 300);
    const placed = placeToolbar({ first, last, bounds, ...size });
    expect(placed).toEqual({ left: 130, top: 198, side: 'below' });
    // Never over the selection: the toolbar starts under the last line.
    expect(placed.top).toBeGreaterThanOrEqual(last.bottom);
  });

  it('stays 8px inside the left and right edges', () => {
    expect(placeToolbar({ first: rect(0, 300, 40), last: rect(0, 300, 40), bounds, ...size }).left).toBe(8);
    expect(placeToolbar({ first: rect(560, 300, 40), last: rect(560, 300, 40), bounds, ...size }).left).toBe(600 - 8 - 240);
  });
});

describe('selectionLines', () => {
  it('anchors a selection over several lines to the selected part of its first line', () => {
    const rects = [
      rect(300, 300, 120), // the end of the first line, where the selection starts
      rect(40, 296, 900, 72), // a whole list item the range covers: a block, not a line
      rect(40, 324, 500), // the second line
      rect(40, 348, 180), // the last line
    ];
    const lines = selectionLines(rects)!;
    expect(lines.first).toEqual(rect(300, 300, 120));
    expect(lines.last).toEqual(rect(40, 348, 180));
    expect(placeToolbar({ ...lines, bounds, ...size })).toEqual({ left: 240, top: 262, side: 'above' });
  });

  it('joins the pieces of one line (bold, inline code) and skips empty rects', () => {
    const lines = selectionLines([rect(100, 300, 0), rect(100, 300, 60), rect(160, 299, 40, 22), rect(200, 300, 80)])!;
    expect(lines.first).toEqual({ left: 100, top: 299, right: 280, bottom: 321 });
    expect(lines.last).toEqual(lines.first);
  });

  it('has nothing to anchor to without rects', () => {
    expect(selectionLines([])).toBeNull();
    expect(selectionLines([rect(10, 10, 0)])).toBeNull();
  });
});
