import { parseColor, toHex } from './color.ts';

/** `color` with its alpha multiplied by `factor`. */
const fade = (color: string, factor: number) => {
  const rgba = parseColor(color);
  return rgba ? toHex({ ...rgba, a: rgba.a * factor }) : color;
};

/**
 * The shadow under menus and dialogs, built around a theme's one shadow colour: two soft layers in light mode, and in
 * dark mode a hairline and two stronger layers (a dark UI hides soft shadows). With Demo Time's colours these are
 * exactly the layers the app's styles.css has. Shared by the app and the remote app, which builds it from the
 * computer's theme.
 */
export function overlayShadow(mode: 'light' | 'dark', color: string): string {
  return mode === 'light'
    ? `0 2px 6px ${fade(color, 0.4)}, 0 12px 32px -4px ${color}`
    : `0 0 0 1px ${fade(color, 0.5)}, 0 4px 10px ${fade(color, 0.5)}, 0 16px 40px -6px ${color}`;
}
