import { SizedCache } from '../../lib/sizedCache.ts';

/** Whether a fence's language is a Mermaid diagram (`mermaid`, in any case). */
export function isMermaidFence(language: string | undefined): boolean {
  return language?.toLowerCase() === 'mermaid';
}

/** The part of Mermaid's API the renderer uses (the package's default export has it). */
export interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
}

/** A diagram drawn, or why it wasn't. */
/** `load`: Mermaid itself could not be fetched, which says nothing about the diagram. `skipped`: nobody wanted it any more, so it wasn't drawn (never kept). */
export type DrawOutcome = { ok: true; svg: string } | { ok: false; error: string; load?: true; skipped?: true };

/** The most characters of diagram text drawn (Mermaid's own limit is 50,000, and past it draws an error box instead of failing). */
export const MAX_DIAGRAM_TEXT = 25_000;
/** The most edges drawn in one diagram (Mermaid's default is 500); past it Mermaid throws and the block shows its source. */
export const MAX_DIAGRAM_EDGES = 300;

/**
 * Settings a diagram's own `%%{init: …}%%` or front matter may not change, on top of Mermaid's own list (`securityLevel`,
 * limits, …): the theme, whose colours are the app's, and the label kind (see `mermaidConfig`). Mermaid drops these keys
 * from a diagram's settings wherever they are nested, so `flowchart: { htmlLabels: true }` is dropped as well.
 */
const SECURE_KEYS = ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'theme', 'themeVariables', 'themeCSS', 'htmlLabels', 'fontFamily', 'fontSize', 'darkMode'];

/**
 * The settings every diagram is drawn with. `strict` keeps scripts and click handlers out of diagrams (Mermaid
 * sanitises what it returns), and `suppressErrorRendering` makes a bad diagram throw instead of drawing Mermaid's own bomb.
 * Labels are SVG text, not HTML in a `foreignObject`: they take the page's line height and paragraph margins otherwise,
 * and no longer fit the boxes Mermaid measured for them. The keys in `SECURE_KEYS` are the app's: a diagram can't set them.
 */
export function mermaidConfig(themeVariables: Record<string, unknown>): Record<string, unknown> {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables,
    suppressErrorRendering: true,
    logLevel: 'fatal',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    maxTextSize: MAX_DIAGRAM_TEXT,
    maxEdges: MAX_DIAGRAM_EDGES,
    secure: SECURE_KEYS,
  };
}

/** What the renderer is told about the page around it, so tests can run without one. */
export interface MermaidRendererOptions {
  /** Loads Mermaid (a dynamic `import()` in the app, so it adds nothing to start-up). */
  load(): Promise<MermaidApi>;
  /** Removes what a failed `render` left in the page (Mermaid builds the diagram in a hidden element first). */
  cleanup?(id: string): void;
  /** The most characters of drawn diagrams kept (keys and SVG together). */
  budget?: number;
}

export interface MermaidRenderer {
  /** The outcome for this source and theme if it was drawn before, without drawing. */
  peek(source: string, themeVariables: Record<string, unknown>): DrawOutcome | undefined;
  /**
   * Draws it, after the ones asked for before it; the same source and theme asked for twice is drawn once. `signal`: the
   * block that asked no longer needs it (it unmounted, or its theme changed). A drawing nobody wants when its turn comes is
   * skipped and not kept, so blocks that scroll past in a moment don't each cost a drawing; one already started finishes and is kept.
   */
  render(source: string, themeVariables: Record<string, unknown>, signal?: AbortSignal): Promise<DrawOutcome>;
}

const OK = '1';
const FAILED = '0';

/**
 * Draws diagrams one at a time (Mermaid keeps its settings globally, and the theme differs from one call to the next),
 * and remembers each outcome by source and theme, so scrolling back through a long conversation, which mounts the
 * same blocks again, draws nothing twice. A diagram that doesn't parse is remembered too; Mermaid failing to load is not,
 * since the next try may work.
 */
