import { contrast, fromOklch, luminance, parseColor, toHex, toOklch } from '@seshboard/protocol/color';

/**
 * Mods write Ink colours. Named ones become theme tokens, so a mod looks native in every theme without knowing about
 * them; hex and rgb() values are kept but lifted until they read on the frame. Pure, so it can be tested.
 */

/** The theme tokens Ink's names map to. Blue and cyan are the info colour, which the app draws with `link`. */
export type ModToken = 'error' | 'ok' | 'caution' | 'link' | 'remote' | 'muted' | 'text';

const NAMED: Record<string, ModToken> = {
  red: 'error',
  green: 'ok',
  yellow: 'caution',
  blue: 'link',
  cyan: 'link',
  magenta: 'remote',
  gray: 'muted',
  grey: 'muted',
  dim: 'muted',
  black: 'muted',
  white: 'text',
};

/** The token for an Ink colour name (`red`, `redBright`, `blueBright`…), or null when it isn't one. */
export function modToken(name: string): ModToken | null {
  const base = name.replace(/Bright$/, '').toLowerCase();
  return NAMED[base] ?? null;
}

/** The contrast every lifted colour reaches on its background (WCAG AA for text). */
export const MIN_CONTRAST = 4.5;

/**
 * `color` changed only in lightness (hue and chroma kept) until it has `min` contrast on `background`: lighter on a
 * dark background, darker on a light one. Already readable colours come back as they were (as `#rrggbb`).
 */
export function liftContrast(color: string, background: string, min = MIN_CONTRAST): string | null {
  const fg = parseColor(color);
  const bg = parseColor(background);
  if (!fg) return null;
  const opaque = { ...fg, a: 1 };
  if (!bg || contrast(opaque, bg) >= min) return toHex(opaque);
  const lighter = luminance(bg) < 0.18;
  const start = toOklch(opaque);
  // Step towards white or black; 50 steps of 0.02 always reach one end, which has enough contrast on any background
  // that needs lifting.
  for (let i = 1; i <= 50; i++) {
    const l = Math.min(1, Math.max(0, start.l + (lighter ? 0.02 : -0.02) * i));
    const next = fromOklch({ ...start, l });
    if (contrast(next, bg) >= min) return toHex(next);
  }
  return lighter ? '#ffffff' : '#000000';
}

/** How a mod's colour is drawn: a theme token, or a lifted hex value. Null: keep the inherited colour. */
export type ModColor = { token: ModToken } | { hex: string };

export function resolveModColor(color: unknown, background: string): ModColor | null {
  if (typeof color !== 'string' || !color.trim()) return null;
  const token = modToken(color.trim());
  if (token) return { token };
  // Only plain colour values: no `var()`, `url()` or anything else can reach a style.
  const hex = liftContrast(color.trim(), background);
  return hex ? { hex } : null;
}

/** A background colour a mod gave: tokens as their tint, hex values kept (text on it is lifted against it). */
export function resolveModBackground(color: unknown): ModColor | null {
  if (typeof color !== 'string' || !color.trim()) return null;
  const token = modToken(color.trim());
  if (token) return { token };
  const parsed = parseColor(color.trim());
  return parsed ? { hex: toHex({ ...parsed, a: 1 }) } : null;
}

/** The CSS value for a resolved colour. */
export function cssColor(color: ModColor): string {
  return 'token' in color ? `var(--sb-${color.token})` : color.hex;
}
