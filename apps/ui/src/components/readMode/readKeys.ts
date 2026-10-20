import { matches, type ShortcutId } from '../../lib/shortcuts.ts';

/** What reading mode's keys are asked about: where the key press came from and what is open. */
export interface ReadKeyFocus {
  /** A text field, a select or a contentEditable has the focus. */
  typing: boolean;
  /** The focus is in a toolbar (the selection popover), which moves with the arrow keys itself. */
  inToolbar: boolean;
  /** A menu or dialog is open. */
  overlay: boolean;
  /** The session list is over the page. */
  sidebar: boolean;
  /** Text is selected in the reply's column. */
  selection: boolean;
}

export type ReadKeyAction = 'previous' | 'next' | 'previous-heading' | 'next-heading' | 'bigger' | 'smaller' | 'reply';

const KEYS: readonly (readonly [ShortcutId, ReadKeyAction])[] = [
  ['read.previous', 'previous'],
  ['read.next', 'next'],
  ['read.previous-heading', 'previous-heading'],
  ['read.next-heading', 'next-heading'],
  ['read.bigger', 'bigger'],
  ['read.smaller', 'smaller'],
  ['read.reply', 'reply'],
];

/**
 * What a key press does in reading mode, or null when it is not for reading mode: another shortcut's modifiers,
 * a field being typed in, an open menu, dialog or session list, or R without a selection (nothing to quote).
 */
export function readModeKey(event: Parameters<typeof matches>[0] & { isComposing?: boolean; defaultPrevented?: boolean }, focus: ReadKeyFocus): ReadKeyAction | null {
  if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return null;
  if (focus.typing || focus.inToolbar || focus.overlay || focus.sidebar) return null;
  // `+` is typed with Shift on most layouts; the registry's `plus` is the bare key.
  const pressed = event.key === '+' ? { ...event, shiftKey: false } : event;
  const action = KEYS.find(([id]) => matches(pressed, id))?.[1] ?? null;
  return action === 'reply' && !focus.selection ? null : action;
}
