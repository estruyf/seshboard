import { describe, expect, it } from 'vitest';
import { moveRailButton, railEntries, railLabel, railStep, railToolState, sameRailGroup, stepRailButton, toggleRailApp, toggleRailTool, type RailAvailable, type RailEntry } from './toolRail.ts';

const ALL: RailAvailable = { changes: true, terminal: true, web: true, preview: true, ask: true, agents: true, commands: true, mods: ['notes'], apps: [] };
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
    expect(railEntries({ changes: false, terminal: false, web: false, preview: false, ask: false, agents: false, commands: false, mods: [], apps: [] })).toEqual([]);
  });

  it('puts the pinned apps last, in their own group, also when the mods are hidden', () => {
    expect(short(railEntries({ ...ALL, apps: ['vscode', 'finder'] }))).toBe('changes terminal web preview | ask agents commands | mod:notes | app:vscode app:finder');
    expect(short(railEntries({ ...ALL, apps: ['finder'] }, ['mods']))).toBe('changes terminal web preview | ask agents commands | app:finder');
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

describe('moving a button on the rail', () => {
  const ORDER = { railOrder: ['changes', 'terminal', 'web', 'preview', 'ask', 'agents', 'commands'] as const, railApps: ['finder', 'vscode'] };
  const current = { railOrder: [...ORDER.railOrder], railApps: [...ORDER.railApps] };

  it("follows the dragged order inside each group", () => {
    const order = ['terminal', 'changes', 'preview', 'web', 'commands', 'ask', 'agents'] as const;
    expect(short(railEntries({ ...ALL, mods: [] }, [], order))).toBe('terminal changes preview web | commands ask agents');
  });

  it('moves a button only among its own group, never a mod pane', () => {
    expect(sameRailGroup('changes', 'web')).toBe(true);
    expect(sameRailGroup('changes', 'ask')).toBe(false);
    expect(sameRailGroup('app:finder', 'app:vscode')).toBe(true);
    expect(sameRailGroup('app:finder', 'commands')).toBe(false);
    expect(sameRailGroup('mod:notes', 'mod:notes')).toBe(false);
  });

  it('steps a button up or down, and stops at the end of its group', () => {
    const ids = ['changes', 'terminal', 'ask', 'app:finder', 'app:vscode'] as const;
    expect(stepRailButton(ids, 'terminal', -1)).toBe(0);
    expect(stepRailButton(ids, 'terminal', 1)).toBeNull();
    expect(stepRailButton(ids, 'app:finder', -1)).toBeNull();
    expect(stepRailButton(ids, 'app:finder', 1)).toBe(4);
  });

  it('keeps the tools that are not on the rail where they were', () => {
    // Web and Preview don't apply now: Terminal moves before Changes, and they stay after both.
    expect(moveRailButton(['changes', 'terminal', 'ask'], 'terminal', 0, current).railOrder).toEqual(['terminal', 'changes', 'web', 'preview', 'ask', 'agents', 'commands']);
    // The last of the group: after the one before it.
    expect(moveRailButton(['changes', 'terminal', 'ask', 'agents'], 'ask', 3, current).railOrder).toEqual(['changes', 'terminal', 'web', 'preview', 'agents', 'ask', 'commands']);
  });

  it('moves a pinned app among the others', () => {
    expect(moveRailButton(['changes', 'app:finder', 'app:vscode'], 'app:vscode', 1, current)).toEqual({ railOrder: [...ORDER.railOrder], railApps: ['vscode', 'finder'] });
    expect(moveRailButton(['changes', 'app:finder', 'app:vscode'], 'app:finder', 2, current).railApps).toEqual(['vscode', 'finder']);
  });
});

describe('toggleRailApp', () => {
  it('pins an app at the bottom and unpins it again', () => {
    expect(toggleRailApp([], 'finder')).toEqual(['finder']);
    expect(toggleRailApp(['finder'], 'vscode')).toEqual(['finder', 'vscode']);
    expect(toggleRailApp(['finder', 'vscode'], 'finder')).toEqual(['vscode']);
  });
});
