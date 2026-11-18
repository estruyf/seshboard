/** What Quick open's field asks for: the name to look for, and a line when it ends in `:42`. */
export function parseQuickOpen(text: string): { query: string; line: number | undefined } {
  const match = /^(.*?):(\d+)(?::\d+)?$/.exec(text.trim());
  if (!match) return { query: text.trim(), line: undefined };
  const line = Number(match[2]);
  return { query: match[1]!.trim(), line: line > 0 ? line : undefined };
}

/** Where `query`'s letters fall in `text`, for marking them: a run where the query is in it whole, else each letter in turn. */
export function matchedLetters(text: string, query: string): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const t = text.toLowerCase();
  const at = t.indexOf(q);
  if (at >= 0) return Array.from({ length: q.length }, (_, i) => at + i);
  const out: number[] = [];
  let from = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, from);
    if (found < 0) return [];
    out.push(found);
    from = found + 1;
  }
  return out;
}
