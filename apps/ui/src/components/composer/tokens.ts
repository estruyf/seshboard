/**
 * Finds the `/command`, `@path` or `#issue` token the caret is in; each starts the text or follows whitespace. A `#`
 * in the middle of a word (`C#`, a URL's `#fragment`) or after another `#` (a Markdown heading) is plain text.
 */
export function tokenAtCaret(text: string, caret: number): { kind: 'slash' | 'file' | 'issue'; start: number; query: string } | null {
  const before = text.slice(0, caret);
  const slash = /(^|\s)\/([\w:.-]*)$/.exec(before);
  if (slash) return { kind: 'slash', start: caret - slash[2]!.length - 1, query: slash[2]! };
  const at = /(^|\s)@([^\s@]*)$/.exec(before);
  if (at) return { kind: 'file', start: caret - at[2]!.length - 1, query: at[2]! };
  const hash = /(^|\s)#([^\s#]*)$/.exec(before);
  if (hash) return { kind: 'issue', start: caret - hash[2]!.length - 1, query: hash[2]! };
  return null;
}
