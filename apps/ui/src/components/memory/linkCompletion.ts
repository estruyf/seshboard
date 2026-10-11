/** The name typed so far after `[[` right before the caret, or null when the caret isn't in an unfinished link. */
export function linkQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  const match = /\[\[([^\]\n|[]*)$/.exec(before);
  return match ? match[1]! : null;
}

/** The names that match what was typed (start of the name first, then anywhere), at most `limit`. */
export function linkSuggestions(names: Iterable<string>, query: string, limit = 8): string[] {
  const q = query.trim().toLowerCase();
  const all = [...new Set(names)].sort((a, b) => a.localeCompare(b));
  const starts = all.filter((n) => n.toLowerCase().startsWith(q));
  const contains = all.filter((n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q));
  return [...starts, ...contains].slice(0, limit);
}

/** The text with the unfinished link before the caret completed as `[[name]]`, and where the caret goes (after it). */
export function completeLink(text: string, caret: number, name: string): { text: string; caret: number } {
  const query = linkQuery(text, caret);
  if (query === null) return { text, caret };
  const start = caret - query.length;
  // `]]` the editor already has after the caret (typed by hand) isn't doubled.
  const closing = text.startsWith(']]', caret) ? '' : ']]';
  const next = `${text.slice(0, start)}${name}${closing}${text.slice(caret)}`;
  return { text: next, caret: start + name.length + 2 };
}
