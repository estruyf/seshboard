/**
 * The theme file format, as plain TypeScript (no zod) so the renderer can use it: token names, the
 * Shiki themes a theme may name for code, and the shape of a validated file. The zod schema that
 * checks files is in `theme.ts`; it is built from the lists here.
 */

/**
 * Every colour a theme sets, by its `--sb-*` name without the prefix (see docs/themes.md for where each
 * one shows). Demo Time sets all of them; any other theme can leave most to generation.
 */
export const THEME_TOKENS = [
  'bg',
  'sidebar',
  'card',
  'popover',
  'code-bg',
  'border',
  'overlay-border',
  'overlay-shadow',
  'text',
  'muted',
  'faint',
  'link',
  'selected',
  'focus-ring',
  'scrim',
  'ok',
  'warn',
  'error',
  'caution',
  'unread',
  'memory',
  'accent',
  'accent-ink',
  'on-accent',
  'diff-added',
  'diff-removed',
  'terminal-bg',
  'terminal-shadow',
  'profile-yellow',
  'profile-blue',
  'profile-green',
  'profile-purple',
  'profile-red',
  'profile-orange',
  'profile-gray',
  'chart-output',
  'chart-cache-write',
  'chart-cache-read',
  'chart-input',
] as const;
export type ThemeToken = (typeof THEME_TOKENS)[number];
/** A full set of tokens for one mode. */
export type ThemeTokens = Record<ThemeToken, string>;

export const THEME_MODES = ['light', 'dark'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** The theme file format this build reads and writes (`version` in the file). */
export const THEME_FORMAT = 1;
/** Where `$schema` points; the file is docs/switchboard-theme.schema.json in the repository. */
export const THEME_SCHEMA_URL = 'https://raw.githubusercontent.com/estruyf/switchboard/main/docs/switchboard-theme.schema.json';
export const THEME_NAME_MAX = 48;
/** The built-in theme every other one falls back to for a mode it doesn't have. */
export const DEFAULT_THEME_ID = 'demo-time';

/**
 * Shiki's bundled themes a theme may name for its code colours, loaded on demand. A fixed list rather
 * than all of Shiki's, so the app only ships what it can load (see `SYNTAX_THEMES` in highlight.ts).
 */
export const SHIKI_THEMES = [
  'andromeeda',
  'aurora-x',
  'ayu-dark',
  'ayu-light',
  'ayu-mirage',
  'catppuccin-frappe',
  'catppuccin-latte',
  'catppuccin-macchiato',
  'catppuccin-mocha',
  'dark-plus',
  'dracula',
  'dracula-soft',
  'everforest-dark',
  'everforest-light',
  'github-dark',
  'github-dark-default',
  'github-dark-dimmed',
  'github-dark-high-contrast',
  'github-light',
  'github-light-default',
  'github-light-high-contrast',
  'gruvbox-dark-hard',
  'gruvbox-dark-medium',
  'gruvbox-dark-soft',
  'gruvbox-light-hard',
  'gruvbox-light-medium',
  'gruvbox-light-soft',
  'houston',
  'kanagawa-dragon',
  'kanagawa-lotus',
  'kanagawa-wave',
  'light-plus',
  'material-theme',
  'material-theme-darker',
  'material-theme-lighter',
  'material-theme-ocean',
  'material-theme-palenight',
  'min-dark',
  'min-light',
  'monokai',
  'night-owl',
  'night-owl-light',
  'nord',
  'one-dark-pro',
  'one-light',
  'poimandres',
  'rose-pine',
  'rose-pine-dawn',
  'rose-pine-moon',
  'slack-dark',
  'slack-ochin',
  'snazzy-light',
  'solarized-dark',
  'solarized-light',
  'synthwave-84',
  'tokyo-night',
  'vesper',
  'vitesse-black',
  'vitesse-dark',
  'vitesse-light',
] as const;
export type ShikiThemeName = (typeof SHIKI_THEMES)[number];

/** The font styles an inline syntax theme may use. */
export const FONT_STYLES = ['italic', 'bold', 'underline'] as const;

/** One rule of an inline TextMate theme: only these fields are read. */
export interface SyntaxRule {
  scope?: string | string[];
  settings: { foreground?: string; fontStyle?: string };
}

/** An inline TextMate theme: `name`, `type` and `tokenColors` only (no editor colours). */
export interface InlineSyntaxTheme {
  name?: string;
  type?: ThemeMode;
  tokenColors: SyntaxRule[];
}

export type ThemeSyntax = ShikiThemeName | InlineSyntaxTheme;

/** The terminal's colours (only read from `dark`: the terminal panel is always dark). */
export interface ThemeTerminal {
  background?: string;
  foreground?: string;
  cursor?: string;
  selection?: string;
  /** Exactly 16: black, red, green, yellow, blue, magenta, cyan, white, then the bright versions. */
  ansi?: string[];
}

/** One mode of a theme. `canvas` and `accent` are shortcuts every missing token is generated from. */
export interface ThemeModeFile {
  canvas?: string;
  accent?: string;
  colors?: Partial<ThemeTokens>;
  terminal?: ThemeTerminal;
  syntax?: ThemeSyntax;
}

/** A validated theme file (unknown keys dropped). */
export interface ThemeFile {
  $schema?: string;
  name: string;
  author?: string;
  version: number;
  light?: ThemeModeFile;
  dark?: ThemeModeFile;
}

/** A theme as main keeps it: built in (shipped with the app) or imported (a file in the themes folder). */
export interface ThemeEntry {
  /** `demo-time`, `github`… for the built-ins; the file name without `.json` for imported ones. */
  id: string;
  builtIn: boolean;
  file: ThemeFile;
  /** The file in the themes folder; null for the built-ins. */
  path: string | null;
}

/** All themes, in picker order (built-ins first), plus what went wrong reloading an edited one. */
export interface ThemeState {
  themes: ThemeEntry[];
  /** The last edit of a theme's file that couldn't be read, by theme id: its last good version stays in use. */
  problems: Record<string, string>;
}

/** What main found in a file someone wants to import. */
export type ThemeFileCheck =
  | { ok: true; theme: ThemeFile; ignored: string[]; fileName: string; raw: unknown }
  | { ok: false; error: string; fileName: string };

/** `Solarized Dark` → `solarized-dark` (file names and export names). */
export function themeSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return slug || 'theme';
}

/** `name`, or `name 2`, `name 3`… whichever isn't taken yet (compared without case). */
export function uniqueThemeName(name: string, taken: readonly string[]): string {
  const lower = new Set(taken.map((n) => n.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  const base = name.replace(/ \d+$/, '');
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, THEME_NAME_MAX - String(n).length - 1)} ${n}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}
