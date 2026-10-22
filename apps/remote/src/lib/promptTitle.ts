import type { RemoteMessage } from '@switchboard/protocol/remote-client';

/**
 * What a session was asked, for the catch-up's "You asked": the prompt's title, and the whole prompt behind "Show the
 * prompt". Pure, with tests.
 */

/** A code fence's opening or closing line (``` or ~~~, with or without a language). */
const FENCE = /^\s*(```|~~~)/;
/** An ATX heading: one to six `#`, a space, the text, and any closing `#`s. */
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;

/**
 * The prompt's title: its first Markdown heading without the `#`s, else its first sentence. Headings inside a code
 * fence don't count, and neither does a fence's code for the sentence.
 */
export function promptTitle(text: string): string {
  const lines = text.split(/\r?\n/);
  const prose: string[] = [];
  let fenced = false;
  for (const line of lines) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = HEADING.exec(line);
    if (heading?.[1]) return heading[1];
    prose.push(line);
  }
  const paragraph = prose.join('\n').trim().split(/\n\s*\n/)[0] ?? '';
  const flat = paragraph.replace(/\s+/g, ' ').trim();
  const sentence = /^(.+?[.!?])(\s|$)/.exec(flat)?.[1];
  return sentence ?? flat;
}

/**
 * The prompt of the turn that ended with `turnId` (the catch-up's): the last message you sent before it, as text.
 * Null when it isn't in the messages loaded (an older page) or has no text.
 */
export function turnPrompt(messages: readonly RemoteMessage[], turnId: string): string | null {
  const end = messages.findIndex((m) => m.uuid === turnId);
  for (let i = (end < 0 ? messages.length : end) - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== 'user' || message.parentToolUseId) continue;
    const text = message.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n\n').trim();
    if (text) return text;
  }
  return null;
}

/** Claude's last reply, as its text, for Copy the last reply; null before it said anything. */
export function lastReply(messages: readonly RemoteMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== 'assistant' || message.parentToolUseId) continue;
    const text = message.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n\n').trim();
    if (text) return text;
  }
  return null;
}
