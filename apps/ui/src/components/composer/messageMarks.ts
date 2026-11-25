import { splitUltrathink } from './ultrathink.ts';

/**
 * The slash command a message starts with, when Claude Code knows it: `/design` in `/design make it blue`. The same
 * check as the engine's `commandEcho`, so the box marks what will run as a command and nothing else: a path such as
 * `/tmp`, or a command later in the text, stays plain. `end` is where the name stops in `text` (after any spaces the
 * message starts with).
 */
export function leadingCommand(text: string, commands: Iterable<string>): { name: string; end: number } | null {
  const match = /^(\s*)\/(\S+)/.exec(text);
  if (!match) return null;
  const name = match[2]!;
  for (const known of commands) if (known === name) return { name, end: match[0].length };
  return null;
}

/** A stretch of the message: the leading command, the word ultrathink, or plain text (`null`). */
export interface MessageMark {
  text: string;
  mark: 'command' | 'ultrathink' | null;
}

/**
 * The message cut into what the box draws in colour, in order. Joined, the parts are the text. `commands` are the
 * names the session knows; `ultrathink` says whether the word is coloured in this box.
 */
export function splitMarks(text: string, { commands, ultrathink }: { commands: Iterable<string>; ultrathink: boolean }): MessageMark[] {
  const command = leadingCommand(text, commands);
  const parts: MessageMark[] = [];
  let rest = text;
  if (command) {
    const spaces = text.length - text.trimStart().length;
    if (spaces) parts.push({ text: text.slice(0, spaces), mark: null });
    parts.push({ text: text.slice(spaces, command.end), mark: 'command' });
    rest = text.slice(command.end);
  }
  if (!ultrathink) {
    if (rest) parts.push({ text: rest, mark: null });
    return parts;
  }
  for (const part of splitUltrathink(rest)) parts.push({ text: part.text, mark: part.hit ? 'ultrathink' : null });
  return parts;
}

/** Whether the box has anything to colour, so the copy under it is drawn at all. */
export const hasMarks = (parts: MessageMark[]): boolean => parts.some((part) => part.mark !== null);
