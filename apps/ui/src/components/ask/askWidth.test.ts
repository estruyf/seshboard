import { describe, expect, it } from 'vitest';
import { canvasOfTab, canvasTab, ASK_DEFAULT_WIDTH, ASK_MIN_WIDTH, askWidthForKey, clampAskWidth, panelWidthFor, readTab, rightPanel } from './askWidth.ts';

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
  const open = (changes: boolean, ask: boolean, agents = false, terminal = false, commands = false, files = false, web = false, note = false) => ({ files, changes, ask, agents, commands, note, web, terminal });

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

  it('puts Files first and the Note after Commands', () => {
    expect(rightPanel(open(false, false, false, false, true, true, false, true), 'note')).toEqual({ tab: 'note', tabs: true, open: ['files', 'commands', 'note'] });
    expect(rightPanel(open(false, false, false, false, false, false, false, true), 'changes')).toEqual({ tab: 'note', tabs: false, open: ['note'] });
  });

  it('puts Files before Changes, and the terminal last', () => {
    expect(rightPanel(open(true, false, false, true, true, true), 'files')).toEqual({ tab: 'files', tabs: true, open: ['files', 'changes', 'commands', 'terminal'] });
    expect(rightPanel(open(false, false, false, false, false, true), 'changes')).toEqual({ tab: 'files', tabs: false, open: ['files'] });
  });

  it('puts the web preview before the terminal', () => {
    expect(rightPanel(open(true, false, false, true, false, true, true), 'web')).toEqual({ tab: 'web', tabs: true, open: ['files', 'changes', 'web', 'terminal'] });
    expect(rightPanel(open(false, false, false, false, false, false, true), 'changes')).toEqual({ tab: 'web', tabs: false, open: ['web'] });
  });

  it('reads a stored tab', () => {
    expect(readTab('files')).toBe('files');
    expect(readTab('preview')).toBe('changes');
    expect(readTab('web')).toBe('web');
    expect(readTab('ask')).toBe('ask');
    expect(readTab('agents')).toBe('agents');
    expect(readTab('terminal')).toBe('terminal');
    expect(readTab('commands')).toBe('commands');
    expect(readTab('note')).toBe('note');
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

describe('canvases as tabs', () => {
  const closed = { files: false, changes: false, ask: false, agents: false, commands: false, note: false, web: false, terminal: false };
  it('puts the open canvases last, and shows the picked one in front', () => {
    const right = rightPanel({ ...closed, changes: true }, canvasTab('notes'), ['pane'], ['frontmatter', 'notes']);
    expect(right.open).toEqual(['changes', 'mod:pane', 'canvas:frontmatter', 'canvas:notes']);
    expect(right.tab).toBe('canvas:notes');
    expect(canvasOfTab(right.tab)).toBe('notes');
    expect(canvasOfTab('changes')).toBeNull();
  });
  it('falls back to the first open panel when the canvas closed', () => {
    expect(rightPanel({ ...closed, changes: true }, canvasTab('notes')).tab).toBe('changes');
  });
  it('reads a stored canvas tab, and nothing that is not an id', () => {
    expect(readTab('canvas:post-workbench')).toBe('canvas:post-workbench');
    expect(readTab('canvas:../x')).toBe('changes');
  });
});
