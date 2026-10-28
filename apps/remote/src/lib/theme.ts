import { COLOR_PATTERN, overlayShadow, type RemoteTheme } from '@seshboard/protocol/remote-client';

/**
 * A computer's theme on the phone (docs/remote-access.md, Theme). The computer sends every token of both modes,
 * resolved; the phone takes the ones its styles.css has, and only colours. Pure, with tests.
 */

export type ThemeMode = 'light' | 'dark';

/** The phone's `--sb-*` variables, each with the computer's token it comes from. `edge` is the overlay border, as on the computer. */
export const PHONE_TOKENS: Readonly<Record<string, string>> = {
  bg: 'bg',
  sidebar: 'sidebar',
  card: 'card',
  border: 'border',
  edge: 'overlay-border',
  text: 'text',
  muted: 'muted',
  faint: 'faint',
  accent: 'accent',
  'accent-ink': 'accent-ink',
  'on-accent': 'on-accent',
  link: 'link',
  ok: 'ok',
  warn: 'warn',
  error: 'error',
  unread: 'unread',
  caution: 'caution',
  pipeline: 'pipeline',
  selected: 'selected',
  'code-bg': 'code-bg',
  'diff-added': 'diff-added',
  'diff-removed': 'diff-removed',
  'focus-ring': 'focus-ring',
  popover: 'popover',
  'overlay-border': 'overlay-border',
  'overlay-shadow': 'overlay-shadow',
  'profile-yellow': 'profile-yellow',
  'profile-blue': 'profile-blue',
  'profile-green': 'profile-green',
  'profile-purple': 'profile-purple',
  'profile-red': 'profile-red',
  'profile-orange': 'profile-orange',
  'profile-gray': 'profile-gray',
};

const SOURCES = new Set(Object.values(PHONE_TOKENS));
const colorRe = new RegExp(COLOR_PATTERN);
const isColor = (value: unknown): value is string => typeof value === 'string' && value.length <= 80 && colorRe.test(value.trim());

function cleanMode(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(([token, color]) => SOURCES.has(token) && isColor(color)));
}

/**
 * What the phone keeps of a theme from a computer (or from its own storage): the tokens it uses, each a colour, so
 * nothing else can reach the page's styles. Null for anything that isn't a theme.
 */
export function cleanTheme(value: unknown): RemoteTheme | null {
  const theme = value as Partial<RemoteTheme> | null;
  if (!theme || typeof theme !== 'object' || typeof theme.name !== 'string') return null;
  return { name: theme.name.slice(0, 48), light: cleanMode(theme.light), dark: cleanMode(theme.dark) };
}

/** The `--sb-*` values of a mode of the theme; what it leaves out keeps the phone's own (Demo Time). */
export function themeVars(theme: RemoteTheme, mode: ThemeMode): Record<string, string> {
  const tokens = cleanMode(theme[mode]);
  const vars: Record<string, string> = {};
  for (const [name, source] of Object.entries(PHONE_TOKENS)) {
    const value = tokens[source];
    if (value) vars[`--sb-${name}`] = name === 'overlay-shadow' ? overlayShadow(mode, value) : value;
  }
  return vars;
}

/** Demo Time, the phone's own look: no computer's theme. */
export const OWN_THEME = 'own';

/** Demo Time's background, accent and text (styles.css), for its swatch in Theme while another theme is on the page. */
export const DEMO_TIME_SWATCH: Readonly<Record<ThemeMode, readonly string[]>> = {
  light: ['#ffffff', '#ffd43b', '#202736'],
  dark: ['#15181f', '#ffd43b', '#d9dbe1'],
};

/** A theme's swatch in Theme: its background, accent and text, in a mode. */
export function swatchOf(theme: RemoteTheme | null, mode: ThemeMode): readonly string[] {
  if (!theme) return DEMO_TIME_SWATCH[mode];
  const vars = themeVars(theme, mode);
  return ['--sb-bg', '--sb-accent', '--sb-text'].map((name, i) => vars[name] ?? DEMO_TIME_SWATCH[mode][i]!);
}

/**
 * Whose theme the phone shows: the computer picked in Theme, else the first one that sent a theme (the only one, for
 * most people). Not simply the first one paired: a pairing that never connects again (a computer reset, an old
 * address) would keep the phone in Demo Time and deaf to the theme of the computer in use. A computer that was
 * forgotten falls back the same way; `own` is the phone's own look.
 */
export function themeComputer(choice: string | null, computers: readonly { id: string; theme: RemoteTheme | null }[]): string | null {
  if (choice === OWN_THEME) return null;
  if (choice && computers.some((c) => c.id === choice)) return choice;
  return (computers.find((c) => c.theme) ?? computers[0])?.id ?? null;
}

/** Appearance in Theme: light or dark as the phone is set, or always one of them. */
export type ModeChoice = 'system' | ThemeMode;

/** Reads a kept Appearance; anything else is Match System. */
export const cleanModeChoice = (value: unknown): ModeChoice => (value === 'light' || value === 'dark' ? value : 'system');

/** The mode the page shows: the one picked in Appearance, else the phone's. */
export const resolveMode = (choice: ModeChoice, systemDark: boolean): ThemeMode => (choice === 'system' ? (systemDark ? 'dark' : 'light') : choice);
