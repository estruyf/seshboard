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
  const open = (changes: boolean, ask: boolean, agents = false, terminal = false) => ({ changes, ask, agents, terminal });

  it('shows tabs only when more than one panel is open, on the tab picked last', () => {
    expect(rightPanel(open(true, true), 'ask')).toEqual({ tab: 'ask', tabs: true, open: ['changes', 'ask'] });
    expect(rightPanel(open(true, true), 'changes')).toEqual({ tab: 'changes', tabs: true, open: ['changes', 'ask'] });
    expect(rightPanel(open(true, false), 'ask')).toEqual({ tab: 'changes', tabs: false, open: ['changes'] });
    expect(rightPanel(open(false, true), 'changes')).toEqual({ tab: 'ask', tabs: false, open: ['ask'] });
    expect(rightPanel(open(false, false), 'ask')).toEqual({ tab: null, tabs: false, open: [] });
  });

  it('puts Agents with the others, and falls back to the first open one when the picked tab is closed', () => {
    expect(rightPanel(open(true, true, true), 'agents')).toEqual({ tab: 'agents', tabs: true, open: ['changes', 'ask', 'agents'] });
    expect(rightPanel(open(false, true, true), 'changes')).toEqual({ tab: 'ask', tabs: true, open: ['ask', 'agents'] });
    expect(rightPanel(open(false, false, true), 'ask')).toEqual({ tab: 'agents', tabs: false, open: ['agents'] });
  });

  it('puts a terminal docked right last, as a tab like the others', () => {
    expect(rightPanel(open(true, false, false, true), 'terminal')).toEqual({ tab: 'terminal', tabs: true, open: ['changes', 'terminal'] });
    expect(rightPanel(open(false, false, false, true), 'changes')).toEqual({ tab: 'terminal', tabs: false, open: ['terminal'] });
  });

  it('reads a stored tab', () => {
    expect(readTab('ask')).toBe('ask');
    expect(readTab('agents')).toBe('agents');
    expect(readTab('terminal')).toBe('terminal');
    expect(readTab(null)).toBe('changes');
    expect(readTab('junk')).toBe('changes');
  });
});
