import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { highlight } from '../../lib/highlight.ts';
import { useThemes } from '../../state/themeStore.ts';
import { lineBlocks, lineRange, plainLines, shikiLines, type LineRange } from './sourceLines.ts';

/** From this many lines, blocks off screen are skipped by the browser (`content-visibility`), so a long file scrolls smoothly. */
const SKIP_FROM = 2_000;
/** A line's height at `text-ui leading-relaxed`, for the size of a block the browser has not drawn yet. */
const LINE_PX = 19.5;

const idle = (fn: () => void) => {
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(fn, { timeout: 500 });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 1);
  return () => clearTimeout(id);
};

interface SourceViewProps {
  code: string;
  /** The grammar (`ts`, `markdown`); undefined shows plain text. */
  language: string | undefined;
  wrap: boolean;
  /** The line a link pointed at, and the end of its range: scrolled to and marked. */
  line?: number | undefined;
  endLine?: number | undefined;
  /** Changes on every open, so opening the same lines again scrolls back to them. */
  seq: number;
}

/**
 * A file's text as an editor shows it: a line number beside each line, on the code background from edge to edge, plain
 * at once and syntax-coloured once the browser is idle. The lines a link pointed at are marked and scrolled to the middle.
 * It scrolls itself; the numbers stay put when a long line scrolls sideways.
 */
export const SourceView = memo(function SourceView({ code, language, wrap, line, endLine, seq }: SourceViewProps) {
  const syntaxKey = useThemes((s) => s.syntaxKey);
  const [highlighted, setHighlighted] = useState<{ code: string; language: string | undefined; syntaxKey: string; lines: string[] | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const cancelIdle = idle(() => {
      void highlight(code, language).then((html) => !cancelled && setHighlighted({ code, language, syntaxKey, lines: html ? shikiLines(html) : null }));
    });
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [code, language, syntaxKey]);

  const html = highlighted && highlighted.code === code && highlighted.language === language && highlighted.syntaxKey === syntaxKey ? highlighted.lines : null;
  const plain = useMemo(() => plainLines(code), [code]);
  const count = html?.length ?? plain.length;
  const range = lineRange(line, endLine, count);
  const gutter = `calc(${String(count).length}ch + 1.75rem)`;

  const boxRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!range || scrolledFor.current === seq) return;
    scrolledFor.current = seq;
    const row = boxRef.current?.querySelector(`[data-line="${range.start}"]`);
    row?.scrollIntoView({ block: 'center' });
    // Blocks above it that were never drawn had a guessed height: once they are, it is where it belongs.
    if (count >= SKIP_FROM) requestAnimationFrame(() => row?.scrollIntoView({ block: 'center' }));
  }, [seq, range?.start, count]);

  const blocks = useMemo(() => lineBlocks<string>(html ?? plain), [html, plain]);
  return (
    <div ref={boxRef} tabIndex={0} aria-label="Source" className="min-h-0 flex-1 overflow-auto bg-code py-2 select-text outline-none focus-visible:ring-1 focus-visible:ring-focus-ring focus-visible:ring-inset" data-file-preview-source="" data-wrap={wrap ? 'on' : 'off'}>
      <div className={`shiki font-mono text-ui leading-relaxed ${wrap ? 'w-full' : 'w-max min-w-full'}`}>
        {blocks.map((block) => (
          <SourceBlock key={block.first} first={block.first} lines={block.lines} html={html !== null} wrap={wrap} range={range} gutter={gutter} skip={count >= SKIP_FROM} />
        ))}
      </div>
    </div>
  );
});

/** Rows of one block. Marked rows get the accent tint and a rail in the gutter. */
function SourceBlock({ first, lines, html, wrap, range, gutter, skip }: { first: number; lines: readonly string[]; html: boolean; wrap: boolean; range: LineRange | null; gutter: string; skip: boolean }) {
  return (
    <div style={skip ? { contentVisibility: 'auto', containIntrinsicBlockSize: `auto ${Math.ceil(lines.length * LINE_PX)}px` } : undefined}>
      {lines.map((text, i) => {
        const n = first + i;
        const marked = range !== null && n >= range.start && n <= range.end;
        return (
          <div key={n} className={`flex ${marked ? 'bg-accent/15' : ''}`} data-line={n} data-line-marked={marked ? '' : undefined}>
            {/* A div, not a span: Shiki's colours go on every span inside `.shiki`. */}
            <div
              className={`sticky left-0 shrink-0 pr-4 pl-3 text-right tabular-nums select-none ${marked ? 'bg-[color-mix(in_oklab,var(--color-accent)_15%,var(--color-code))] text-text shadow-[inset_2px_0_0_var(--color-accent-ink)]' : 'bg-code text-faint'}`}
              style={{ minWidth: gutter }}
              aria-hidden
            >
              {n}
            </div>
            {html ? (
              // Shiki escapes the code; the HTML is spans with colour variables only.
              <div className={wrap ? 'min-w-0 flex-1 pr-3 whitespace-pre-wrap [overflow-wrap:anywhere]' : 'pr-6 whitespace-pre'} dangerouslySetInnerHTML={{ __html: text }} />
            ) : (
              <div className={wrap ? 'min-w-0 flex-1 pr-3 whitespace-pre-wrap [overflow-wrap:anywhere]' : 'pr-6 whitespace-pre'}>{text}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
