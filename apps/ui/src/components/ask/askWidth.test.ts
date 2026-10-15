import { describe, expect, it } from 'vitest';
import { ASK_DEFAULT_WIDTH, ASK_MIN_WIDTH, askWidthForKey, clampAskWidth, readTab, rightPanel } from './askWidth.ts';

describe('Ask panel width', () => {
  it('starts at 380px and stays between the minimum and 70% of the window', () => {
    expect(ASK_DEFAULT_WIDTH).toBe(380);
    expect(clampAskWidth(Number.NaN, 1400)).toBe(380);
    expect(clampAskWidth(0, 1400)).toBe(380);
    expect(clampAskWidth(100, 1400)).toBe(ASK_MIN_WIDTH);
    expect(clampAskWidth(5000, 1000)).toBe(700);
    expect(clampAskWidth(420.4, 1400)).toBe(420);
    // A window too small for the minimum still gets it.
    expect(clampAskWidth(500, 300)).toBe(ASK_MIN_WIDTH);
  });

  it('moves the edge with the arrow keys', () => {
    expect(askWidthForKey('ArrowLeft', 380, 1400)).toBe(404);
    expect(askWidthForKey('ArrowRight', 380, 1400)).toBe(356);
    expect(askWidthForKey('Enter', 380, 1400)).toBeNull();
  });
});

describe('the right panel', () => {
  it('shows tabs only when Changes and Ask are both open, on the tab picked last', () => {
    expect(rightPanel(true, true, 'ask')).toEqual({ tab: 'ask', tabs: true });
    expect(rightPanel(true, true, 'changes')).toEqual({ tab: 'changes', tabs: true });
    expect(rightPanel(true, false, 'ask')).toEqual({ tab: 'changes', tabs: false });
    expect(rightPanel(false, true, 'changes')).toEqual({ tab: 'ask', tabs: false });
    expect(rightPanel(false, false, 'ask')).toEqual({ tab: null, tabs: false });
    expect(readTab('ask')).toBe('ask');
    expect(readTab(null)).toBe('changes');
    expect(readTab('junk')).toBe('changes');
  });
});
