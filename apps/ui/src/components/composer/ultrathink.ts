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
 * word goes as it is, so it is never there twice. A message of several lines gets it on a line of its own after a blank
 * one: its last line may be a list item, a quote or a code fence, which would take the word as part of itself.
 */
export function withUltrathink(text: string): string {
  if (hasUltrathink(text)) return text;
  const body = text.trimEnd();
  if (!body) return ULTRATHINK;
  return body.includes('\n') ? `${body}\n\n${ULTRATHINK}` : `${body} ${ULTRATHINK}`;
}

/**
 * What a send does with "Ultrathink this turn". `typed` is what goes out (with the word when it applies) and `consume`
 * says the option is used up. Not armed: nothing. A steer goes into the turn that is running, which keeps its effort, so
 * the word would do nothing: it stays armed for the next message that starts a turn (a queued one, or Send now). A slash
 * command would take the word as an argument: it stays armed too.
 */
export function ultrathinkSend(typed: string, { armed, steer }: { armed: boolean; steer: boolean }): { typed: string; consume: boolean } {
  if (!armed || steer || typed.trimStart().startsWith('/')) return { typed, consume: false };
  return { typed: withUltrathink(typed), consume: true };
}

/** Efforts that already are what the word asks for: the option is not offered. */
export const ULTRATHINK_NEEDLESS = ['xhigh', 'max'] as const;

/** Whether "Ultrathink this turn" is offered at this effort ('' is the default). */
export const offersUltrathink = (effort: string): boolean => !(ULTRATHINK_NEEDLESS as readonly string[]).includes(effort);
