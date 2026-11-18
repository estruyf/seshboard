import { createContext, memo, useContext, useEffect, useState, type ReactNode } from 'react';
import { CodeBlock } from './CodeBlock.tsx';
import { drawMath, katexNow, loadKatex, type Katex } from './katex.ts';
import { mathSourceText, type MathKind } from './maths.ts';

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
 * A drawn formula, in a wrapper that carries its TeX (`data-math-source`, and `data-math-display` for a formula on a line
 * of its own) so a copy can write the formula back as it was written instead of the glyphs and the MathML. KaTeX's output
 * itself can't be selected: part by part it would copy as `x2x2`.
 */
function Drawn({ source, display, block, html }: { source: string; display: boolean; block: boolean; html: string }) {
  const kind = block ? 'block' : display ? 'display' : 'inline';
  // Inline: clipped to its own box, since a negative kern or a raised box would draw over the text around it (`maxSize` can't stop those).
  // On a line of its own: scrolls sideways when wide instead of widening the pane.
  const layout = block || display ? 'block max-w-full overflow-x-auto overflow-y-hidden' : 'inline-block max-w-full overflow-clip align-baseline [overflow-clip-margin:0.2em]';
  return (
    <span data-math={kind} data-math-source={source} data-math-display={display || block ? '' : undefined} className={layout}>
      <span className="select-none" dangerouslySetInnerHTML={{ __html: html }} />
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
