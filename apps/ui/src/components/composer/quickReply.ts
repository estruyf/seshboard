/** What the message box holds when it decides whether to offer Claude Code's suggested reply. */
export interface QuickReplyBox {
  /** Claude Code's guess at your next message (`SessionHostInfo.suggestion`), or nothing. */
  reply: string | null | undefined;
  /** Settings › Conversation › Suggested replies. */
  enabled: boolean;
  text: string;
  chips: number;
  attachments: number;
  /** A saved prompt is being filled in, or the box asks about the session (`/btw`). */
  busyWith: boolean;
  running: boolean;
  disabled: boolean;
}

/**
 * The reply to offer, as a chip that sends it and as grey text that Tab puts in the box: only in an empty box, after
 * a turn, so it never covers or joins what you wrote. Null: none.
 */
export function quickReplyOf(box: QuickReplyBox): string | null {
  const reply = box.reply?.trim();
  if (!reply || !box.enabled || box.running || box.disabled || box.busyWith) return null;
  if (box.text !== '' || box.chips > 0 || box.attachments > 0) return null;
  return reply;
}

/** The chip shows a long reply cut to this many characters; its tooltip has it whole. */
export const QUICK_REPLY_CHIP_MAX = 60;

/** A reply as its chip shows it, on one line. */
export function quickReplyLabel(reply: string): string {
  const line = reply.replace(/\s+/g, ' ');
  return line.length > QUICK_REPLY_CHIP_MAX ? `${line.slice(0, QUICK_REPLY_CHIP_MAX - 1).trimEnd()}…` : line;
}

/** Settings › Conversation's "Suggested replies", in the settings and in their search. */
export const QUICK_REPLY_DETAIL = 'After Claude finishes, the message box offers the reply Claude Code expects from you, such as "go". Click it to send it, or press Tab to put it in the box. Only for Claude Code sessions.';
