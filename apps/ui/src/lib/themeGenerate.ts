import { contrast, fromOklch, parseColor, toHex, toOklch, type Oklch, type Rgba } from '@switchboard/protocol/color';
import type { ThemeMode, ThemeToken, ThemeTokens } from '@switchboard/protocol/theme-format';
import demoTime from '../themes/demo-time.json';

/**
 * Generates every token of a mode from two colours, the canvas (the background) and the accent, so a
 * theme can be three lines long. Pure OKLCH maths: surfaces step from the canvas, text is solved
 * against it for contrast, and the status and profile colours keep Demo Time's hues so their
 * meanings stay the same (pink still needs you, blue is still unread). The approach is borrowed from
 * T3 Code's theme generator.
 */

/** Demo Time's own tokens, per mode: the reference hues for status and profile colours. */
export const DEMO_TIME_TOKENS = { light: demoTime.light.colors, dark: demoTime.dark.colors } as Record<ThemeMode, ThemeTokens>;

/** WCAG targets the generator meets against the canvas (and the sidebar and cards on it). */
export const CONTRAST = { text: 4.5, muted: 4.5, faint: 3, accentInk: 4.5, status: 4.5, profile: 3 } as const;

/**
 * Lightness steps from the canvas, measured on Demo Time (OKLCH L). Dark themes step lighter,
 * light themes darker; a light theme's cards and menus are a touch lighter than its canvas, when it isn't white already.
 */
const STEPS = {
  light: { sidebar: -0.027, card: 0.012, popover: 0.012, border: -0.082, overlayBorder: -0.129 },
  dark: { sidebar: 0.064, card: 0.064, popover: 0.109, border: 0.108, overlayBorder: 0.197 },
} as const;

/** Where text sits on Demo Time (OKLCH L), the starting point before solving for contrast. */
const TEXT_L = {
  light: { text: 0.273, muted: 0.46, faint: 0.545 },
  dark: { text: 0.892, muted: 0.718, faint: 0.665 },
} as const;

/** Near-black overlays, at the alphas styles.css uses. */
const SHADES = {
  light: { scrim: '#15181f59', 'overlay-shadow': '#15181f33', 'terminal-shadow': '#15181f29' },
  dark: { scrim: '#00000099', 'overlay-shadow': '#000000b3', 'terminal-shadow': '#0000008c' },
} as const;

/** Alpha of `selected` (a tint of the text colour), as styles.css: 10% light, 11% dark. */
export const SELECTED_ALPHA = { light: 0.1, dark: 0.11 } as const;
const FOCUS_ALPHA = 0.55;
const DIFF_ALPHA = 0.14;

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };
const WHITE: Rgba = { r: 1, g: 1, b: 1, a: 1 };

const read = (value: string): Rgba => parseColor(value) ?? BLACK;
const hex = (color: Oklch, alpha = 1) => toHex(fromOklch(color, alpha));
const clampL = (l: number) => Math.min(1, Math.max(0, l));

/** The worst contrast of `color` against each background. */
const worst = (color: Oklch, against: readonly Rgba[]) => Math.min(...against.map((bg) => contrast(fromOklch(color), bg)));

/**
 * `color` with its lightness moved (away from the backgrounds) just far enough to reach `target`
 * against each of them, keeping hue and chroma. Already enough: unchanged. Unreachable: as far as it goes.
 */
export function solveContrast(color: Oklch, against: readonly Rgba[], target: number, direction: 'darker' | 'lighter'): Oklch {
  if (worst(color, against) >= target) return color;
  const end = direction === 'darker' ? 0 : 1;
  if (worst({ ...color, l: end }, against) < target) return { ...color, l: end };
  let near = color.l;
  let far = end;
  for (let i = 0; i < 30; i++) {
    const mid = (near + far) / 2;
    if (worst({ ...color, l: mid }, against) >= target) far = mid;
    else near = mid;
  }
  return { ...color, l: far };
}

