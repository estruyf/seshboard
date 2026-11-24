import type { ColorScheme, Preferences } from '@seshboard/protocol/bridge';
import { DEFAULT_THEME_ID, type ThemeMode } from '@seshboard/protocol/theme-format';

/** The built-in theme in greys (`apps/ui/src/themes/black-and-white.json`). */
export const BLACK_AND_WHITE = 'black-and-white';

/**
 * The three cards at the top of Settings › Theme: Seshboard (the colour themes, picked from the grid under it), and
 * Black and white in dark or in light.
 */
export type AppearanceChoice = 'seshboard' | 'bw-dark' | 'bw-light';

/** Which card is picked: Black and white in the mode on screen, or Seshboard for any other theme. */
export function appearanceChoice(themeId: string, mode: ThemeMode): AppearanceChoice {
  if (themeId !== BLACK_AND_WHITE) return 'seshboard';
  return mode === 'dark' ? 'bw-dark' : 'bw-light';
}

/**
 * What picking a card changes. Seshboard goes back to the last colour theme (Demo Time without one); the Black and
 * white cards pick the theme and its mode.
 */
export function appearancePatch(choice: AppearanceChoice, prefs: Pick<Preferences, 'colorThemeId'>): { themeId: string; colorScheme?: ColorScheme } {
  if (choice === 'seshboard') return { themeId: prefs.colorThemeId && prefs.colorThemeId !== BLACK_AND_WHITE ? prefs.colorThemeId : DEFAULT_THEME_ID };
  return { themeId: BLACK_AND_WHITE, colorScheme: choice === 'bw-dark' ? 'dark' : 'light' };
}
