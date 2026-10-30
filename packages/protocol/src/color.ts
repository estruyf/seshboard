/**
 * Colour values for themes: the four formats a theme file may use, parsed to sRGB, and the maths
 * that themes need (OKLCH, WCAG contrast, alpha compositing). Plain TypeScript, so the renderer,
 * main and the schema share one parser: a value is a colour exactly when `parseColor` reads it.
 */

/** An sRGB colour: channels 0–1 (gamma encoded), alpha 0–1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** OKLCH: lightness 0–1, chroma (0 to about 0.4), hue in degrees. */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

const NUM = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)`;
// A comma with spaces around it, or spaces alone. Not `\s*[,\s]\s*`, where three parts can take the same spaces and a
// long run of them takes a regular expression very long to refuse.
const SEP = String.raw`(?:\s*,\s*|\s+)`;
const ALPHA = String.raw`(?:\s*[,/]\s*(${NUM}%?))?`;
const DEG = '(?:deg|DEG)?';
// No `i` flag, so the same sources work as a JSON Schema `pattern` (which has no flags).
const HEX = '#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})';
const RGB = String.raw`(?:rgba?|RGBA?)\(\s*(${NUM}%?)${SEP}(${NUM}%?)${SEP}(${NUM}%?)${ALPHA}\s*\)`;
const HSL = String.raw`(?:hsla?|HSLA?)\(\s*(${NUM})${DEG}${SEP}(${NUM})%?${SEP}(${NUM})%?${ALPHA}\s*\)`;
const OKLCH = String.raw`(?:oklch|OKLCH)\(\s*(${NUM}%?)\s+(${NUM}%?)\s+(${NUM})${DEG}${ALPHA}\s*\)`;
const anchored = (source: string) => new RegExp(`^${source}$`);
const HEX_RE = anchored(HEX);
const RGB_RE = anchored(RGB);
const HSL_RE = anchored(HSL);
const OKLCH_RE = anchored(OKLCH);

/**
 * Every value a theme may hold, as one regular expression (also the `pattern` in the JSON Schema):
 * `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()`, `hsl()`/`hsla()` and `oklch()`. Nothing else can
 * get through, so a theme can never smuggle `url()`, `var()`, `;` or `}` into the generated CSS.
 */
export const COLOR_PATTERN = `^(?:${[HEX, RGB, HSL, OKLCH].join('|')})$`;

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const alphaOf = (raw: string | undefined) => (raw === undefined ? 1 : clamp(raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw)));
const channel = (raw: string) => clamp(raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw) / 255);

/** Reads a theme colour; null for anything that isn't one of the accepted formats. */
export function parseColor(value: string): Rgba | null {
  const text = value.trim();
  if (HEX_RE.test(text)) {
    const hex = text.slice(1);
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) : 1 };
  }
  let m = RGB_RE.exec(text);
  if (m) return { r: channel(m[1]!), g: channel(m[2]!), b: channel(m[3]!), a: alphaOf(m[4]) };
  m = HSL_RE.exec(text);
  if (m) return { ...hslToRgb(parseFloat(m[1]!), clamp(parseFloat(m[2]!) / 100), clamp(parseFloat(m[3]!) / 100)), a: alphaOf(m[4]) };
  m = OKLCH_RE.exec(text);
  if (m) {
    const l = m[1]!.endsWith('%') ? parseFloat(m[1]!) / 100 : parseFloat(m[1]!);
    const c = m[2]!.endsWith('%') ? (parseFloat(m[2]!) / 100) * 0.4 : parseFloat(m[2]!);
    return { ...clampRgb(oklchToLinearRgb({ l: clamp(l), c: Math.max(0, c), h: parseFloat(m[3]!) })), a: alphaOf(m[4]) };
  }
  return null;
}

/** True for a value `parseColor` accepts. */
export const isColor = (value: string) => parseColor(value) !== null;

function hslToRgb(h: number, s: number, l: number): Omit<Rgba, 'a'> {
  const hue = ((h % 360) + 360) % 360;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: f(0), g: f(8), b: f(4) };
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** OKLCH to gamma-encoded sRGB, possibly outside 0–1 (see `inGamut`). */
function oklchToLinearRgb({ l, c, h }: Oklch): Omit<Rgba, 'a'> {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return {
    r: toGamma(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    g: toGamma(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    b: toGamma(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  };
}

const clampRgb = (rgb: Omit<Rgba, 'a'>) => ({ r: clamp(rgb.r), g: clamp(rgb.g), b: clamp(rgb.b) });
const inGamut = (rgb: Omit<Rgba, 'a'>) => [rgb.r, rgb.g, rgb.b].every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** sRGB to OKLCH (hue 0 for greys). */
export function toOklch({ r, g, b }: Rgba): Oklch {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.hypot(A, B);
  return { l: L, c, h: c < 1e-4 ? 0 : (((Math.atan2(B, A) * 180) / Math.PI) % 360 + 360) % 360 };
}

/** OKLCH to sRGB, lowering the chroma (keeping lightness and hue) until it fits in sRGB. */
export function fromOklch(color: Oklch, alpha = 1): Rgba {
  const l = clamp(color.l);
  let rgb = oklchToLinearRgb({ ...color, l });
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = color.c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinearRgb({ l, c: mid, h: color.h }))) lo = mid;
      else hi = mid;
    }
    rgb = oklchToLinearRgb({ l, c: lo, h: color.h });
  }
  return { ...clampRgb(rgb), a: alpha };
}

/** `#rrggbb`, or `#rrggbbaa` when not opaque. */
export function toHex({ r, g, b, a }: Rgba): string {
  const h = (v: number) => Math.round(clamp(v) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}${a < 0.999 ? h(a) : ''}`;
}

/** `top` drawn over `bottom` (which is made opaque first). */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a;
  return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 };
}

/** WCAG 2 relative luminance of an opaque colour. */
export const luminance = ({ r, g, b }: Rgba) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

/** WCAG 2 contrast ratio (1–21) of `fg` drawn on `bg`; a translucent foreground is drawn over the background first. */
export function contrast(fg: Rgba, bg: Rgba): number {
  const back = bg.a < 1 ? composite(bg, { r: 1, g: 1, b: 1, a: 1 }) : bg;
  const front = fg.a < 1 ? composite(fg, back) : fg;
  const [hi, lo] = [luminance(front), luminance(back)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Contrast of two colour strings; 1 when either can't be read. */
export function contrastOf(fg: string, bg: string): number {
  const f = parseColor(fg);
  const b = parseColor(bg);
  return f && b ? contrast(f, b) : 1;
}