/**
 * `solveContrast` as a hex colour. Rounding to 8 bits can land a hair under the target, so it keeps
 * stepping away from the backgrounds until the hex value itself meets it.
 */
function solvedHex(color: Oklch, against: readonly Rgba[], target: number, direction: 'darker' | 'lighter'): string {
  let solved = solveContrast(color, against, target, direction);
  for (let i = 0; i < 40; i++) {
    const value = hex(solved);
    if (Math.min(...against.map((bg) => contrast(read(value), bg))) >= target || solved.l <= 0 || solved.l >= 1) return value;
    solved = { ...solved, l: clampL(solved.l + (direction === 'darker' ? -0.002 : 0.002)) };
  }
  return hex(solved);
}

/** `value` with an alpha, as `#rrggbbaa`. */
export const withAlpha = (value: string, alpha: number) => toHex({ ...read(value), a: alpha });

/** The tokens derived from others after a theme's own colours are applied (unless the theme sets them). */
export function deriveTokens(mode: ThemeMode, tokens: Pick<ThemeTokens, 'text' | 'accent-ink' | 'ok' | 'error'>): Pick<ThemeTokens, 'selected' | 'focus-ring' | 'diff-added' | 'diff-removed'> {
  return {
    selected: withAlpha(tokens.text, SELECTED_ALPHA[mode]),
    'focus-ring': withAlpha(tokens['accent-ink'], FOCUS_ALPHA),
    'diff-added': withAlpha(tokens.ok, DIFF_ALPHA),
    'diff-removed': withAlpha(tokens.error, DIFF_ALPHA),
  };
}

/** A hue that reads as blue (OKLCH degrees), where an accent can double as link and unread colour. */
const isBlueish = (color: Oklch) => color.c > 0.06 && color.h >= 215 && color.h <= 285;

