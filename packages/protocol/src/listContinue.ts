/** Text to put in place of `from`–`to`, and what to select after it (the caret after the text by default). */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
  select?: [number, number];
}

/** `- `, `* `, `+ `, `1. ` or `1) `, indented or not, with an optional `[ ]` task box. */
const ITEM = /^(\s*)(?:([-*+])|(\d{1,9})([.)]))( +)(\[[ xX]\] +)?/;

/**
 * What a new line does on a list item (⇧↵ on the computer, Return on a phone's keyboard): the next item, numbered
 * one up, unchecked, at the same indent. On an empty item it ends the list instead, leaving the line blank. Null
 * outside a list, where it is a plain new line. Shared by the app's message boxes and the remote app's.
 */
export function continueList(text: string, start: number, end: number): TextEdit | null {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const match = ITEM.exec(text.slice(lineStart, start));
  if (!match) return null;
  const lineEnd = text.indexOf('\n', end);
  const rest = text.slice(end, lineEnd === -1 ? text.length : lineEnd);
  if (!text.slice(lineStart + match[0].length, start).trim() && !rest.trim()) return { from: lineStart, to: end, insert: '' };
  const [, indent, bullet, number, delimiter, space, task] = match;
  const marker = bullet ?? `${Number(number) + 1}${delimiter}`;
  return { from: start, to: end, insert: `\n${indent}${marker}${space}${task ? '[ ] ' : ''}` };
}
