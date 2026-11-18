import { Maximize2 } from 'lucide-react';
import { memo, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useThemes } from '../../state/themeStore.ts';
import { Button } from '../ui/Button.tsx';
import { BlockWritingContext } from './blockWriting.ts';
import { CodeBlock } from './CodeBlock.tsx';
import { MermaidOverlay } from './MermaidOverlay.tsx';
import { failureLine, pickOutcome, shouldDraw, type Drawn } from './mermaidBlockState.ts';
import { followDiagramLink } from './mermaidLinks.ts';
import { createMermaidRenderer, minDiagramWidth, svgSize, uniqueSvgIds } from './mermaidRender.ts';
import { mermaidThemeVariables } from './mermaidTheme.ts';
import { useDark } from './VisualBlock.tsx';

/** Shared by every diagram: one at a time, and each drawn once per theme. Mermaid itself is fetched the first time one shows. */
const renderer = createMermaidRenderer({
  load: () => import('mermaid').then((module) => module.default),
  // Mermaid builds a diagram in a hidden element of the page and removes it when it is done; a parse error leaves it behind.
  cleanup: (id) => {
    document.getElementById(`d${id}`)?.remove();
    document.getElementById(id)?.remove();
  },
});

/**
 * A ```` ```mermaid ```` block: drawn as a diagram, with the Preview | Source switch and Copy a Markdown block has. Until it
 * is drawn (Mermaid loading) it shows its source, and while the reply holding it is still being written
 * (`BlockWritingContext`) it only shows its source: a half-written diagram is never drawn. When it can't be drawn it shows
 * its source with a line saying so. The colours come from the app's tokens, read when it is drawn, and it is drawn again when the theme or the
 * colour scheme changes (the old drawing stays until the new one is ready). A click on the diagram opens it larger.
 */
export const MermaidBlock = memo(function MermaidBlock({ code }: { code: string }) {
  const writing = useContext(BlockWritingContext);
  const dark = useDark();
  const active = useThemes((s) => s.active);
  const colorScheme = usePreferences((s) => s.prefs.colorScheme);
  // The theme's style is applied before this renders (the store applies it as it changes), so the tokens read are the new ones.
  const variables = useMemo(() => mermaidThemeVariables((name) => getComputedStyle(document.documentElement).getPropertyValue(name)), [dark, active, colorScheme]);
  const cached = renderer.peek(code, variables);
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  // What this block showed last, for a theme change on a block that came out of the cache.
  const shown = useRef<Drawn | null>(null);
  const outcome = pickOutcome(code, cached, drawn, shown.current);
  useEffect(() => {
    if (outcome) shown.current = { code, outcome };
  }, [code, outcome]);

  const draw = shouldDraw(writing, cached);
  useEffect(() => {
    if (!draw) return;
    // Left when the block goes (scrolled away, or a new theme): a drawing still waiting its turn is then skipped.
    const wanted = new AbortController();
    void renderer.render(code, variables, wanted.signal).then((result) => !wanted.signal.aborted && setDrawn({ code, outcome: result }));
    return () => wanted.abort();
  }, [code, variables, draw]);

  if (outcome?.ok) return <Diagram code={code} svg={outcome.svg} />;
  return (
    <div data-mermaid="" data-mermaid-state={outcome ? 'error' : 'pending'}>
      <CodeBlock code={code} language="mermaid" />
      {outcome && (
        <p className="-mt-1 mb-2 px-1 text-meta text-muted" data-mermaid-error="">
          {failureLine(outcome)}
        </p>
      )}
    </div>
  );
});

/** Makes each insertion of a drawing its own ids (see `uniqueSvgIds`). */
let copies = 0;
const ownCopy = (svg: string) => uniqueSvgIds(svg, `c${++copies}`);

function Diagram({ code, svg }: { code: string; svg: string }) {
  const [open, setOpen] = useState(false);
  const size = useMemo(() => svgSize(svg), [svg]);
  const inline = useMemo(() => ownCopy(svg), [svg]);
  // Its own copy of the drawing, made when the overlay opens.
  const larger = useMemo(() => (open ? ownCopy(svg) : null), [open, svg]);
  // A link in the diagram (`click A href …`) goes where it says; it doesn't also open the overlay.
  const onClick = (event: MouseEvent) => {
    if (followDiagramLink(event) || !size || window.getSelection()?.toString()) return;
    setOpen(true);
  };
  const style = size ? ({ '--mermaid-min': `${minDiagramWidth(size.width)}px` } as CSSProperties) : undefined;
  const preview = (
    <div className="group/diagram relative">
      <div
        // The SVG is what Mermaid returned under `securityLevel: 'strict'`. A wide diagram shrinks to fit, down to a readable size, then scrolls sideways.
        className={`overflow-x-auto py-2 select-text [&_svg]:mx-auto [&_svg]:min-w-(--mermaid-min) ${size ? 'cursor-zoom-in' : ''}`}
        style={style}
        onClick={onClick}
        dangerouslySetInnerHTML={{ __html: inline }}
        data-mermaid-diagram=""
      />
      {size && (
        <div className="pointer-events-none absolute top-1 right-1 rounded-md bg-bg/80 opacity-0 group-focus-within/diagram:pointer-events-auto group-focus-within/diagram:opacity-100 group-hover/diagram:pointer-events-auto group-hover/diagram:opacity-100">
          <Button variant="quiet" size="sm" iconOnly icon={<Maximize2 size={12} aria-hidden />} aria-label="Open larger" onClick={() => setOpen(true)} data-mermaid-open="" />
        </div>
      )}
    </div>
  );
  return (
    <div data-mermaid="" data-mermaid-state="drawn">
      <CodeBlock code={code} language="mermaid" copyLabel="Copy diagram source" preview={preview} />
      {/* In the body: the conversation's rows are positioned by transforms, which would hold a fixed overlay inside them. */}
      {larger && size && createPortal(<MermaidOverlay svg={larger} size={size} onClose={() => setOpen(false)} />, document.body)}
    </div>
  );
}
