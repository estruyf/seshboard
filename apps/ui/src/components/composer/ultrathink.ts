/** The word that runs one turn at xhigh effort in Claude Code, without changing the session's effort. */
export const ULTRATHINK = 'ultrathink';

/** A fresh regex each time: a shared one with the `g` flag keeps its `lastIndex` between calls. */
const word = () => /\bultrathink\b/gi;

/** The text holds the word, in any case, as a whole word (`ultrathinking` and `nonultrathink` don't count). */
export function hasUltrathink(text: string): boolean {
  return word().test(text);
}

/** A stretch of the message: the word itself (`hit`) or what is around it. */
export interface UltrathinkPart {
  text: string;
  hit: boolean;
}

/** The text cut around each ultrathink, in order, so the message box can colour the word. Joined, the parts are the text. */
export function splitUltrathink(text: string): UltrathinkPart[] {
  const parts: UltrathinkPart[] = [];
  let from = 0;
  for (const match of text.matchAll(word())) {
    if (match.index > from) parts.push({ text: text.slice(from, match.index), hit: false });
    parts.push({ text: match[0], hit: true });
    from = match.index + match[0].length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), hit: false });
  return parts;
}

/**
 * The message with ultrathink on its end, for the option that arms it for one message. A message that already has the
 * word goes as it is, so it is never there twice.
 */
export function withUltrathink(text: string): string {
  if (hasUltrathink(text)) return text;
  const body = text.trimEnd();
  return body ? `${body} ${ULTRATHINK}` : ULTRATHINK;
}
