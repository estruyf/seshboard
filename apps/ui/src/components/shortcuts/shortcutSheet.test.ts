import { describe, expect, it } from 'vitest';
import type { ShortcutContext } from '../../lib/shortcuts.ts';
import { actionRows, matchRow, parseKeyQuery, sectionForView, sheetLayout, typedCombo, type SheetAction, type SheetLayout } from './shortcutSheet.ts';

const HOME: ShortcutContext = {
  view: 'home',
  session: false,
  running: false,
  pending: null,
  catchUp: null,
  selection: 0,
  split: false,
  behind: false,
  focus: 'other',
  terminal: { open: false, maximized: false, actionRunning: false },
};
const SESSION: ShortcutContext = { ...HOME, view: 'session', session: true };

const press = (key: string, mods: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; code?: string } = {}) => ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key, ...mods });
const sections = (layout: SheetLayout) => layout.columns.map((column) => column.map((s) => s.id));
const rowIds = (layout: SheetLayout) => layout.columns.flat().flatMap((s) => s.rows.map((r) => r.id));
const row = (layout: SheetLayout, id: string) => layout.columns.flat().flatMap((s) => s.rows).find((r) => r.id === id);

describe('filtering by key', () => {
  it('reads glyphs, words and plus signs as keys', () => {
    const cmdJ = { mods: ['cmd'], key: 'j' };
    expect(parseKeyQuery('⌘J')).toEqual(cmdJ);
    expect(parseKeyQuery('cmd j')).toEqual(cmdJ);
    expect(parseKeyQuery('cmd+j')).toEqual(cmdJ);
    expect(parseKeyQuery('Command J')).toEqual(cmdJ);
    expect(parseKeyQuery('ctrl c')).toEqual({ mods: ['ctrl'], key: 'c' });
    expect(parseKeyQuery('⌘⇧')).toEqual({ mods: ['cmd', 'shift'], key: null });
    expect(parseKeyQuery('⇧↩')).toEqual({ mods: ['shift'], key: 'enter' });
    expect(parseKeyQuery('esc')).toEqual({ mods: [], key: 'escape' });
    expect(parseKeyQuery('F2')).toEqual({ mods: [], key: 'f2' });
  });

  it('leaves words to the word filter', () => {
    expect(parseKeyQuery('terminal')).toBeNull();
    expect(parseKeyQuery('j')).toBeNull();
    expect(parseKeyQuery('up')).toBeNull();
    expect(parseKeyQuery('stop claude')).toBeNull();
  });

  it('matches the exact combo when a key is given, every combo with the modifiers when not', () => {
    const layout = sheetLayout({ ctx: SESSION, mode: 'all', query: '⌘J', actions: [] });
    expect(rowIds(layout)).toEqual(['terminal.toggle']);
    expect(row(layout, 'terminal.toggle')!.marks.keys).toEqual([0]);
    const both = rowIds(sheetLayout({ ctx: SESSION, mode: 'all', query: '⌘⇧', actions: [] }));
    expect(both).toContain('terminal.maximize');
    expect(both).toContain('palette.commands');
    expect(both).not.toContain('terminal.toggle');
    expect(rowIds(sheetLayout({ ctx: SESSION, mode: 'all', query: 'ctrl c', actions: [] }))).toEqual(['terminal.stop-action']);
    // Clicks and ranges are keys too.
    expect(rowIds(sheetLayout({ ctx: HOME, mode: 'all', query: '⌥', actions: [] }))).toContain('sidebar.open-beside');
    expect(row(sheetLayout({ ctx: SESSION, mode: 'all', query: '⌘3', actions: [] }), 'new-session.pick')).toBeDefined();
  });
});

describe('typing a combo into the filter', () => {
  it('types combos with ⌘, ⌃ or ⌥ instead of running them', () => {
    expect(typedCombo(press('j', { metaKey: true }))).toBe('⌘J');
    expect(typedCombo(press('J', { metaKey: true, shiftKey: true }))).toBe('⌘⇧J');
    expect(typedCombo(press('c', { ctrlKey: true }))).toBe('⌃C');
    expect(typedCombo(press('π', { altKey: true, code: 'KeyP' }))).toBe('⌥P');
  });

  it('lets ⌘/, Escape, plain typing and text editing through', () => {
    expect(typedCombo(press('/', { metaKey: true }))).toBeNull();
    expect(typedCombo(press('Escape'))).toBeNull();
    expect(typedCombo(press('j'))).toBeNull();
    expect(typedCombo(press('J', { shiftKey: true }))).toBeNull();
    for (const key of ['a', 'c', 'v', 'x', 'z']) expect(typedCombo(press(key, { metaKey: true })), key).toBeNull();
    expect(typedCombo(press('ArrowLeft', { altKey: true }))).toBeNull();
    expect(typedCombo(press('Backspace', { metaKey: true }))).toBeNull();
    expect(typedCombo(press('Meta', { metaKey: true }))).toBeNull();
  });

  it('finds the shortcut for what was typed', () => {
    const typed = typedCombo(press('d', { metaKey: true, shiftKey: true }))!;
    expect(rowIds(sheetLayout({ ctx: SESSION, mode: 'all', query: typed, actions: [] }))).toEqual(['changes.toggle']);
  });
});

