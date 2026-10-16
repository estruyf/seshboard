import type { CSSProperties } from 'react';
import { cssColor, resolveModBackground, resolveModColor } from './modColor.ts';

/**
 * Ink's layout props as CSS. Mods lay out in character cells: a column is the mono font's advance (`ch`) and a row its
 * line height (`lh`), measured on this window's mono font, so a layout written for the terminal lines up here. Text
 * itself uses the app font (Code uses mono). Pure, so it can be tested.
 */

/** One cell of the mono font, in pixels. */
export interface CellMetrics {
  ch: number;
  lh: number;
}

/** Used until the font has been measured (Demo Time's mono at 12px). */
export const DEFAULT_CELLS: CellMetrics = { ch: 7.2, lh: 18 };

/** Spacing steps the desktop surface takes besides cells, in pixels. */
const STEPS: Record<string, number> = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

const PERCENT = /^(?:100|\d{1,2}(?:\.\d+)?)%$/;

/** A size or spacing in cells (columns across, rows down), a step name, or a percentage; null when it is none of them. */
export function cells(value: unknown, axis: 'x' | 'y', m: CellMetrics): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return `${round(Math.max(0, value) * (axis === 'x' ? m.ch : m.lh))}px`;
  if (typeof value !== 'string') return null;
  if (value in STEPS) return `${STEPS[value]}px`;
  return PERCENT.test(value) ? value : null;
}

const round = (n: number) => Math.round(n * 100) / 100;

const FLEX_DIRECTION = new Set(['row', 'column', 'row-reverse', 'column-reverse']);
const FLEX_WRAP = new Set(['wrap', 'nowrap', 'wrap-reverse']);
const ALIGN = new Set(['flex-start', 'center', 'flex-end', 'stretch', 'baseline']);
const JUSTIFY = new Set(['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly']);
const OVERFLOW = new Set(['visible', 'hidden', 'scroll']);

type Props = Record<string, unknown>;
const pick = <T extends string>(set: Set<string>, value: unknown): T | undefined => (typeof value === 'string' && set.has(value) ? (value as T) : undefined);
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** The four sides of a spacing prop (`margin`, `marginX`, `marginTop`…), in pixels. */
function spacing(props: Props, kind: 'margin' | 'padding', m: CellMetrics): CSSProperties {
  const all = props[kind];
  const x = props[`${kind}X`] ?? all;
  const y = props[`${kind}Y`] ?? all;
  const side = (name: 'Top' | 'Bottom' | 'Left' | 'Right', fallback: unknown, axis: 'x' | 'y') => cells(props[`${kind}${name}`] ?? fallback, axis, m);
  const out: Record<string, string> = {};
  const top = side('Top', y, 'y');
  const bottom = side('Bottom', y, 'y');
  const left = side('Left', x, 'x');
  const right = side('Right', x, 'x');
  if (top) out[`${kind}Top`] = top;
  if (bottom) out[`${kind}Bottom`] = bottom;
  if (left) out[`${kind}Left`] = left;
  if (right) out[`${kind}Right`] = right;
  return out as CSSProperties;
}

/** Ink border styles: every one draws a 1px line here; `round` gets rounded corners. */
const BORDERS = new Set(['single', 'double', 'round', 'bold', 'singleDouble', 'doubleSingle', 'classic', 'arrow']);

