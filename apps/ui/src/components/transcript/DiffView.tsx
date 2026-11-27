import { diffLines } from 'diff';
import { memo, useMemo, useState } from 'react';
import { useHighlightedLines } from './useHighlightedLines.ts';

export interface DiffLine {
  kind: 'add' | 'del' | 'same';
  text: string;
}

/** Line diff of two snippets, trimmed to changed lines plus a little context. */
export function computeDiff(before: string, after: string, context = 2): Array<DiffLine | { kind: 'gap'; count: number }> {
  const lines: DiffLine[] = [];
  for (const part of diffLines(before, after)) {
    const kind = part.added ? 'add' : part.removed ? 'del' : 'same';
    const text = part.value.endsWith('\n') ? part.value.slice(0, -1) : part.value;
    for (const line of text.split('\n')) lines.push({ kind, text: line });
  }
  // Keep `context` unchanged lines around each change; fold the rest.
  const keep = lines.map((l) => l.kind !== 'same');
  lines.forEach((l, i) => {
    if (l.kind === 'same') return;
    for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) keep[j] = true;
  });
  const out: Array<DiffLine | { kind: 'gap'; count: number }> = [];
  let gap = 0;
  lines.forEach((line, i) => {
    if (keep[i]) {
      if (gap) out.push({ kind: 'gap', count: gap });
      gap = 0;
      out.push(line);
    } else {
      gap++;
    }
  });
  if (gap) out.push({ kind: 'gap', count: gap });
  return out;
}

const COLLAPSED_LINES = 14;

/** Inline diff for Edit/MultiEdit/Write cards, collapsed to the first lines until expanded. */
export const DiffView = memo(function DiffView({
  hunks,
  truncated,
  language,
  syntaxKey = '',
}: {
  hunks: Array<{ before: string; after: string }>;
  truncated?: boolean;
  /** The file's language (`languageFromPath`): its lines in the theme's code colours. Without one, plain text. */
  language?: string;
  /** The theme store's syntax key, so the lines highlight again when the code colours change. */
  syntaxKey?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(() => hunks.flatMap((h, i) => [...(i > 0 ? [{ kind: 'gap' as const, count: 0 }] : []), ...computeDiff(h.before, h.after)]), [hunks]);
  const codeRows = useMemo(() => {
    const index = new Map<number, number>();
    const texts: string[] = [];
    rows.forEach((row, i) => {
      if (row.kind === 'gap') return;
      index.set(i, texts.length);
      texts.push(row.text);
    });
    return { index, texts };
  }, [rows]);
  const lineHtml = useHighlightedLines(codeRows.texts, language, syntaxKey);
  const added = rows.filter((r) => r.kind === 'add').length;
  const removed = rows.filter((r) => r.kind === 'del').length;
  const visible = expanded ? rows : rows.slice(0, COLLAPSED_LINES);

  return (
    <div className="mt-1.5 overflow-hidden rounded-md border border-border bg-code font-mono text-ui leading-[1.55] select-text" data-diff>
      <div className="overflow-x-auto">
        {visible.map((row, i) =>
          row.kind === 'gap' ? (
            <div key={i} className="bg-border/30 px-3 text-faint">
              {row.count > 0 ? `⋯ ${row.count} unchanged line${row.count === 1 ? '' : 's'}` : '⋯'}
            </div>
          ) : (
            <div
              key={i}
              data-diff-kind={row.kind}
              className={`flex whitespace-pre ${row.kind === 'add' ? 'bg-diff-added text-text' : row.kind === 'del' ? 'bg-diff-removed text-text/80' : 'text-muted'}`}
            >
              <span className={`w-5 shrink-0 text-center select-none ${row.kind === 'add' ? 'text-ok' : row.kind === 'del' ? 'text-error' : 'text-faint'}`}>
                {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}
              </span>
              {lineHtml && codeRows.index.has(i) && row.text ? (
                // Shiki escapes the code; the HTML is spans with colour variables only.
                <span className="shiki pr-3" dangerouslySetInnerHTML={{ __html: lineHtml[codeRows.index.get(i)!]! }} />
              ) : (
                <span className="pr-3">{row.text || ' '}</span>
              )}
            </div>
          ),
        )}
      </div>
      <div className="flex items-center gap-3 border-t border-border bg-sidebar px-3 py-1 text-meta text-muted" data-diff-counts>
        <span className="text-ok">
          +{added}
          <span className="sr-only"> lines added,</span>
        </span>
        <span className="text-error">
          −{removed}
          <span className="sr-only"> lines removed</span>
        </span>
        {truncated && <span>long content shortened</span>}
        <span className="flex-1" />
        {rows.length > COLLAPSED_LINES && (
          <button type="button" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded} className="hover:text-text">
            {expanded ? 'Show less' : `Show all ${rows.length} lines`}
          </button>
        )}
      </div>
    </div>
  );
});
