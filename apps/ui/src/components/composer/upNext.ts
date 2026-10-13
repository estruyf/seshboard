import type { ImageAttachment, QueuedMessage, SessionHostInfo } from '@switchboard/protocol/client';

/** The first line that has something on it, cut to `max` characters. A long message shows in full in its tooltip. */
export function firstLine(text: string, max = 160): string {
  const line = text.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** What a queued message shows when it has no text, or next to its text: its images. */
export function attachmentLabel(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  return names.length === 1 ? names[0]! : `${names.length} images`;
}

/** The heading of the list: "Up next" and how many are waiting. */
export function upNextTitle(count: number): string {
  return count === 1 ? 'Up next · 1 message' : `Up next · ${count} messages`;
}

/**
 * The line that says why nothing is sending by itself. Null while the queue moves on its own: each message goes
 * when the turn before it ends.
 */
export function holdNote(hold: SessionHostInfo['queueHold'], count: number): string | null {
  if (!hold || count === 0) return null;
  const waiting = count === 1 ? '1 message is waiting' : `${count} messages are waiting`;
  return hold === 'stopped' ? `You stopped Claude. ${waiting}.` : `The last turn failed. ${waiting}.`;
}

/** What the message box holds, to merge a message taken back from Up next into. */
export interface BoxContent {
  text: string;
  attachments: ImageAttachment[];
}

/**
 * Edit puts a queued message back in the message box. An empty box just takes it; one with something typed keeps
 * that, with the taken message under it, so nothing you were writing is lost.
 */
export function mergeIntoBox(current: BoxContent, taken: BoxContent): BoxContent {
  const typed = current.text.trim() !== '';
  return {
    text: typed ? (taken.text.trim() ? `${current.text.replace(/\s+$/, '')}\n\n${taken.text}` : current.text) : taken.text,
    attachments: [...current.attachments, ...taken.attachments],
  };
}

/** The queue entry ↑ brings back from an empty message box: the one sent last. */
export function lastQueued(queue: readonly QueuedMessage[]): QueuedMessage | null {
  return queue.at(-1) ?? null;
}

/** Where focus goes after a row leaves the list: the one now in its place, else the one before it. */
export function focusAfterRemoval(ids: readonly string[], removed: string): string | null {
  const at = ids.indexOf(removed);
  if (at === -1) return null;
  return ids[at + 1] ?? ids[at - 1] ?? null;
}
