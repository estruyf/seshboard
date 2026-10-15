/**
 * The wide layout's keys: what a key press means, and how a key is written for this reader. Pure: the platform and
 * the focus come in as parameters, so the macOS and Windows rules are tested side by side. One handler in
 * `Connected.tsx` acts on the result.
 */

export type KeyAction = 'palette' | 'next-needs-you' | 'down' | 'up' | 'allow' | 'deny' | 'open' | 'new' | 'escape' | 'help';

export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}

export interface KeyContext {
  /** macOS (and iPadOS): ⌘ is the app's modifier; Ctrl elsewhere. */
  mac: boolean;
  /** A text field, select or contenteditable has the focus: single keys are typing. */
  inField: boolean;
}

/** ⌘ on macOS, Ctrl elsewhere, as the desktop's `modKey`. */
export const modKey = (event: Pick<KeyEventLike, 'metaKey' | 'ctrlKey'>, mac: boolean) => (mac ? event.metaKey : event.ctrlKey);

const SINGLE: Record<string, KeyAction> = { j: 'down', k: 'up', a: 'allow', d: 'deny', n: 'new', u: 'next-needs-you', enter: 'open' };

/**
 * What a key does. ⌘K (Ctrl+K) opens the palette anywhere, also in a field; ⌘⇧U (Ctrl+Shift+U) and U open the next
 * session that needs you (Edge on Windows keeps Ctrl+Shift+U for Read aloud, so U is there too). Single keys only
 * work outside a field and never with a modifier held; `?` is the one that may need Shift to type.
 */
export function keyAction(event: KeyEventLike, context: KeyContext): KeyAction | null {
  if (event.isComposing) return null;
  const key = event.key.toLowerCase();
  const mod = modKey(event, context.mac);
  // The other platform's modifier with it is someone else's shortcut (⌃⌘K on a Mac, Win+Ctrl+K).
  const other = context.mac ? event.ctrlKey : event.metaKey;
  if (mod && !other && !event.altKey) {
    if (key === 'k' && !event.shiftKey) return 'palette';
    if (key === 'u' && event.shiftKey) return 'next-needs-you';
    return null;
  }
  if (key === 'escape' && !event.metaKey && !event.ctrlKey && !event.altKey) return 'escape';
  if (context.inField || event.metaKey || event.ctrlKey || event.altKey) return null;
  if (event.key === '?') return 'help';
  if (event.shiftKey) return null;
  return SINGLE[key] ?? null;
}

/** Whether the focus is somewhere you type: single keys leave it alone. */
export function isTypingTarget(element: { tagName: string; isContentEditable?: boolean; type?: string } | null): boolean {
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT' && !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes((element.type ?? 'text').toLowerCase());
}

/**
 * A key as this reader's keyboard shows it, from the stored form (`mod+k`, `mod+shift+u`, `enter`, `j`): `⌘K` and
 * `⌘⇧U` on a Mac, `Ctrl+K` and `Ctrl+Shift+U` on Windows. Every hint goes through here, never a glyph typed by hand.
 */
export function keyLabel(keys: string, mac: boolean): string {
  const parts = keys.split('+').map((part) => part.trim().toLowerCase());
  const names = parts.map((part) => {
    if (part === 'mod') return mac ? '⌘' : 'Ctrl';
    if (part === 'shift') return mac ? '⇧' : 'Shift';
    if (part === 'alt') return mac ? '⌥' : 'Alt';
    if (part === 'enter') return mac ? '↩' : 'Enter';
    if (part === 'escape' || part === 'esc') return 'Esc';
    if (part === 'up') return '↑';
    if (part === 'down') return '↓';
    return part.length === 1 ? part.toUpperCase() : part;
  });
  return mac ? names.join('') : names.join('+');
}

/** The keys the `?` dialog lists, in its order; each is a stored form for `keyLabel`. */
export const KEY_LIST: ReadonlyArray<{ action: KeyAction | 'files'; keys: string[]; label: string }> = [
  { action: 'palette', keys: ['mod+k'], label: 'Search sessions and actions' },
  { action: 'next-needs-you', keys: ['mod+shift+u', 'u'], label: 'Open the next session that needs you' },
  { action: 'down', keys: ['j'], label: 'Next card or session' },
  { action: 'up', keys: ['k'], label: 'Previous card or session' },
  { action: 'allow', keys: ['a'], label: 'Allow' },
  { action: 'deny', keys: ['d'], label: 'Deny' },
  { action: 'open', keys: ['enter'], label: 'Open the card or session' },
  { action: 'new', keys: ['n'], label: 'New session' },
  { action: 'files', keys: ['up', 'down'], label: 'Move through the files in Changes' },
  { action: 'escape', keys: ['escape'], label: 'Close the palette, a sheet or Changes' },
  { action: 'help', keys: ['?'], label: 'Show these keys' },
];

/** One step through a list from `current` (-1: nothing yet), stopping at the ends. */
export function nextIndex(current: number, count: number, step: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0 || current >= count) return step === 1 ? 0 : count - 1;
  return Math.min(count - 1, Math.max(0, current + step));
}

/** Whether a box (the Allow button) is wholly inside the part of its scroller you see: A and D only act on what was in view. */
export function inView(box: { top: number; bottom: number }, viewport: { top: number; bottom: number }): boolean {
  return box.bottom > box.top && box.top >= viewport.top - 1 && box.bottom <= viewport.bottom + 1;
}

/** This reader's platform, for `keyAction` and `keyLabel`. */
export const isMacPlatform = (platform: string, userAgent: string) => /Mac|iPhone|iPad|iPod/.test(platform) || /Mac OS X|iPhone|iPad/.test(userAgent);
