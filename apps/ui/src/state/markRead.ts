import type { MarkReadAfter } from '@seshboard/protocol/bridge';

/** Activity that arrives while you look at a session is read almost at once: you watched it happen. */
export const SEEN_WHILE_LOOKING_MS = 600;

export interface MarkReadInput {
  unread: boolean;
  /** Marked as unread while open: it stays so until you leave the session. */
  keptUnread: boolean;
  /** Unread when you started looking: you opened it unread, or came back to the window after it changed. */
  unreadWhenLooked: boolean;
  /** How long you have been looking at it, in ms. */
  lookedFor: number;
  /** Settings › Sessions: "Mark as read after". */
  setting: MarkReadAfter;
}

/**
 * How long until a session you are looking at is marked read, in ms, or null when it stays unread. One you opened
 * unread waits the seconds you set (like a mail client's reading pane), so passing through doesn't read it.
 */
export function markReadDelay(input: MarkReadInput): number | null {
  if (!input.unread || input.keptUnread) return null;
  if (!input.unreadWhenLooked) return SEEN_WHILE_LOOKING_MS;
  if (!input.setting.enabled) return null;
  return Math.max(0, input.setting.seconds * 1000 - input.lookedFor);
}
