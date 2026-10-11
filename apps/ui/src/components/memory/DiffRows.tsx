import { useMemo } from 'react';
import { parseUnifiedDiff } from '../../lib/unifiedDiff.ts';

/** A unified diff as rows: added lines in the added tint with a `+`, removed ones in the removed tint with a `−`. */
export function DiffRows({ diff }: { diff: string }) {
  const rows = useMemo(() => parseUnifiedDiff(diff), [diff]);
  return (
    <>
      {rows.map((row, i) =>
        row.kind === 'hunk' ? (
          <div key={i} className="bg-border/30 px-3 text-faint">
            @@ {row.text}
          </div>
        ) : row.kind === 'note' ? (
          <div key={i} className="px-3 text-faint italic">
            {row.text}
          </div>
        ) : (
          <div key={i} className={`flex ${row.kind === 'add' ? 'bg-diff-added' : row.kind === 'del' ? 'bg-diff-removed text-text/80' : 'text-muted'}`} data-share-line={row.kind}>
            <span className={`w-6 shrink-0 text-center select-none ${row.kind === 'add' ? 'text-ok' : row.kind === 'del' ? 'text-error' : 'text-faint'}`}>{row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}</span>
            <span className="min-w-0 pr-3 break-words whitespace-pre-wrap">{row.text || ' '}</span>
          </div>
        ),
      )}
    </>
  );
}
