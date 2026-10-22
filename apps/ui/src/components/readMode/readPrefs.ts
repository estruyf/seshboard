/**
 * How reading mode looks, as kept in localStorage (`ui.readMode`). Pure, so the parser can be tested; the store reads
 * and writes the string.
 */

export type ReadFont = 'sans' | 'serif' | 'mono';
export type ReadWidth = 'narrow' | 'medium' | 'wide';
export type ReadSize = 0 | 1 | 2 | 3;

export interface ReadPrefs {
  font: ReadFont;
  size: ReadSize;
  width: ReadWidth;
  /** Show the tool calls between the texts instead of one folded line. */
  showTools: boolean;
}

/** Text sizes in px, by step. Reading is the one place outside the type scale: long text wants more room. */
export const READ_SIZES = [15.5, 17.5, 19.5, 21.5] as const;
/** Column widths in px. */
export const READ_WIDTHS = { narrow: 600, medium: 680, wide: 820 } as const;

export const DEFAULT_READ_PREFS: ReadPrefs = { font: 'serif', size: 1, width: 'medium', showTools: false };

const FONTS: readonly ReadFont[] = ['sans', 'serif', 'mono'];
const WIDTHS: readonly ReadWidth[] = ['narrow', 'medium', 'wide'];

/** The preferences saved last time (JSON). Anything missing or wrong falls back to its default, one field at a time. */
export function readPrefs(saved: string | null): ReadPrefs {
  try {
    const value = JSON.parse(saved ?? '{}') as { font?: unknown; size?: unknown; width?: unknown; showTools?: unknown } | null;
    if (!value || typeof value !== 'object') return DEFAULT_READ_PREFS;
    return {
      font: FONTS.includes(value.font as ReadFont) ? (value.font as ReadFont) : DEFAULT_READ_PREFS.font,
      size: Number.isInteger(value.size) && (value.size as number) >= 0 && (value.size as number) < READ_SIZES.length ? (value.size as ReadSize) : DEFAULT_READ_PREFS.size,
      width: WIDTHS.includes(value.width as ReadWidth) ? (value.width as ReadWidth) : DEFAULT_READ_PREFS.width,
      showTools: typeof value.showTools === 'boolean' ? value.showTools : DEFAULT_READ_PREFS.showTools,
    };
  } catch {
    return DEFAULT_READ_PREFS;
  }
}

/** The size one step bigger (1) or smaller (-1), held to the smallest and the biggest. */
export function stepSize(size: ReadSize, by: 1 | -1): ReadSize {
  return Math.min(READ_SIZES.length - 1, Math.max(0, size + by)) as ReadSize;
}
