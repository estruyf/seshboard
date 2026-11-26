import { describe, expect, it } from 'vitest';
import { appEditorKeys, appEditorShortcuts, clashingBindings, editorTheme, tokenName, withAlpha, type EditorTokens } from './editorModel.ts';

const TOKENS: EditorTokens = {
  code: '#f4f6faff',
  text: '#202736ff',
  muted: '#505869ff',
  faint: '#687082ff',
  border: '#e1e4e8ff',
  accent: '#ffd43bff',
  accentInk: '#916c00ff',
  popover: '#ffffffff',
  overlayBorder: '#d1d5daff',
  fieldBorder: '#8b8e95ff',
  focusRing: '#916c008c',
  error: '#d73a49ff',
  warn: '#d1186bff',
  diffAdded: '#00806f1f',
};

describe('editorTheme', () => {
  it("puts the editor on the app's code background, with a rule for every colour and font style", () => {
    const theme = editorTheme(TOKENS, ['', '#202736', '#D73A49'], false);
    expect(theme.base).toBe('vs');
    expect(theme.colors['editor.background']).toBe('#f4f6faff');
    expect(theme.rules).toContainEqual({ token: tokenName('d73a49', 0), foreground: 'd73a49' });
    expect(theme.rules).toContainEqual({ token: tokenName('d73a49', 3), foreground: 'd73a49', fontStyle: 'italic bold' });
    expect(theme.rules.filter((r) => r.token.startsWith('x'))).toHaveLength(2 * 16);
    expect(editorTheme(TOKENS, [], true).base).toBe('vs-dark');
  });

  it('writes an alpha over the one a colour had', () => {
    expect(withAlpha('#ffd43bff', 0.5)).toBe('#ffd43b80');
    expect(withAlpha('#000000', 0)).toBe('#00000000');
  });
});

describe('app keys in the editor', () => {
  const shortcuts = [
    { id: 'palette.commands', keys: ['mod+k', 'mod+shift+p'] },
    { id: 'find', keys: ['mod+f'] },
    { id: 'files.save', keys: ['mod+s'], where: 'files' },
    { id: 'sidebar.move', keys: ['arrowup, arrowdown'] },
    { id: 'pane.focus-up', keys: ['mod+alt+arrowup'] },
    { id: 'home.pick', keys: ['mod+1..9'] },
    { id: 'context-menu', keys: ['shift+f10'] },
    { id: 'quit', keys: ['mod+q mod+q'] },
  ];

  it("takes the session's shortcuts with ⌘ or a function key, not another view's or another focus's", () => {
    expect([...appEditorKeys(shortcuts, true)].sort()).toEqual(['alt+cmd+up', 'cmd+f', 'cmd+k', 'cmd+q', 'shift+cmd+p', 'shift+f10'].sort());
    expect(appEditorKeys(shortcuts, false).has('ctrl+k')).toBe(true);
  });

  it('leaves the editing keys the editor keeps', () => {
    expect(appEditorShortcuts(shortcuts, true, new Set(['cmd+f']))).toEqual(['palette.commands', 'pane.focus-up', 'context-menu', 'quit']);
  });

  it("finds Monaco's bindings whose first chord is an app key", () => {
    const bindings = [
      { command: 'editor.action.addCommentLine', label: 'cmd+k cmd+c' },
      { command: 'editor.action.insertCursorAbove', label: 'alt+cmd+up' },
      { command: 'actions.find', label: 'cmd+f' },
      { command: 'cursorDown', label: 'down' },
    ];
    expect(clashingBindings(bindings, appEditorKeys(shortcuts, true), new Set(['cmd+f']), true).map((b) => b.command)).toEqual(['editor.action.addCommentLine', 'editor.action.insertCursorAbove']);
  });
});
