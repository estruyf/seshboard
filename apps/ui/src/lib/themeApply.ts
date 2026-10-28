import { themeCss } from './themeCss.ts';
import type { ResolvedTheme } from './themeResolve.ts';

const STYLE_ID = 'seshboard-theme';

/**
 * Puts a theme's tokens on the page: one generated <style> element, last in <head>, so it wins over
 * styles.css (which keeps Demo Time's values for the moment before it exists). Its values are validated
 * colours only (see themeCss), so a theme file can never add CSS of its own.
 */
export function applyTheme(theme: ResolvedTheme): void {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
  }
  style.textContent = themeCss(theme);
  // Appended again on every change, so it stays after any style sheet Vite injects later.
  document.head.appendChild(style);
}
