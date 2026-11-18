import { createContext, memo, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CodeBlock } from './CodeBlock.tsx';
import { drawMath, katexNow, katexSheet, loadKatex, type Katex } from './katex.ts';
import { mathCopyText, mathSourceText, type MathKind } from './maths.ts';

/**
 * Whether formulas are drawn. False for the block Claude is still writing: an unclosed `$$` would draw half a formula, so
 * until the block is complete the maths shows as it was written. Drawn by default.
 */
export const MathDrawnContext = createContext(true);

/** KaTeX once it is loaded: at once when it is, else after the chunk arrives (and null until then, or if it can't load). */
function useKatex(): Katex | null {
  const [katex, setKatex] = useState<Katex | null>(katexNow);
  useEffect(() => {
    if (katex) return;
    let cancelled = false;
    loadKatex().then(
      (loaded) => !cancelled && setKatex(loaded),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [katex]);
  return katex;
}

/**
 * KaTeX's output, in a shadow root once it is on screen. A selection that spans a formula would otherwise copy its pieces
 * (`x2x2`, and a line break for each inline table KaTeX builds a script or a fraction from, even with `user-select: none`);
 * a shadow root's content is not part of it, so only the TeX beside it (`data-math-copy`) is. The root carries KaTeX's
 * own rules (`katexSheet`); fonts come from the document. Until then (and where there is no shadow root to make, as when
 * rendering to a string) the HTML is plain children of the span.
 */
function Visual({ html }: { html: string }) {
  const host = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = host.current;
    const sheet = katexSheet();
    if (!el || !sheet) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [sheet];
    root.innerHTML = html;
    // The light copy isn't drawn any more (a shadow host shows only its root); leave none in the page to find or copy.
    el.replaceChildren();
  }, [html]);
  return <span ref={host} data-math-visual className="select-none" dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * A drawn formula, in a wrapper that carries its TeX (`data-math-source`, and `data-math-display` for a formula on a line
 * of its own). A hidden span holds the TeX in its delimiters (`data-math-copy`), which a selection includes:
 * `getSelection().toString()`, so Copy, Quote and Remember, give `then $x^2$ holds`. It is hidden from screen readers,
 * who get KaTeX's MathML.
 */
function Drawn({ source, display, block, html }: { source: string; display: boolean; block: boolean; html: string }) {
  const kind: MathKind = block ? 'block' : display ? 'display' : 'inline';
  // Inline: clipped to its own box, since a negative kern or a raised box would draw over the text around it (`maxSize` can't stop those).
  // On a line of its own: scrolls sideways when wide instead of widening the pane.
  const layout = block || display ? 'block max-w-full overflow-x-auto overflow-y-hidden' : 'inline-block max-w-full overflow-clip align-baseline [overflow-clip-margin:0.2em]';
  return (
    <span data-math={kind} data-math-source={source} data-math-display={display || block ? '' : undefined} className={`relative ${layout}`}>
      <Visual html={html} />
      <span data-math-copy aria-hidden="true" className="absolute top-0 left-0 size-px overflow-hidden whitespace-pre opacity-0">
        {mathCopyText(kind, source)}
      </span>
    </span>
  );
}

/** `$x$`, or `$$x$$` inside a line of text, drawn in the line (`display`: on a line of its own). Not drawn: as it was written. */
const InlineMath = memo(function InlineMath({ source, display }: { source: string; display: boolean }) {
  const drawnAllowed = useContext(MathDrawnContext);
  const katex = useKatex();
  const written = mathSourceText(display ? 'display' : 'inline', source);
  const html = drawnAllowed && katex ? drawMath(katex, source, display) : null;
  if (html === null) return <span data-math-written data-math-error={drawnAllowed && katex ? '' : undefined}>{written}</span>;
  return <Drawn source={source} display={display} block={false} html={html} />;
});

/** A formula block's preview: KaTeX's HTML on the conversation's background, in the text colour, scrolling sideways when wide. */
const BlockMath = memo(function BlockMath({ source }: { source: string }) {
  const katex = useKatex();
  const html = katex ? drawMath(katex, source, true) : null;
  if (html === null) {
    return (
      <div data-math-written data-math-error={katex ? '' : undefined}>
        <pre className="overflow-x-auto py-1 font-mono text-ui">{source}</pre>
        {katex && <p className="text-meta text-muted">Couldn&apos;t draw this formula.</p>}
      </div>
    );
  }
  return <Drawn source={source} display block html={html} />;
});

/**
 * The blocks of a message still being written, each rendered by `render` (which gets whether it is the last): maths in the
 * last one shows as written, since an unclosed `$$` would draw half a formula. The ones before it are complete.
 */
export function streamingBlocks(blocks: readonly string[], render: (text: string, last: boolean) => ReactNode): ReactNode {
  // Every block sits in a provider, so one that stops being the last isn't remounted.
  return blocks.map((block, i) => {
    const last = i === blocks.length - 1;
    return (
      <MathDrawnContext key={i} value={!last}>
        {render(block, last)}
      </MathDrawnContext>
    );
  });
}

/**
 * A `code` element that is maths (`mathKind` in maths.ts). Inline and in-line display formulas are drawn in the text; a
 * block is a code block with the Preview | Source switch, opening on the drawn formula, and Copy copies the source.
 * KaTeX is loaded the first time one shows.
 */
export function MathCode({ kind, source }: { kind: MathKind; source: string }) {
  const drawnAllowed = useContext(MathDrawnContext);
  if (kind !== 'block') return <InlineMath source={source} display={kind === 'display'} />;
  return <CodeBlock code={source} language="math" preview={drawnAllowed ? <BlockMath source={source} /> : undefined} copyLabel="Copy formula" />;
}
