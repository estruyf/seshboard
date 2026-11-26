/**
 * Pure pieces of the file editor (Monaco): its theme from the app's tokens and Shiki's colours, and which of Monaco's
 * keys give way to the app's shortcuts. Nothing here imports Monaco, so the tests run without a DOM.
 */

/** The app tokens the editor's theme reads, as `#rrggbb` or `#rrggbbaa`. */
export interface EditorTokens {
  code: string;
  text: string;
  muted: string;
  faint: string;
  border: string;
  accent: string;
  accentInk: string;
  popover: string;
  overlayBorder: string;
  fieldBorder: string;
  focusRing: string;
  error: string;
  warn: string;
  diffAdded: string;
}

/** The CSS variable of each token. */
export const TOKEN_VARS: Record<keyof EditorTokens, string> = {
  code: '--sb-code-bg',
  text: '--sb-text',
  muted: '--sb-muted',
  faint: '--sb-faint',
  border: '--sb-border',
  accent: '--sb-accent',
  accentInk: '--sb-accent-ink',
  popover: '--sb-popover',
  overlayBorder: '--sb-overlay-border',
  fieldBorder: '--sb-field-border',
  focusRing: '--sb-focus-ring',
  error: '--sb-error',
  warn: '--sb-warn',
  diffAdded: '--sb-diff-added',
};

