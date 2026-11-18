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
export type DrawOutcome = { ok: true; svg: string } | { ok: false; error: string };

/**
 * The settings every diagram is drawn with. `strict` keeps scripts and click handlers out of diagrams (Mermaid
 * sanitises what it returns), and `suppressErrorRendering` makes a bad diagram throw instead of drawing Mermaid's own bomb.
 * Labels are SVG text, not HTML in a `foreignObject`: they take the page's line height and paragraph margins otherwise,
 * and no longer fit the boxes Mermaid measured for them.
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
  /** Draws it, after the ones asked for before it; the same source and theme asked for twice is drawn once. */
  render(source: string, themeVariables: Record<string, unknown>): Promise<DrawOutcome>;
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
  const pending = new Map<string, Promise<DrawOutcome>>();
  let tail: Promise<unknown> = Promise.resolve();
  let counter = 0;
  const keyOf = (source: string, themeVariables: Record<string, unknown>) => `${JSON.stringify(themeVariables)}\0${source}`;

  const draw = async (source: string, themeVariables: Record<string, unknown>, key: string): Promise<DrawOutcome> => {
    let mermaid: MermaidApi;
    try {
      mermaid = await load();
    } catch (error) {
      return { ok: false, error: message(error) };
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
    render(source, themeVariables) {
      const key = keyOf(source, themeVariables);
      const cached = this.peek(source, themeVariables);
      if (cached) return Promise.resolve(cached);
      const running = pending.get(key);
      if (running) return running;
      const job = tail.then(() => draw(source, themeVariables, key));
      tail = job;
      pending.set(key, job);
      void job.finally(() => pending.delete(key));
      return job;
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
