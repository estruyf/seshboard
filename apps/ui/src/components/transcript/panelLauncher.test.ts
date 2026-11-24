import { describe, expect, it } from 'vitest';
import { launcherEntries, launcherKey, launcherPick, launcherShown, panelButton, type LauncherEntry } from './panelLauncher.ts';
import type { RailAvailable } from './toolRail.ts';

const ALL: RailAvailable = { changes: true, terminal: true, web: true, files: true, ask: true, agents: true, commands: true, note: false, mods: ['notes'], apps: ['vscode'] };
const short = (entries: LauncherEntry[]) => entries.map((e) => (e.kind === 'divider' ? '|' : e.id)).join(' ');

describe('launcherEntries', () => {
  it("lists the session's own tools in the rail's groups and order, without mods' panes or pinned apps", () => {
    expect(short(launcherEntries(ALL))).toBe('files changes terminal web | ask agents commands');
  });

  it('leaves out what does not apply, and a divider with nothing on one side', () => {
    expect(short(launcherEntries({ ...ALL, files: false, changes: false, web: false }))).toBe('terminal | ask agents commands');
    expect(short(launcherEntries({ ...ALL, ask: false, agents: false, commands: false }))).toBe('files changes terminal web');
  });

  it('follows the order the rail was dragged to', () => {
    expect(short(launcherEntries(ALL, ['web', 'changes', 'files', 'terminal', 'commands', 'agents', 'ask', 'note']))).toBe('web changes files terminal | commands agents ask');
  });

  it('lists the Note while the session has one', () => {
    expect(short(launcherEntries({ ...ALL, note: true }))).toBe('files changes terminal web | ask agents commands note');
  });
});

describe('launcherShown', () => {
  it('shows while asked for and nothing else is on the side', () => {
    expect(launcherShown(true, 0, false)).toBe(true);
    expect(launcherShown(false, 0, false)).toBe(false);
  });

  it('gives way to a tool, or to Why', () => {
    expect(launcherShown(true, 1, false)).toBe(false);
    expect(launcherShown(true, 0, true)).toBe(false);
  });
});

describe('panelButton', () => {
  it('hides the side while it shows something, the empty panel too', () => {
    expect(panelButton(true)).toEqual({ action: 'hide', label: 'Hide panel' });
  });

  it('shows the empty panel while the side is closed', () => {
    expect(panelButton(false)).toEqual({ action: 'show', label: 'Show panel' });
  });
});

describe('launcherPick', () => {
  it('opens a closed tool and leaves an open one (the terminal below) as it is', () => {
    expect(launcherPick('closed')).toBe('open');
    expect(launcherPick('front')).toBeNull();
    expect(launcherPick('behind')).toBeNull();
  });
});

describe('launcherKey', () => {
  it('moves down and up, wrapping round', () => {
    expect(launcherKey('ArrowDown', 0, 3)).toBe(1);
    expect(launcherKey('ArrowDown', 2, 3)).toBe(0);
    expect(launcherKey('ArrowUp', 0, 3)).toBe(2);
    expect(launcherKey('ArrowUp', -1, 3)).toBe(2);
    expect(launcherKey('ArrowDown', -1, 3)).toBe(0);
  });

  it('goes to the ends with Home and End, and ignores other keys or an empty list', () => {
    expect(launcherKey('Home', 2, 3)).toBe(0);
    expect(launcherKey('End', 0, 3)).toBe(2);
    expect(launcherKey('Enter', 0, 3)).toBeNull();
    expect(launcherKey('ArrowDown', 0, 0)).toBeNull();
  });
});
