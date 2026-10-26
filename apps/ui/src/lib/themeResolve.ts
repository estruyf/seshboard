import { parseColor, toHex } from '@seshboard/protocol/color';
import { THEME_MODES, THEME_SCHEMA_URL, THEME_TOKENS, type ThemeFile, type ThemeMode, type ThemeModeFile, type ThemeSyntax, type ThemeToken, type ThemeTokens } from '@seshboard/protocol/theme-format';
import demoTime from '../themes/demo-time.json';
import { DERIVED_TOKENS, deriveTokens, generateTokens, withAlpha } from './themeGenerate.ts';

/** Demo Time, the built-in theme a missing mode falls back to. */
export const DEMO_TIME = demoTime as ThemeFile;

/** The tokens of one mode of a theme, and where they came from. */
export interface ResolvedMode {
  tokens: ThemeTokens;
  /** The theme has no such mode: these are Demo Time's. */
  fallback: boolean;
  canvas: string;
  accent: string;
  /** Set by the theme itself (`colors`, plus `bg` from `canvas` and `accent` from `accent`). */
  set: ThemeToken[];
  /** Generated from canvas and accent, or derived from other tokens. */
  generated: ThemeToken[];
  /** The code colours; null for Demo Time's. */
  syntax: ThemeSyntax | null;
}

export interface ResolvedTerminal {
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
  /** 16 colours: black, red, green, yellow, blue, magenta, cyan, white, then the bright ones. */
  ansi: string[];
}

export interface ResolvedTheme {
  light: ResolvedMode;
  dark: ResolvedMode;
  terminal: ResolvedTerminal;
}

/** Every colour as `#rrggbb(aa)`, so values compare and print the same however the file wrote them. */
export const normalizeColor = (value: string) => {
  const color = parseColor(value);
  return color ? toHex(color) : value;
};

/**
 * One mode: generate everything from canvas and accent, apply the theme's own `colors` on top, then work
 * out the tokens that follow from others (selected from text, the focus ring from accent-ink, the diff
 * backgrounds from ok and error) unless the theme sets them. Without canvas and accent, the mode's `bg`
 * and `accent` colours stand in; without those either, Demo Time's.
 */
export function resolveMode(file: ThemeModeFile | undefined, mode: ThemeMode): ResolvedMode {
  if (!file) return { ...resolveMode(DEMO_TIME[mode], mode), fallback: true };
  const demo = DEMO_TIME[mode]!.colors!;
  const colors = Object.fromEntries(Object.entries(file.colors ?? {}).map(([key, value]) => [key, normalizeColor(value)])) as Partial<ThemeTokens>;
  const canvas = normalizeColor(file.canvas ?? colors.bg ?? demo.bg!);
  const accent = normalizeColor(file.accent ?? colors.accent ?? demo.accent!);
  const tokens: ThemeTokens = { ...generateTokens(mode, canvas, accent), ...colors };
  const derived = deriveTokens(mode, tokens);
  for (const token of DERIVED_TOKENS) if (!colors[token]) tokens[token] = derived[token as keyof typeof derived];
  // The terminal's own background is the panel's, unless the theme sets the panel's separately.
  if (mode === 'dark' && !colors['terminal-bg'] && file.terminal?.background) tokens['terminal-bg'] = normalizeColor(file.terminal.background);
  const set = THEME_TOKENS.filter((token) => colors[token] !== undefined || (token === 'bg' && file.canvas) || (token === 'accent' && file.accent));
  return { tokens, fallback: false, canvas, accent, set, generated: THEME_TOKENS.filter((token) => !set.includes(token)), syntax: file.syntax ?? null };
}

/** The terminal: the dark mode's `terminal`, each missing colour from the dark tokens or Demo Time's palette. */
export function resolveTerminal(theme: ThemeFile, dark: ResolvedMode): ResolvedTerminal {
  const own = theme.dark ? theme.dark.terminal : DEMO_TIME.dark!.terminal;
  const demo = DEMO_TIME.dark!.terminal!;
  return {
    background: normalizeColor(own?.background ?? dark.tokens['terminal-bg']),
    foreground: normalizeColor(own?.foreground ?? dark.tokens.text),
    cursor: normalizeColor(own?.cursor ?? dark.tokens['accent-ink']),
    selection: normalizeColor(own?.selection ?? withAlpha(dark.tokens.accent, 0.25)),
    ansi: (own?.ansi ?? demo.ansi!).map(normalizeColor),
  };
}

/** Every token of both modes, with Demo Time for a missing one. */
export function resolveTheme(theme: ThemeFile): ResolvedTheme {
  const light = resolveMode(theme.light, 'light');
  const dark = resolveMode(theme.dark, 'dark');
  return { light, dark, terminal: resolveTerminal(theme, dark) };
}

/** Which modes a theme has: both, or only one (the other is Demo Time's). */
export const themeModes = (theme: ThemeFile): 'both' | ThemeMode => (theme.light && theme.dark ? 'both' : theme.light ? 'light' : 'dark');

/**
 * The file to export: canvas and accent, plus only the colours that differ from what those would
 * generate, so it stays short and keeps following the generator. Demo Time (`full`) writes every token,
 * as a complete starting point. Importing the result gives the same tokens as `theme`.
 */
export function exportThemeFile(theme: ThemeFile, options: { full?: boolean } = {}): ThemeFile {
  const out: ThemeFile = { $schema: THEME_SCHEMA_URL, name: theme.name, ...(theme.author ? { author: theme.author } : {}), version: theme.version };
  for (const mode of THEME_MODES) {
    const file = theme[mode];
    if (!file) continue;
    const resolved = resolveMode(file, mode);
    const colors: Partial<ThemeTokens> = {};
    if (options.full) Object.assign(colors, resolved.tokens);
    else {
      const generated = generateTokens(mode, resolved.canvas, resolved.accent);
      for (const token of THEME_TOKENS) if (!DERIVED_TOKENS.includes(token) && resolved.tokens[token] !== generated[token]) colors[token] = resolved.tokens[token];
      // What follows from other tokens (selected from text…) is written only when the theme changed it.
      const candidate = resolveMode({ ...file, canvas: resolved.canvas, accent: resolved.accent, colors }, mode);
      for (const token of THEME_TOKENS) if (candidate.tokens[token] !== resolved.tokens[token]) colors[token] = resolved.tokens[token];
    }
    const entry: ThemeModeFile = { canvas: resolved.canvas, accent: resolved.accent };
    if (Object.keys(colors).length > 0) entry.colors = Object.fromEntries(THEME_TOKENS.filter((t) => colors[t] !== undefined).map((t) => [t, colors[t]])) as Partial<ThemeTokens>;
    if (mode === 'dark' && file.terminal) entry.terminal = file.terminal;
    if (file.syntax) entry.syntax = file.syntax;
    out[mode] = entry;
  }
  return out;
}