/** `#rrggbb` with an alpha from 0 to 1 added (replacing one it had). */
export function withAlpha(hex: string, alpha: number): string {
  const base = hex.slice(0, 7);
  return `${base}${Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

/** The token Monaco gets for a colour and Shiki's font style bits (1 italic, 2 bold, 4 underline, 8 strikethrough). */
export const tokenName = (hex: string, fontStyle: number) => `x${hex.replace('#', '').toLowerCase()}${fontStyle > 0 ? `-${fontStyle}` : ''}`;

const FONT_STYLES: Array<[number, string]> = [
  [1, 'italic'],
  [2, 'bold'],
  [4, 'underline'],
  [8, 'strikethrough'],
];
const fontStyleText = (bits: number) =>
  FONT_STYLES.filter(([bit]) => bits & bit)
    .map(([, name]) => name)
    .join(' ');

/** The shape of `monaco.editor.IStandaloneThemeData`, without importing Monaco. */
export interface EditorThemeData {
  base: 'vs' | 'vs-dark';
  inherit: boolean;
  rules: Array<{ token: string; foreground?: string; fontStyle?: string }>;
  colors: Record<string, string>;
}

/**
 * Monaco's theme: the editor's surfaces from the app's tokens (so it sits on the code background like the source view),
 * and a rule for every colour of the Shiki theme's colour map in every font style, named by `tokenName`. The tokens
 * provider hands Monaco those names, so the colours are exactly Shiki's, whatever scopes the theme uses.
 */
export function editorTheme(tokens: EditorTokens, colorMap: readonly string[], dark: boolean): EditorThemeData {
  const rules: EditorThemeData['rules'] = [{ token: '', foreground: tokens.text.slice(1, 7) }];
  for (const color of colorMap) {
    if (!color) continue;
    const hex = color.replace('#', '').slice(0, 6).toLowerCase();
    for (let bits = 0; bits < 16; bits++) rules.push({ token: tokenName(hex, bits), foreground: hex, ...(bits ? { fontStyle: fontStyleText(bits) } : {}) });
  }
  return {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules,
    colors: {
      'editor.background': tokens.code,
      'editor.foreground': tokens.text,
      'editorGutter.background': tokens.code,
      'editorLineNumber.foreground': tokens.faint,
      'editorLineNumber.activeForeground': tokens.text,
      'editorCursor.foreground': tokens.accentInk,
      'editor.lineHighlightBackground': withAlpha(tokens.text, 0.05),
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': withAlpha(tokens.accent, dark ? 0.28 : 0.4),
      'editor.inactiveSelectionBackground': withAlpha(tokens.accent, 0.18),
      'editor.selectionHighlightBackground': withAlpha(tokens.accent, 0.15),
      'editor.findMatchBackground': withAlpha(tokens.accent, 0.6),
      'editor.findMatchHighlightBackground': withAlpha(tokens.accent, 0.28),
      'editor.wordHighlightBackground': withAlpha(tokens.text, 0.08),
      'editorBracketMatch.background': withAlpha(tokens.accent, 0.2),
      'editorBracketMatch.border': withAlpha(tokens.accentInk, 0.6),
      'editorIndentGuide.background1': withAlpha(tokens.border, 0.8),
      'editorIndentGuide.activeBackground1': tokens.faint,
      'editorWhitespace.foreground': withAlpha(tokens.faint, 0.5),
      'editorWidget.background': tokens.popover,
      'editorWidget.foreground': tokens.text,
      'editorWidget.border': tokens.overlayBorder,
      'editorHoverWidget.background': tokens.popover,
      'editorHoverWidget.border': tokens.overlayBorder,
      'editorSuggestWidget.background': tokens.popover,
      'editorSuggestWidget.border': tokens.overlayBorder,
      'editorSuggestWidget.selectedBackground': withAlpha(tokens.text, 0.1),
      'editorError.foreground': tokens.error,
      'editorWarning.foreground': tokens.warn,
      'input.background': tokens.popover,
      'input.foreground': tokens.text,
      'input.border': tokens.fieldBorder,
      'inputOption.activeBorder': tokens.accentInk,
      focusBorder: tokens.focusRing,
      'scrollbarSlider.background': withAlpha(tokens.text, 0.16),
      'scrollbarSlider.hoverBackground': withAlpha(tokens.text, 0.26),
      'scrollbarSlider.activeBackground': withAlpha(tokens.text, 0.34),
      'scrollbar.shadow': '#00000000',
      'widget.shadow': withAlpha('#000000', dark ? 0.4 : 0.15),
    },
  };
}

/** A key as Monaco's `getUserSettingsLabel` writes it on this platform (`cmd+k`, `shift+alt+down`), modifiers sorted. */
function normalizeChord(chord: string, mac: boolean): string {
  const parts = chord.toLowerCase().split('+');
  // `cmd++` (the plus key) splits into an empty last part.
  const key = parts.at(-1) === '' ? '+' : parts.at(-1)!;
  const mods = new Set(
    parts.slice(0, -1).flatMap((m) => {
      if (m === 'mod') return [mac ? 'cmd' : 'ctrl'];
      if (m === 'meta' || m === 'win' || m === 'super') return [mac ? 'cmd' : 'meta'];
      if (m === 'option') return ['alt'];
      return m ? [m] : [];
    }),
  );
  const named = key.replace(/^arrow/, '').replace(/^esc$/, 'escape').replace(/^plus$/, '=');
  return [...['ctrl', 'shift', 'alt', 'cmd', 'meta'].filter((m) => mods.has(m)), named].join('+');
}

/** Shortcuts of other views or of a focus the editor never has: they can't clash with it. */
const ELSEWHERE = /^(quickstart|browser|usage|home|projects|menubar|new-session|settings\.|memory|pr\.|read\.|transcript|catchup|sidebar\.|queue|upnext|composer|permission\.pick)/;

/**
 * The first keys of the app's shortcuts that must still work while the editor has focus: the ones with ⌘ or Ctrl (or
 * a function key) that work anywhere in a session, not those of another view or of a focus of their own (`where`).
 */
export function appEditorKeys(shortcuts: ReadonlyArray<{ id: string; keys: readonly string[]; where?: string }>, mac: boolean): Set<string> {
  const keys = new Set<string>();
  for (const shortcut of shortcuts) {
    if (shortcut.where || ELSEWHERE.test(shortcut.id)) continue;
    for (const stored of shortcut.keys) {
      const first = stored.split(' ')[0]!;
      if (first.includes('click')) continue;
      const range = /^(.*\+)?(\d)\.\.(\d)$/.exec(first);
      const chords = range ? Array.from({ length: Number(range[3]) - Number(range[2]) + 1 }, (_, i) => `${range[1] ?? ''}${Number(range[2]) + i}`) : [first];
      for (const chord of chords) {
        const normalized = normalizeChord(chord, mac);
        if (/(^|\+)(cmd|ctrl)\+/.test(normalized) || /(^|\+)f\d+$/.test(normalized)) keys.add(normalized);
      }
    }
  }
  return keys;
}

/**
 * The ids of the app's shortcuts that win over Monaco while the editor has focus (see `appEditorKeys`), leaving out any
 * that uses one of `keep`: editing keys the editor holds on to (⌘F finds in the editor, ⌘Z undoes there).
 */
export function appEditorShortcuts(shortcuts: ReadonlyArray<{ id: string; keys: readonly string[]; where?: string }>, mac: boolean, keep: ReadonlySet<string>): string[] {
  return shortcuts.flatMap((shortcut) => {
    const keys = appEditorKeys([shortcut], mac);
    return keys.size > 0 && ![...keys].some((k) => keep.has(k)) ? [shortcut.id] : [];
  });
}

/**
 * Monaco's keybindings that clash with the app's (for the smoke test's report), so the app's shortcut runs instead: every one whose first chord is one of the
 * app's keys, except the editing keys an editor must keep (`keep`, such as find, select all and undo). A chord that
 * starts with ⌘K is caught on its first key, so ⌘K ⌘C goes too while the palette has ⌘K.
 */
export function clashingBindings(bindings: ReadonlyArray<{ command: string; label: string }>, appKeys: ReadonlySet<string>, keep: ReadonlySet<string>, mac: boolean): Array<{ command: string; label: string }> {
  return bindings.filter(({ label }) => {
    const first = normalizeChord(label.split(' ')[0]!, mac);
    return appKeys.has(first) && !keep.has(first);
  });
}
