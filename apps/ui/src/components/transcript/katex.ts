/**
 * KaTeX, loaded the first time a formula shows: its script and its stylesheet (with the fonts, which Vite bundles and the
 * window's Content-Security-Policy allows from `'self'` and `data:`) are a chunk of their own, so a reply without maths
 * costs nothing at start-up.
 */
export type Katex = typeof import('katex').default;

let loaded: Katex | null = null;
let loading: Promise<Katex> | null = null;

/** KaTeX if it is loaded already, so a formula can be drawn in the render that asks for it. */
export const katexNow = (): Katex | null => loaded;

export function loadKatex(): Promise<Katex> {
  loading ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(
    ([module]) => (loaded = module.default),
    (error: unknown) => {
      // Try again the next time a formula shows.
      loading = null;
      throw error;
    },
  );
  return loading;
}

/**
 * What KaTeX paints a command it won't run in (`\href` without trust, say) instead of throwing. Nothing the theme owns, so a
 * result that holds it is a failure and the source shows instead.
 */
const ERROR_COLOUR = '#fe01fe';

/** A formula longer than this shows as its source: KaTeX takes seconds and megabytes of HTML for a very long one. */
export const MAX_FORMULA = 5_000;
/** Kept formulas, counted by the size of their HTML (the cache holds about this many characters), not only by number. */
const CACHE_CHARS = 2_000_000;
const CACHE_ENTRIES = 300;
const drawn = new Map<string, string | null>();
let cachedChars = 0;

const forget = (key: string) => {
  cachedChars -= drawn.get(key)?.length ?? 0;
  drawn.delete(key);
};

/**
 * A formula as KaTeX's HTML, or null when it doesn't parse or is too long. Cached by source, so a long conversation
 * scrolling past doesn't draw the same formula again. `trust: false` (no `\href`, `\includegraphics` and the like),
 * `maxSize` (the biggest box or rule, in em) and `maxExpand` (macro expansions) keep a formula from drawing over the page or
 * running away, and `strict: 'ignore'` stops console warnings for what Claude writes; an error throws so the caller can
 * show the source instead.
 */
export function drawMath(katex: Katex, source: string, display: boolean): string | null {
  if (source.length > MAX_FORMULA) return null;
  const key = `${display ? 'd' : 'i'}:${source}`;
  if (drawn.has(key)) {
    const hit = drawn.get(key)!;
    // Moves it to the end, the newest.
    forget(key);
    drawn.set(key, hit);
    cachedChars += hit?.length ?? 0;
    return hit;
  }
  let html: string | null;
  try {
    html = katex.renderToString(source, { displayMode: display, throwOnError: true, trust: false, strict: 'ignore', errorColor: ERROR_COLOUR, maxSize: 10, maxExpand: 200, output: 'htmlAndMathml' });
    if (html.includes(ERROR_COLOUR)) html = null;
  } catch {
    html = null;
  }
  drawn.set(key, html);
  cachedChars += html?.length ?? 0;
  while (drawn.size > CACHE_ENTRIES || cachedChars > CACHE_CHARS) forget(drawn.keys().next().value!);
  return html;
}
