import { useEffect, useState } from 'react';
import { highlight, highlightedLines } from '../../lib/highlight.ts';

/**
 * A diff's lines in the code colours of the active theme (one colour with Settings › Theme › Code highlighting off),
 * as HTML per line, or null until they are highlighted (or when the language has no grammar). The lines are
 * highlighted together, so a string or comment over several lines keeps its colour; removed and added lines are mixed,
 * which is close enough for a diff. `syntaxKey` is the theme store's: a new one highlights again. It is a parameter, so
 * a diff can use this without the store (its tests run without a window).
 */
export function useHighlightedLines(lines: readonly string[], language: string | undefined, syntaxKey: string): string[] | null {
  const code = lines.join('\n');
  const [done, setDone] = useState<{ code: string; language: string | undefined; syntaxKey: string; lines: string[] | null } | null>(null);
  useEffect(() => {
    if (!language || !code) return;
    let cancelled = false;
    void highlight(code, language).then((html) => {
      if (cancelled) return;
      const out = html ? highlightedLines(html) : null;
      setDone({ code, language, syntaxKey, lines: out && out.length === lines.length ? out : null });
    });
    return () => {
      cancelled = true;
    };
    // `lines` is `code` split again; the code says when it changed.
  }, [code, language, syntaxKey]);
  return done && done.code === code && done.language === language && done.syntaxKey === syntaxKey ? done.lines : null;
}
