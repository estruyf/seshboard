import { describe, expect, it } from 'vitest';
import { railEntries, railLabel, railStep, railToolState, toggleRailTool, type RailAvailable, type RailEntry } from './toolRail.ts';

const ALL: RailAvailable = { changes: true, terminal: true, web: true, preview: true, ask: true, agents: true, commands: true, mods: ['notes'] };
const short = (entries: RailEntry[]) => entries.map((e) => (e.kind === 'divider' ? '|' : e.id)).join(' ');

describe('railEntries', () => {
  it('lists every tool in its group, with a divider between groups', () => {
    expect(short(railEntries(ALL))).toBe('changes terminal web preview | ask agents commands | mod:notes');
  });

  it('leaves out what does not apply: no repository, no browser, no preview, no mods', () => {
    expect(short(railEntries({ ...ALL, changes: false, web: false, preview: false, mods: [] }))).toBe('terminal | ask agents commands');
  });

  it('leaves out the tools the menu hid, and the mods all together', () => {
    expect(short(railEntries(ALL, ['ask', 'terminal', 'mods']))).toBe('changes web preview | agents commands');
  });

  it('drops a divider with nothing on one side', () => {
    expect(short(railEntries({ ...ALL, ask: false, agents: false, commands: false }))).toBe('changes terminal web preview | mod:notes');
    expect(short(railEntries({ ...ALL, mods: [] }))).toBe('changes terminal web preview | ask agents commands');
    expect(short(railEntries({ ...ALL, changes: false, terminal: false, web: false, preview: false, mods: [] }))).toBe('ask agents commands');
    expect(railEntries({ changes: false, terminal: false, web: false, preview: false, ask: false, agents: false, commands: false, mods: [] })).toEqual([]);
  });
});

describe('a click on a tool', () => {
  it('opens a closed tool, brings one behind to the front, and closes the one in front', () => {
    expect(railToolState('ask', ['changes'], 'changes')).toBe('closed');
    expect(railStep('closed', true)).toBe('open');
    expect(railToolState('ask', ['changes', 'ask'], 'changes')).toBe('behind');
    expect(railStep('behind', true)).toBe('front');
    expect(railToolState('changes', ['changes', 'ask'], 'changes')).toBe('front');
    expect(railStep('front', true)).toBe('close');
    // Alone on the side, a tool in front closes.
    expect(railStep('front', false)).toBe('close');
  });
});

describe('railLabel', () => {
  it('says the name and what is there', () => {
    expect(railLabel('changes', { changes: 3 })).toBe('Changes · 3 files');
    expect(railLabel('changes', { changes: 1 }, { separator: ', ' })).toBe('Changes, 1 file');
    expect(railLabel('web', { web: 2 })).toBe('Browser · 2 tabs');
    expect(railLabel('terminal', { terminal: 1 })).toBe('Terminal · 1 running');
    expect(railLabel('ask', {})).toBe('Ask');
    expect(railLabel('web', {}, { name: 'Web' })).toBe('Web');
    expect(railLabel('mod:notes', {}, { name: 'Notes' })).toBe('Notes');
  });
});

describe('toggleRailTool', () => {
  it('hides and shows a tool, in the rail’s order', () => {
    expect(toggleRailTool([], 'ask')).toEqual(['ask']);
    expect(toggleRailTool(['ask'], 'changes')).toEqual(['changes', 'ask']);
    expect(toggleRailTool(['changes', 'ask'], 'changes')).toEqual(['ask']);
  });
});
