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

const CACHE_LIMIT = 300;
const drawn = new Map<string, string | null>();

/**
 * What KaTeX paints a command it won't run in (`\href` without trust, say) instead of throwing. Nothing the theme owns, so a
 * result that holds it is a failure and the source shows instead.
 */
const ERROR_COLOUR = '#fe01fe';

/**
 * A formula as KaTeX's HTML, or null when it doesn't parse. Cached by source, so a long conversation scrolling past
 * doesn't draw the same formula again. `trust: false` (no `\href`, `\includegraphics` and the like) and `strict: 'ignore'`
 * (no console warnings for what Claude writes); an error throws so the caller can show the source instead.
 */
export function drawMath(katex: Katex, source: string, display: boolean): string | null {
  const key = `${display ? 'd' : 'i'}:${source}`;
  if (drawn.has(key)) {
    const hit = drawn.get(key)!;
    // Moves it to the end, the newest.
    drawn.delete(key);
    drawn.set(key, hit);
    return hit;
  }
  let html: string | null;
  try {
    html = katex.renderToString(source, { displayMode: display, throwOnError: true, trust: false, strict: 'ignore', errorColor: ERROR_COLOUR, output: 'htmlAndMathml' });
    if (html.includes(ERROR_COLOUR)) html = null;
  } catch {
    html = null;
  }
  drawn.set(key, html);
  if (drawn.size > CACHE_LIMIT) drawn.delete(drawn.keys().next().value!);
  return html;
}
