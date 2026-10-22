import type { RemoteTheme } from '@switchboard/protocol/remote-client';
import { cleanModeChoice, cleanTheme, resolveMode, themeVars, type ModeChoice, type ThemeMode } from './theme.ts';
import { cleanTextSize, type TextSize } from './textSize.ts';

/**
 * Puts a computer's theme on the page, and keeps what Theme needs in localStorage (not secret): which computer's theme
 * to show, each computer's last theme (so it shows while that computer is offline), the one on screen (so the next
 * launch paints with it before anything connects) and Appearance. The CSP allows no `<style>` of our own, so the
 * values go on `<html>`'s style, for the mode shown, again when that mode changes. Appearance set to Light or Dark
 * puts `data-mode` on `<html>`, which styles.css reads for Demo Time.
 */

const CHOICE = 'switchboard-remote:theme-from';
const THEMES = 'switchboard-remote:theme';
const SHOWN = 'switchboard-remote:theme-shown';
const MODE = 'switchboard-remote:mode';
const TEXT_SIZE = 'switchboard-remote:text-size';

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null): void => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private browsing without storage: the theme isn't kept for next time.
  }
};
const parse = (text: string | null): RemoteTheme | null => {
  try {
    return text ? cleanTheme(JSON.parse(text)) : null;
  } catch {
    return null;
  }
};

const listeners = new Set<() => void>();
let choice = read(CHOICE);

/** The computer picked in Theme (`OWN_THEME` for the phone's own look), or null: the first one paired. */
export const themeChoice = (): string | null => choice;

export function subscribeThemeChoice(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function chooseTheme(next: string): void {
  choice = next;
  write(CHOICE, next);
  for (const listener of listeners) listener();
}

/** A computer's last theme, kept on this phone. */
export const cachedTheme = (computer: string): RemoteTheme | null => parse(read(`${THEMES}:${computer}`));

/** Keeps a computer's theme; null forgets it (the computer was forgotten). */
export const cacheTheme = (computer: string, theme: RemoteTheme | null): void => write(`${THEMES}:${computer}`, theme && JSON.stringify(theme));

const dark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
let mode = cleanModeChoice(read(MODE));
const modeListeners = new Set<() => void>();

/** Appearance: Match System, Light or Dark. */
export const modeChoice = (): ModeChoice => mode;

/** The mode the page shows now, for what draws its own colours (Theme's swatches). */
export const modeNow = (): ThemeMode => resolveMode(mode, Boolean(dark?.matches));

/** Called when the mode shown changes: Appearance, or the phone's own while it matches the system. */
export function subscribeMode(listener: () => void): () => void {
  modeListeners.add(listener);
  return () => modeListeners.delete(listener);
}

export function chooseMode(next: ModeChoice): void {
  mode = next;
  write(MODE, next === 'system' ? null : next);
  paint();
  for (const listener of modeListeners) listener();
}

let shown: RemoteTheme | null = null;
let set: string[] = [];
/** The theme-color tags' own values (index.html), for when no theme is shown. */
const ownBars = new Map<HTMLMetaElement, string>();

function paint(): void {
  if (mode === 'system') delete document.documentElement.dataset.mode;
  else document.documentElement.dataset.mode = mode;
  const root = document.documentElement.style;
  for (const name of set) root.removeProperty(name);
  const vars = shown ? themeVars(shown, modeNow()) : {};
  for (const [name, value] of Object.entries(vars)) root.setProperty(name, value);
  set = Object.keys(vars);
  // The status bar on iOS and the toolbar on Android take the theme's background, per mode as in index.html. With
  // Appearance set, both tags say that mode's: the phone's own mode no longer matters.
  const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  for (const meta of metas) if (!ownBars.has(meta)) ownBars.set(meta, meta.content);
  const own = (of: ThemeMode) => [...ownBars].find(([meta]) => meta.media.includes(of))?.[1] ?? '';
  for (const meta of metas) {
    const of: ThemeMode = mode === 'system' ? (meta.media.includes('dark') ? 'dark' : 'light') : mode;
    meta.content = (shown && themeVars(shown, of)['--sb-bg']) || own(of);
  }
}

dark?.addEventListener('change', () => {
  if (mode !== 'system') return;
  paint();
  for (const listener of modeListeners) listener();
});

/** Shows a computer's theme, or the phone's own look (null). */
export function showTheme(theme: RemoteTheme | null): void {
  if (JSON.stringify(theme) === JSON.stringify(shown)) return;
  shown = theme;
  write(SHOWN, theme && JSON.stringify(theme));
  paint();
}

/** At launch: the theme on screen last time, before the computers are read and connected. */
export function showLastTheme(): void {
  shown = parse(read(SHOWN));
  if (shown || mode !== 'system') paint();
}

let textSize = cleanTextSize(read(TEXT_SIZE));
const textSizeListeners = new Set<() => void>();

/** Settings › Appearance › Text size. */
export const textSizeChoice = (): TextSize => textSize;

export function subscribeTextSize(listener: () => void): () => void {
  textSizeListeners.add(listener);
  return () => textSizeListeners.delete(listener);
}

/** `data-text-size` on `<html>`, which styles.css reads to scale the type. */
export function showTextSize(): void {
  if (textSize === 'default') delete document.documentElement.dataset.textSize;
  else document.documentElement.dataset.textSize = textSize;
}

export function chooseTextSize(next: TextSize): void {
  textSize = next;
  write(TEXT_SIZE, next === 'default' ? null : next);
  showTextSize();
  for (const listener of textSizeListeners) listener();
}
