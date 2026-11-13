import { describe, expect, it } from 'vitest';
import { ASK_DEFAULT_WIDTH, ASK_MIN_WIDTH, askWidthForKey, clampAskWidth, panelWidthFor, readTab, rightPanel } from './askWidth.ts';

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
  const open = (changes: boolean, ask: boolean, agents = false, terminal = false, commands = false, preview = false, web = false) => ({ changes, ask, agents, commands, preview, web, terminal });

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

  it('puts Commands after Agents and before the terminal', () => {
    expect(rightPanel(open(false, false, true, true, true), 'commands')).toEqual({ tab: 'commands', tabs: true, open: ['agents', 'commands', 'terminal'] });
    expect(rightPanel(open(false, false, false, false, true), 'changes')).toEqual({ tab: 'commands', tabs: false, open: ['commands'] });
  });

  it('puts a file preview after Commands and before the terminal', () => {
    expect(rightPanel(open(true, false, false, true, true, true), 'preview')).toEqual({ tab: 'preview', tabs: true, open: ['changes', 'commands', 'preview', 'terminal'] });
    expect(rightPanel(open(false, false, false, false, false, true), 'changes')).toEqual({ tab: 'preview', tabs: false, open: ['preview'] });
  });

  it('puts the web preview after a file preview and before the terminal', () => {
    expect(rightPanel(open(true, false, false, true, false, true, true), 'web')).toEqual({ tab: 'web', tabs: true, open: ['changes', 'preview', 'web', 'terminal'] });
    expect(rightPanel(open(false, false, false, false, false, false, true), 'changes')).toEqual({ tab: 'web', tabs: false, open: ['web'] });
  });

  it('reads a stored tab', () => {
    expect(readTab('preview')).toBe('preview');
    expect(readTab('web')).toBe('web');
    expect(readTab('ask')).toBe('ask');
    expect(readTab('agents')).toBe('agents');
    expect(readTab('terminal')).toBe('terminal');
    expect(readTab('commands')).toBe('commands');
    expect(readTab(null)).toBe('changes');
    expect(readTab('junk')).toBe('changes');
  });
});

describe('Half', () => {
  it('splits the session area 50/50, and keeps the dragged width at Side or before the area is measured', () => {
    expect(panelWidthFor('half', 480, 1400)).toBe(700);
    expect(panelWidthFor('half', 480, 1401)).toBe(700);
    expect(panelWidthFor('side', 480, 1400)).toBe(480);
    expect(panelWidthFor('half', 480, null)).toBe(480);
    // A narrow area still gives the panel its minimum.
    expect(panelWidthFor('half', 480, 400)).toBe(ASK_MIN_WIDTH);
  });
});