export function createMermaidRenderer({ load, cleanup, budget = 3_000_000 }: MermaidRendererOptions): MermaidRenderer {
  const cache = new SizedCache(budget);
  /** `askers`: those still waiting for it; a job nobody is waiting for when its turn comes is not drawn. */
  const pending = new Map<string, { promise: Promise<DrawOutcome>; askers: number }>();
  let tail: Promise<unknown> = Promise.resolve();
  let counter = 0;
  const keyOf = (source: string, themeVariables: Record<string, unknown>) => `${JSON.stringify(themeVariables)}\0${source}`;

  const draw = async (source: string, themeVariables: Record<string, unknown>, key: string): Promise<DrawOutcome> => {
    let mermaid: MermaidApi;
    try {
      mermaid = await load();
    } catch (error) {
      return { ok: false, error: message(error), load: true };
    }
    const id = `sb-mermaid-${++counter}`;
    try {
      mermaid.initialize(mermaidConfig(themeVariables));
      const { svg } = await mermaid.render(id, source);
      cache.set(key, OK + svg);
      return { ok: true, svg };
    } catch (error) {
      cleanup?.(id);
      cache.set(key, FAILED + message(error));
      return { ok: false, error: message(error) };
    }
  };

  return {
    peek(source, themeVariables) {
      const hit = cache.get(keyOf(source, themeVariables));
      if (hit === undefined) return undefined;
      return hit.startsWith(OK) ? { ok: true, svg: hit.slice(1) } : { ok: false, error: hit.slice(1) };
    },
    render(source, themeVariables, signal) {
      // Mermaid would draw its own error box for this; the block shows the source instead.
      if (source.length > MAX_DIAGRAM_TEXT) return Promise.resolve({ ok: false, error: `The diagram is over ${MAX_DIAGRAM_TEXT} characters.` });
      const key = keyOf(source, themeVariables);
      const cached = this.peek(source, themeVariables);
      if (cached) return Promise.resolve(cached);
      let job = pending.get(key);
      if (!job) {
        const created: { promise: Promise<DrawOutcome>; askers: number } = { askers: 0, promise: undefined as unknown as Promise<DrawOutcome> };
        created.promise = tail.then((): Promise<DrawOutcome> | DrawOutcome => {
          if (created.askers > 0) return draw(source, themeVariables, key);
          // Nobody is waiting: forget the job now, so a block that asks after this starts a new one.
          pending.delete(key);
          return { ok: false, error: 'Skipped', skipped: true };
        });
        tail = created.promise;
        pending.set(key, created);
        void created.promise.finally(() => pending.get(key) === created && pending.delete(key));
        job = created;
      }
      const asked = job;
      if (signal?.aborted) return asked.promise;
      asked.askers++;
      signal?.addEventListener('abort', () => void asked.askers--, { once: true });
      return asked.promise;
    },
  };
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The diagram's own size, from the `viewBox` of the SVG Mermaid returned; null when it has none. */
export function svgSize(svg: string): { width: number; height: number } | null {
  const tag = /^\s*(?:<\?xml[^>]*>\s*)?<svg\b[^>]*>/i.exec(svg)?.[0];
  const box = tag && /\bviewBox\s*=\s*"([^"]*)"/i.exec(tag)?.[1];
  if (!box) return null;
  const [, , width, height] = box.trim().split(/[\s,]+/).map(Number);
  return width && height && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : null;
}

/**
 * How narrow a diagram may be drawn before it scrolls sideways instead: it shrinks to fit the pane, down to 60% of its own
 * width (text stays readable), and never below 280px unless it is smaller than that itself.
 */
export function minDiagramWidth(naturalWidth: number): number {
  return Math.round(Math.min(naturalWidth, Math.max(280, naturalWidth * 0.6)));
}

/**
 * The SVG with its ids made its own: Mermaid names everything after the diagram (`sb-mermaid-3`, its markers
 * `sb-mermaid-3_flowchart-pointEnd`, the `#sb-mermaid-3 …` selectors of its style sheet). The same diagram shown twice (two replies, or
 * the inline copy and the overlay) would share them, and an arrowhead would point at a marker in the other copy, which
 * disappears with it. `suffix` makes the copy's names different. Only the places a name is used in are renamed: attribute
 * values (`id`, `href="#…"`, `url(#…)`, `aria-labelledby`) and the style sheet, never the text of a label. The svg is
 * returned as it is when it has no id.
 */
export function uniqueSvgIds(svg: string, suffix: string): string {
  const id = /^\s*(?:<\?xml[^>]*>\s*)?<svg\b[^>]*?\sid="([^"]+)"/i.exec(svg)?.[1];
  if (!id) return svg;
  // Not followed by a digit, so `sb-mermaid-1` doesn't take the start of `sb-mermaid-12`.
  const name = new RegExp(`${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\d)`, 'g');
  return svg.replace(/<style\b[^>]*>[\s\S]*?<\/style>|="[^"]*"/gi, (place) => place.replace(name, `${id}-${suffix}`));
}
