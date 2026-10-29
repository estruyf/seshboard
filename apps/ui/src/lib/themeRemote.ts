import { isColor } from '@seshboard/protocol/color';
import { THEME_NAME_MAX, type ThemeTokens } from '@seshboard/protocol/theme-format';
import type { RemoteTheme } from '@seshboard/protocol/client';
import type { ResolvedTheme } from './themeResolve.ts';

/** Only valid colours: the engine refuses the whole theme over one bad value. */
const colors = (tokens: ThemeTokens) => Object.fromEntries(Object.entries(tokens).filter(([, value]) => isColor(value)));

/** The theme in use as paired phones get it (`remote.setTheme`): its name and every token of both modes. */
export const remoteTheme = (name: string, resolved: ResolvedTheme): RemoteTheme => ({ name: name.slice(0, THEME_NAME_MAX), light: colors(resolved.light.tokens), dark: colors(resolved.dark.tokens) });