/** Every token for one mode, from its canvas and accent (any colour format a theme accepts). */
export function generateTokens(mode: ThemeMode, canvas: string, accent: string): ThemeTokens {
  const base = toOklch(read(canvas));
  const acc = toOklch(read(accent));
  const demo = DEMO_TIME_TOKENS[mode];
  // Away from the canvas: darker on a light canvas, lighter on a dark one (whatever the mode says).
  const lightCanvas = contrast(read(canvas), BLACK) >= contrast(read(canvas), WHITE);
  const away = lightCanvas ? 'darker' : 'lighter';
  const sign = mode === 'dark' ? 1 : -1;

  // Greys take the canvas's own hue; a neutral canvas borrows a hint of the accent's.
  const hue = base.c >= 0.012 ? base.h : acc.h;
  const hint = mode === 'dark' ? 0.012 : 0.004;
  const surface = (dl: number, extra = 1): Oklch => ({ l: clampL(base.l + dl), c: Math.min(0.08, base.c + hint * extra), h: hue });
  const steps = STEPS[mode];
  const sidebar = surface(steps.sidebar);
  const card = mode === 'light' ? surface(steps.card, 0.5) : surface(steps.card);
  const popover = mode === 'light' ? surface(steps.popover, 0.5) : surface(steps.popover);
  const surfaces = [read(canvas), fromOklch(sidebar), fromOklch(card)];

  const textC = mode === 'dark' ? Math.min(0.02, base.c + 0.004) : Math.min(0.04, base.c + 0.015);
  const ink = (l: number, target: number) => solvedHex({ l, c: textC, h: hue }, surfaces, target, away);
  const text = ink(TEXT_L[mode].text, CONTRAST.text);
  const muted = ink(TEXT_L[mode].muted, CONTRAST.muted);
  const faint = ink(TEXT_L[mode].faint, CONTRAST.faint);

  // The accent stays as it is for fills; its ink is the same hue, moved until it reads on the canvas.
  // Text is solved against the sidebar and cards too; colours that mark things only against the canvas.
  const canvasOnly = [read(canvas)];
  const accentInk = solvedHex(acc, canvasOnly, CONTRAST.accentInk, away);
  const onAccent = contrast(BLACK, read(accent)) >= contrast(WHITE, read(accent)) ? '#000000' : '#ffffff';

  /** A Demo Time colour for this mode, moved for contrast on this canvas. */
  const keepHue = (value: string, target: number) => solvedHex(toOklch(read(value)), canvasOnly, target, away);
  const blue = isBlueish(acc) ? solvedHex(acc, canvasOnly, CONTRAST.status, away) : keepHue(demo.link, CONTRAST.status);
  const ok = keepHue(demo.ok, CONTRAST.status);
  const error = keepHue(demo.error, CONTRAST.status);

  // The terminal panel is always dark: a little darker than a dark canvas, in the same hue.
  const terminalL = mode === 'dark' ? Math.min(0.18, base.l - 0.036) : 0.173;
  const terminalBg = hex({ l: Math.max(0.08, terminalL), c: Math.min(0.02, base.c + 0.004), h: hue });

  // Reading mode: light themes read on a slightly warm, slightly dimmer lift of the canvas; dark ones on the canvas itself.
  const paperHex = mode === 'dark' ? toHex(read(canvas)) : hex({ l: clampL(base.l - 0.012), c: Math.min(0.03, Math.max(base.c, 0.008)), h: base.c >= 0.012 ? base.h : 90 });
  const paperText = mode === 'dark' ? text : solvedHex(toOklch(read(text)), [read(paperHex)], CONTRAST.text, away);

  const tokens: Omit<ThemeTokens, 'selected' | 'focus-ring' | 'diff-added' | 'diff-removed'> = {
    bg: toHex(read(canvas)),
    sidebar: hex(sidebar),
    card: hex(card),
    popover: hex(popover),
    'code-bg': hex(sidebar),
    border: hex(surface(steps.border, 1.5)),
    'overlay-border': hex(surface(steps.overlayBorder, 2)),
    'overlay-shadow': SHADES[mode]['overlay-shadow'],
    text,
    paper: paperHex,
    'paper-text': paperText,
    muted,
    faint,
    link: blue,
    scrim: SHADES[mode].scrim,
    ok,
    warn: keepHue(demo.warn, CONTRAST.status),
    error,
    caution: keepHue(demo.caution, CONTRAST.status),
    memory: keepHue(demo.memory, CONTRAST.profile),
    // Chips and badges on another computer's sessions are text on the sidebar and cards too, not only on the canvas.
    remote: solvedHex(toOklch(read(demo.remote)), surfaces, CONTRAST.status, away),
    trigger: keepHue(demo.trigger, CONTRAST.profile),
    unread: blue,
    accent: toHex(read(accent)),
    'accent-ink': accentInk,
    'on-accent': onAccent,
    'terminal-bg': terminalBg,
    'terminal-shadow': SHADES[mode]['terminal-shadow'],
    'profile-yellow': keepHue(demo['profile-yellow'], CONTRAST.profile),
    'profile-blue': keepHue(demo['profile-blue'], CONTRAST.profile),
    'profile-green': keepHue(demo['profile-green'], CONTRAST.profile),
    'profile-purple': keepHue(demo['profile-purple'], CONTRAST.profile),
    'profile-red': keepHue(demo['profile-red'], CONTRAST.profile),
    'profile-orange': keepHue(demo['profile-orange'], CONTRAST.profile),
    'profile-gray': keepHue(demo['profile-gray'], CONTRAST.profile),
    // Chart series keep Demo Time's values: they were picked together, to stay apart for colour-blind readers.
    'chart-output': demo['chart-output'],
    'chart-cache-write': demo['chart-cache-write'],
    'chart-cache-read': demo['chart-cache-read'],
    'chart-input': demo['chart-input'],
  };
  return { ...tokens, ...deriveTokens(mode, { text, 'accent-ink': accentInk, ok, error }) };
}

/** Tokens that are worked out from others after a theme's colours are applied. */
export const DERIVED_TOKENS: readonly ThemeToken[] = ['selected', 'focus-ring', 'diff-added', 'diff-removed'];
