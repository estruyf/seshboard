import { Maximize2 } from 'lucide-react';
import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useThemes } from '../../state/themeStore.ts';
import { Button } from '../ui/Button.tsx';
import { CodeBlock } from './CodeBlock.tsx';
import { MermaidOverlay } from './MermaidOverlay.tsx';
import { createMermaidRenderer, minDiagramWidth, svgSize, type DrawOutcome } from './mermaidRender.ts';
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

/** How long the source must stay as it is before it is drawn: a block Claude is still writing keeps showing its source. */
const SETTLE_MS = 350;

/**
 * A ```` ```mermaid ```` block: drawn as a diagram, with the Preview | Source switch and Copy a Markdown block has. Until it
 * is drawn (Mermaid loading, or the block still being written, which changes faster than `SETTLE_MS`) it shows its source;
 * when it can't be drawn it shows its source with a line saying so. The colours come from the app's tokens, read when it is
 * drawn, and it is drawn again when the theme or the colour scheme changes (the old drawing stays until the new one is ready).
 * A click on the diagram opens it larger.
 */
export const MermaidBlock = memo(function MermaidBlock({ code }: { code: string }) {
  const dark = useDark();
  const active = useThemes((s) => s.active);
  const colorScheme = usePreferences((s) => s.prefs.colorScheme);
  // The theme's style is applied before this renders (the store applies it as it changes), so the tokens read are the new ones.
  const variables = useMemo(() => mermaidThemeVariables((name) => getComputedStyle(document.documentElement).getPropertyValue(name)), [dark, active, colorScheme]);
  const cached = renderer.peek(code, variables);
  // The last outcome, tagged with its source: a changed source starts over, a changed theme keeps the old drawing until the new one arrives.
  const [drawn, setDrawn] = useState<{ code: string; outcome: DrawOutcome } | null>(null);
  const outcome = cached ?? (drawn?.code === code ? drawn.outcome : null);

  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void renderer.render(code, variables).then((result) => !cancelled && setDrawn({ code, outcome: result }));
    }, SETTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, variables, cached]);

  if (outcome?.ok) return <Diagram code={code} svg={outcome.svg} />;
  return (
    <div data-mermaid="" data-mermaid-state={outcome ? 'error' : 'pending'}>
      <CodeBlock code={code} language="mermaid" />
      {outcome && (
        <p className="-mt-1 mb-2 px-1 text-meta text-muted" data-mermaid-error="">
          Couldn't draw this diagram.
        </p>
      )}
    </div>
  );
});

function Diagram({ code, svg }: { code: string; svg: string }) {
  const [open, setOpen] = useState(false);
  const size = useMemo(() => svgSize(svg), [svg]);
  const style = size ? ({ '--mermaid-min': `${minDiagramWidth(size.width)}px` } as CSSProperties) : undefined;
  const preview = (
    <div className="group/diagram relative">
      <div
        // The SVG is what Mermaid returned under `securityLevel: 'strict'`. A wide diagram shrinks to fit, down to a readable size, then scrolls sideways.
        className={`overflow-x-auto py-2 select-text [&_svg]:mx-auto [&_svg]:min-w-(--mermaid-min) ${size ? 'cursor-zoom-in' : ''}`}
        style={style}
        onClick={() => size && !window.getSelection()?.toString() && setOpen(true)}
        dangerouslySetInnerHTML={{ __html: svg }}
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
      {open && size && createPortal(<MermaidOverlay svg={svg} size={size} onClose={() => setOpen(false)} />, document.body)}
    </div>
  );
}
