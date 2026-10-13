import type { ShortcutId } from '../../lib/shortcuts.ts';

/** What the message box's send button can do while Claude is working. */
export type QueueAction = 'queue' | 'steer' | 'send-now';

export interface QueueButtonInput {
  /** Why nothing can be sent (connecting, the folder is unknown). */
  blocked: string | null;
  /** On its way: every part waits. */
  sending: boolean;
  /** Something to send: text, images or context. */
  hasMessage: boolean;
  /** What Enter does (Settings › Conversation): the main part of the button, and the first item of its menu. */
  whileWorking: 'queue' | 'steer';
}

export interface QueueMenuItem {
  action: QueueAction;
  label: string;
  /** The key that does the same without the menu. */
  shortcut: ShortcutId;
  disabled: boolean;
}

export interface QueueButtonState {
  label: string;
  sending: boolean;
  /** The main part and the ▾ alike: both send what is in the box. */
  disabled: boolean;
  /** Why nothing can be sent, shown over the whole button. */
  reason: string | null;
  items: QueueMenuItem[];
}

const LABEL: Record<QueueAction, string> = { queue: 'Queue', steer: 'Steer', 'send-now': 'Send now' };

/**
 * The split button while Claude is working. The main part does what Enter does (Queue: hold the message in Up
 * next until the turn ends, or Steer: give it to Claude now, to read at its next step). The ▾ lists the other way
 * (⌥↵) and Send now (⌘⇧↵), which stops Claude so the message runs at once.
 */
export function queueButtonState({ blocked, sending, hasMessage, whileWorking }: QueueButtonInput): QueueButtonState {
  const disabled = Boolean(blocked) || sending || !hasMessage;
  const other: QueueAction = whileWorking === 'queue' ? 'steer' : 'queue';
  return {
    label: sending ? 'Sending…' : LABEL[whileWorking],
    sending,
    disabled,
    reason: sending ? null : (blocked ?? (!hasMessage ? 'Type a message first' : null)),
    items: [
      { action: whileWorking, label: LABEL[whileWorking], shortcut: 'composer.send', disabled },
      { action: other, label: LABEL[other], shortcut: 'composer.send-other', disabled },
      { action: 'send-now', label: LABEL['send-now'], shortcut: 'composer.send-now', disabled },
    ],
  };
}
