/** The grey a project gets with Settings › Theme › Project colours off: the theme's muted colour. */
export const PROJECT_GREY = 'var(--sb-muted)';

/**
 * Stable, readable colour per project name: the tile behind a letter icon, and any icon without a clear colour.
 * `colored: false` (Project colours off) gives the theme's muted grey instead.
 */
export function letterColor(name: string, colored = true): string {
  if (!colored) return PROJECT_GREY;
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 45% 42%)`;
}

/** Hue buckets of 15 degrees: wide enough that one logo colour lands in one bucket. */
const BUCKETS = 24;
/** Below this average vividness (0 to 1) an icon reads as grey, black or white. */
const MIN_VIVID = 0.06;

/**
 * The colour an icon reads as, from its RGBA pixels: the hue most of its vivid pixels share (so a
 * red and green logo is red or green, never their brown average), with saturation and lightness
 * kept where a border shows on both themes. Null when the icon has no clear colour.
 */
export function accentFromPixels(data: ArrayLike<number>): string | null {
  const buckets = Array.from({ length: BUCKETS }, () => ({ weight: 0, hue: 0, sat: 0, light: 0 }));
  let opaque = 0;
  let vivid = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3]! < 128) continue;
    const r = data[i]! / 255;
    const g = data[i + 1]! / 255;
    const b = data[i + 2]! / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    opaque += 1;
    vivid += chroma;
    if (chroma < 0.15) continue;
    const hue = (max === r ? ((g - b) / chroma + 6) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4) * 60;
    const light = (max + min) / 2;
    const bucket = buckets[Math.floor(hue / (360 / BUCKETS)) % BUCKETS]!;
    // Vivid pixels count more than washed-out ones, so anti-aliased edges don't decide.
    const w = chroma * chroma;
    bucket.weight += w;
    bucket.hue += hue * w;
    bucket.sat += (chroma / (1 - Math.abs(2 * light - 1) || 1)) * w;
    bucket.light += light * w;
  }
  if (!opaque || vivid / opaque < MIN_VIVID) return null;
  const best = buckets.reduce((a, b) => (b.weight > a.weight ? b : a));
  if (!best.weight) return null;
  const clamp = (value: number, low: number, high: number) => Math.round(Math.min(high, Math.max(low, value)));
  return `hsl(${Math.round(best.hue / best.weight)} ${clamp((best.sat / best.weight) * 100, 40, 80)}% ${clamp((best.light / best.weight) * 100, 40, 56)}%)`;
}
