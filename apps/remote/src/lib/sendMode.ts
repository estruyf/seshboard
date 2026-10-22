import type { SendMode } from '@switchboard/protocol/remote-client';
import { modKey, type KeyEventLike } from './keys.ts';

/**
 * The ways to send while Claude works, as on the computer: Queue waits in Up next until the turn ends, Steer gives the
 * message to Claude now, to read at its next step, and Send now stops Claude first. Send does Queue; the menu next to
 * it has all three, with the keys that do the same in the message box.
 */
export const SEND_MODES: ReadonlyArray<{ mode: SendMode; label: string; shortcut: string }> = [
  { mode: 'queue', label: 'Queue', shortcut: 'enter' },
  { mode: 'steer', label: 'Steer', shortcut: 'alt+enter' },
  { mode: 'now', label: 'Send now', shortcut: 'mod+shift+enter' },
];

export const SEND_MODES_NOTE = 'Queue holds it in Up next until Claude finishes. Steer gives it to Claude now, and Claude reads it at its next step. Send now stops Claude first.';

/**
 * What a key in the message box sends, with a keyboard: Enter (and ⌘↵) queues, Shift+Enter is a new line, ⌥↵ steers
 * and ⌘⇧↵ (Ctrl+Shift+Enter) sends now, as on the computer. Null: the key is typing. While Claude isn't working, each
 * just sends.
 */
export function sendKey(event: KeyEventLike, mac: boolean): SendMode | null {
  if (event.key !== 'Enter' || event.isComposing) return null;
  // The other platform's modifier with it is someone else's shortcut.
  if (mac ? event.ctrlKey : event.metaKey) return null;
  if (event.shiftKey) return modKey(event, mac) && !event.altKey ? 'now' : null;
  return event.altKey ? 'steer' : 'queue';
}
