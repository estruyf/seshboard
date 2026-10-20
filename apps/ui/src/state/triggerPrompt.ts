// A trigger's prompt in the editor: where `{{event.<field>}}` chips are, what `{{` is asking for, and putting a field
// in. Plain functions, tested on their own.

const FIELD = /\{\{\s*event\.[A-Za-z0-9_]+\s*\}\}/g;

/** The prompt as runs of text and fields (`field` is the field's name), for drawing the chips. */
export function promptSegments(text: string): Array<{ text: string; field: string | null }> {
  const out: Array<{ text: string; field: string | null }> = [];
  let from = 0;
  for (const match of text.matchAll(FIELD)) {
    if (match.index > from) out.push({ text: text.slice(from, match.index), field: null });
    out.push({ text: match[0], field: /event\.([A-Za-z0-9_]+)/.exec(match[0])![1]! });
    from = match.index + match[0].length;
  }
  if (from < text.length || out.length === 0) out.push({ text: text.slice(from), field: null });
  return out;
}

/** What `{{` before the caret asks for: where it starts, and the part of a field's name typed after it. Null otherwise. */
export function fieldQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /\{\{\s*(?:event\.?)?([A-Za-z0-9_]*)$/.exec(before);
  if (!match) return null;
  // `{{event.title}}` already closed: the caret is after it, not in it.
  if (/\}\}$/.test(before)) return null;
  return { start: match.index, query: match[1] ?? '' };
}

/** Puts `{{event.<name>}}` in place of what was typed from `start` to the caret; the caret goes after it. */
export function insertField(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const field = `{{event.${name}}}`;
  // A `}}` typed already after the caret is the field's own end.
  const rest = text.slice(caret).replace(/^\s*\}\}/, '');
  return { text: `${text.slice(0, start)}${field}${rest}`, caret: start + field.length };
}