/** A Box's props as CSS. Ink lays a Box out as a row unless it says otherwise. */
export function boxStyle(props: Props, m: CellMetrics, background: string): CSSProperties {
  const style: CSSProperties = {
    display: props.display === 'none' ? 'none' : 'flex',
    flexDirection: pick(FLEX_DIRECTION, props.flexDirection) ?? 'row',
    flexWrap: pick(FLEX_WRAP, props.flexWrap),
    flexGrow: num(props.flexGrow),
    flexShrink: num(props.flexShrink) ?? 1,
    flexBasis: cells(props.flexBasis, 'x', m) ?? undefined,
    alignItems: pick(ALIGN, props.alignItems),
    alignSelf: pick(ALIGN, props.alignSelf),
    justifyContent: pick(JUSTIFY, props.justifyContent),
    minWidth: 0,
    ...spacing(props, 'margin', m),
    ...spacing(props, 'padding', m),
  };
  const gap = cells(props.gap, 'x', m);
  const rowGap = cells(props.rowGap ?? props.gap, 'y', m);
  const columnGap = cells(props.columnGap, 'x', m) ?? gap;
  if (rowGap) style.rowGap = rowGap;
  if (columnGap) style.columnGap = columnGap;
  for (const [key, axis] of [['width', 'x'], ['minWidth', 'x'], ['maxWidth', 'x'], ['height', 'y'], ['minHeight', 'y'], ['maxHeight', 'y']] as const) {
    const value = cells(props[key], axis, m);
    if (value) style[key] = value;
  }
  const overflowX = pick<'visible' | 'hidden' | 'scroll'>(OVERFLOW, props.overflowX ?? props.overflow);
  const overflowY = pick<'visible' | 'hidden' | 'scroll'>(OVERFLOW, props.overflowY ?? props.overflow);
  if (overflowX) style.overflowX = overflowX === 'scroll' ? 'auto' : overflowX;
  if (overflowY) style.overflowY = overflowY === 'scroll' ? 'auto' : overflowY;
  if (typeof props.borderStyle === 'string' && BORDERS.has(props.borderStyle)) {
    const color = resolveModColor(props.borderColor, background);
    const line = `1px solid ${color ? cssColor(color) : 'var(--sb-border)'}`;
    if (props.borderTop !== false) style.borderTop = line;
    if (props.borderBottom !== false) style.borderBottom = line;
    if (props.borderLeft !== false) style.borderLeft = line;
    if (props.borderRight !== false) style.borderRight = line;
    if (props.borderStyle === 'round') style.borderRadius = 6;
    if (props.borderDimColor === true) style.opacity = 0.75;
  }
  const bg = resolveModBackground(props.backgroundColor);
  if (bg) style.backgroundColor = 'token' in bg ? `color-mix(in srgb, var(--sb-${bg.token}) 14%, transparent)` : bg.hex;
  if (props.position === 'absolute') {
    style.position = 'absolute';
    for (const [key, axis] of [['top', 'y'], ['bottom', 'y'], ['left', 'x'], ['right', 'x']] as const) {
      const value = cells(props[key], axis, m);
      if (value) style[key] = value;
    }
  }
  return style;
}

/** How a Text wraps: Ink's `wrap` (`wrap`, `truncate`, `truncate-end`, `truncate-start`, `truncate-middle`). */
export function wrapMode(props: Props): 'wrap' | 'truncate' | 'truncate-start' {
  const wrap = typeof props.wrap === 'string' ? props.wrap : props.truncate === true ? 'truncate' : 'wrap';
  if (wrap === 'truncate-start') return 'truncate-start';
  if (wrap.startsWith('truncate') || wrap === 'end' || wrap === 'middle') return 'truncate';
  return 'wrap';
}

/** A Text's props as CSS. `inverse` swaps the colour onto a tinted background. */
export function textStyle(props: Props, background: string): CSSProperties {
  const style: CSSProperties = {};
  const color = resolveModColor(props.color, background);
  const bg = resolveModBackground(props.backgroundColor);
  if (props.inverse === true) {
    style.backgroundColor = color ? cssColor(color) : 'var(--sb-text)';
    style.color = 'var(--sb-card)';
  } else {
    if (color) style.color = cssColor(color);
    if (bg) style.backgroundColor = 'token' in bg ? `color-mix(in srgb, var(--sb-${bg.token}) 18%, transparent)` : bg.hex;
  }
  const weight = props.weight;
  if (props.bold === true || weight === 'bold') style.fontWeight = 600;
  else if (weight === 'semibold') style.fontWeight = 600;
  else if (weight === 'medium') style.fontWeight = 500;
  if (props.italic === true) style.fontStyle = 'italic';
  const lines = [props.underline === true && 'underline', props.strikethrough === true && 'line-through'].filter(Boolean);
  if (lines.length) style.textDecoration = lines.join(' ');
  if (props.dimColor === true) style.opacity = 0.6;
  if (props.mono === true) style.fontFamily = 'var(--font-mono)';
  if (props.tabular === true) style.fontVariantNumeric = 'tabular-nums';
  const wrap = wrapMode(props);
  if (wrap !== 'wrap') {
    style.overflow = 'hidden';
    style.textOverflow = 'ellipsis';
    style.whiteSpace = 'nowrap';
    if (wrap === 'truncate-start') style.direction = 'rtl';
  } else {
    style.whiteSpace = 'pre-wrap';
    style.overflowWrap = 'anywhere';
  }
  return style;
}