describe('filtering by word', () => {
  it('keeps rows whose action, context or section has every word, and highlights it', () => {
    const layout = sheetLayout({ ctx: HOME, mode: 'all', query: 'terminal', actions: [] });
    const rows = layout.columns.flat().flatMap((s) => s.rows);
    expect(rows.length).toBeGreaterThan(3);
    for (const r of rows) expect(`${r.action} ${r.context ?? ''}`.toLowerCase(), r.id).toContain('terminal');
    expect(rowIds(layout)).toContain('palette.commands');
    expect(rowIds(layout)).not.toContain('session.new');
    expect(row(layout, 'terminal.toggle')!.marks.action).toEqual([17, 18, 19, 20, 21, 22, 23, 24]);
    expect(row(layout, 'palette.commands')!.marks.context).toEqual([7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it('is case-insensitive and takes words in any order', () => {
    expect(rowIds(sheetLayout({ ctx: HOME, mode: 'all', query: 'CLAUDE stop', actions: [] }))).toEqual(['claude.stop']);
  });

  it('matches a whole section by its name', () => {
    expect(rowIds(sheetLayout({ ctx: HOME, mode: 'all', query: 'permissions', actions: [] }))).toEqual(['permission.allow', 'permission.deny', 'permission.pick']);
  });

  it('finds letters in order from the start of a word', () => {
    expect(matchRow('nses', { action: 'New session', keys: [] }, 'General')).not.toBeNull();
    expect(matchRow('ession', { action: 'New session', keys: [] }, 'General')).not.toBeNull();
    expect(matchRow('ewss', { action: 'New session', keys: [] }, 'General')).toBeNull();
  });

  it('shows New session and Settings only when a filter finds them', () => {
    expect(sections(sheetLayout({ ctx: HOME, mode: 'all', query: '', actions: [] })).flat()).not.toContain('new-session');
    expect(sections(sheetLayout({ ctx: HOME, mode: 'all', query: 'close settings', actions: [] })).flat()).toEqual(['settings']);
  });

  it('shows nothing when nothing matches', () => {
    expect(sheetLayout({ ctx: HOME, mode: 'all', query: 'qqqq', actions: [] }).count).toBe(0);
  });
});

describe('All and Here', () => {
  it('All shows everything in fixed columns, faded where it does not work', () => {
    const layout = sheetLayout({ ctx: HOME, mode: 'all', query: '', actions: [] });
    expect(sections(layout)).toEqual([
      ['general', 'sessions'],
      ['session', 'composer', 'permissions', 'catch-up', 'actions'],
    ]);
    expect(row(layout, 'claude.stop')!.available).toBe(false);
    expect(row(layout, 'session.new')!.available).toBe(true);
  });

  it('Here hides what does not work, and leads with the section for the view', () => {
    const home = sheetLayout({ ctx: HOME, mode: 'here', query: '', actions: [] });
    expect(rowIds(home)).not.toContain('claude.stop');
    expect(sections(home).flat()[0]).toBe('general');
    expect(sections(home).flat()).not.toContain('composer');

    const running = { ...SESSION, running: true };
    const session = sheetLayout({ ctx: running, mode: 'here', query: '', actions: [] });
    expect(sections(session)[0]![0]).toBe('session');
    expect(rowIds(session)).toContain('claude.stop');

    expect(sections(sheetLayout({ ctx: { ...HOME, view: 'new-session' }, mode: 'here', query: '', actions: [] }))[0]![0]).toBe('new-session');
    expect(sections(sheetLayout({ ctx: { ...HOME, view: 'settings' }, mode: 'here', query: '', actions: [] }))[0]![0]).toBe('settings');
    expect(sectionForView('projects')).toBe('general');
  });

  it('Here spreads the sections over both columns', () => {
    const [left, right] = sheetLayout({ ctx: { ...SESSION, running: true, pending: 'question' }, mode: 'here', query: '', actions: [] }).columns;
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
  });
});

describe('project actions', () => {
  const actions: SheetAction[] = [
    { id: 'test', name: 'Run tests', shortcut: 'ctrl+t', scope: 'project' },
    { id: 'dev', name: 'Dev server', shortcut: 'cmd+shift+1', scope: 'global' },
    { id: 'lint', name: 'Lint', shortcut: null, scope: 'shared' },
  ];

  it('lists the actions with a shortcut, and where they come from', () => {
    const rows = actionRows(actions, SESSION);
    expect(rows.map((r) => [r.id, r.context, r.available])).toEqual([
      ['action:test', undefined, true],
      ['action:dev', 'Global, in every project', true],
    ]);
  });

  it('leaves ⌃ and ⌥ action keys to the shell in the terminal', () => {
    const rows = actionRows(actions, { ...SESSION, focus: 'terminal' });
    expect(rows.map((r) => r.available)).toEqual([false, true]);
    expect(actionRows(actions, HOME).every((r) => !r.available)).toBe(true);
  });

  it('keeps an empty Project actions section unfiltered, so it can offer to add one', () => {
    expect(sections(sheetLayout({ ctx: SESSION, mode: 'here', query: '', actions: [] })).flat()).toContain('actions');
    expect(sections(sheetLayout({ ctx: HOME, mode: 'here', query: '', actions: [] })).flat()).not.toContain('actions');
    expect(sections(sheetLayout({ ctx: SESSION, mode: 'all', query: 'find', actions: [] })).flat()).not.toContain('actions');
    expect(rowIds(sheetLayout({ ctx: SESSION, mode: 'all', query: 'tests', actions }))).toEqual(['action:test']);
  });
});
