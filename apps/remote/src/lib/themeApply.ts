import type { RemoteTheme } from '@switchboard/protocol/remote-client';
import { cleanTheme, themeVars, type ThemeMode } from './theme.ts';

/**
 * Puts a computer's theme on the page, and keeps what Theme needs in localStorage (not secret): which computer's theme
 * to show, each computer's last theme (so it shows while that computer is offline) and the one on screen (so the
 * next launch paints with it before anything connects). The CSP allows no `<style>` of our own, so the values go on
 * `<html>`'s style, for the mode the phone is in, again when that mode changes.
 */

const CHOICE = 'switchboard-remote:theme-from';
const THEMES = 'switchboard-remote:theme';
const SHOWN = 'switchboard-remote:theme-shown';

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
const modeNow = (): ThemeMode => (dark?.matches ? 'dark' : 'light');
let shown: RemoteTheme | null = null;
let set: string[] = [];
/** The theme-color tags' own values (index.html), for when no theme is shown. */
const ownBars = new Map<HTMLMetaElement, string>();

function paint(): void {
  const root = document.documentElement.style;
  for (const name of set) root.removeProperty(name);
  const vars = shown ? themeVars(shown, modeNow()) : {};
  for (const [name, value] of Object.entries(vars)) root.setProperty(name, value);
  set = Object.keys(vars);
  // The status bar on iOS and the toolbar on Android take the theme's background, per mode as in index.html.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    if (!ownBars.has(meta)) ownBars.set(meta, meta.content);
    const mode: ThemeMode = meta.media.includes('dark') ? 'dark' : 'light';
    meta.content = (shown && themeVars(shown, mode)['--sb-bg']) || ownBars.get(meta)!;
  }
}

dark?.addEventListener('change', paint);

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
  if (shown) paint();
}
