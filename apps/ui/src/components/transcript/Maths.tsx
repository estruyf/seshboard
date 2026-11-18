import { createContext, memo, useContext, useEffect, useState } from 'react';
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

/** `$x$`, or `$$x$$` inside a line of text, drawn in the line (`display`: on a line of its own). Not drawn: as it was written. */
const InlineMath = memo(function InlineMath({ source, display }: { source: string; display: boolean }) {
  const drawnAllowed = useContext(MathDrawnContext);
  const katex = useKatex();
  const written = mathSourceText(display ? 'display' : 'inline', source);
  const html = drawnAllowed && katex ? drawMath(katex, source, display) : null;
  if (html === null) return <span data-math-source data-math-error={drawnAllowed && katex ? '' : undefined}>{written}</span>;
  // A wide display formula scrolls sideways instead of making the pane wider.
  return <span data-math={display ? 'display' : 'inline'} className={display ? 'block max-w-full overflow-x-auto overflow-y-hidden' : undefined} dangerouslySetInnerHTML={{ __html: html }} />;
});

/** A formula block's preview: KaTeX's HTML on the conversation's background, in the text colour, scrolling sideways when wide. */
const BlockMath = memo(function BlockMath({ source }: { source: string }) {
  const katex = useKatex();
  const html = katex ? drawMath(katex, source, true) : null;
  if (html === null) {
    return (
      <div data-math-source data-math-error={katex ? '' : undefined}>
        <pre className="overflow-x-auto py-1 font-mono text-ui">{source}</pre>
        {katex && <p className="text-meta text-muted">Couldn&apos;t draw this formula.</p>}
      </div>
    );
  }
  return <div data-math="block" className="max-w-full overflow-x-auto overflow-y-hidden" dangerouslySetInnerHTML={{ __html: html }} />;
});

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
