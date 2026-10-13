/*
 * The `/btw` token at the start of the message box: while it is there, the box asks a side question instead of
 * sending a message. Pure helpers, so the rules can be tested without React.
 */

export const SIDE_COMMAND = 'btw';
export const SIDE_TOKEN = `/${SIDE_COMMAND}`;
export const SIDE_DESCRIPTION = 'Ask a side question. Not added to the conversation.';

/**
 * Text that starts with `/btw ` (typed, or a draft kept with the token): the token and the question after it.
 * `/btw` alone stays text until a space follows, so `/btwx` or a command that starts the same way still works.
 */
export function splitSideToken(text: string): { token: boolean; question: string } {
  return text.startsWith(`${SIDE_TOKEN} `) ? { token: true, question: text.slice(SIDE_TOKEN.length + 1) } : { token: false, question: text };
}

/** The box's text as a draft keeps it: with the token written out, so it comes back as a token. */
export function joinSideToken(token: boolean, text: string): string {
  return token ? `${SIDE_TOKEN} ${text}` : text;
}

/**
 * Puts `/btw` in the slash menu's list (Claude Code's own `/btw` is left out: the terminal's panel can't show
 * here). It comes first for a query it starts with (`/b`), and in its alphabetical place otherwise.
 */
export function withSideCommand<T extends { value: string }>(items: readonly T[], query: string, item: T): T[] {
  const rest = items.filter((i) => i.value !== SIDE_TOKEN);
  const q = query.toLowerCase();
  if (!SIDE_COMMAND.includes(q)) return rest;
  if (q && SIDE_COMMAND.startsWith(q)) return [item, ...rest];
  const name = (i: T) => i.value.slice(1).toLowerCase();
  const at = rest.findIndex((i) => !(q && name(i).startsWith(q)) && name(i).localeCompare(SIDE_COMMAND) > 0);
  return at < 0 ? [...rest, item] : [...rest.slice(0, at), item, ...rest.slice(at)];
}

/**
 * What a key does while the token is in the box: `ask` for every way of sending (Enter, and the keys that would
 * steer, queue or send now), so a side question never reaches the conversation or Up next; `untoken` for Backspace
 * right after the token, which turns the box back into a message. Null: the key does what it always does.
 */
export function sideKey(
  key: { key: string; metaKey: boolean; altKey: boolean; ctrlKey: boolean },
  box: { token: boolean; selectionStart: number; selectionEnd: number; sends: boolean },
): 'ask' | 'untoken' | null {
  if (!box.token) return null;
  if (key.key === 'Backspace' && box.selectionStart === 0 && box.selectionEnd === 0 && !key.metaKey && !key.altKey && !key.ctrlKey) return 'untoken';
  return box.sends ? 'ask' : null;
}
