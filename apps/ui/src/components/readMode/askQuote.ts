/**
 * What "Ask about this" puts in the Ask field: the selection as a Markdown quote block and a blank line under it,
 * where the question goes (the caret is placed at the end).
 */
export function askPrefill(selection: string): string {
  const text = selection.trim();
  if (!text) return '';
  return `${text.split('\n').map((line) => `> ${line}`.trimEnd()).join('\n')}\n\n`;
}
