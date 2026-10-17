import { matches, type ShortcutId } from './shortcuts.ts';

/** The shortcuts of the window itself that act on a session or its terminal, rather than on the app. */
export type SessionKey = Extract<ShortcutId, 'terminal.maximize' | 'terminal.toggle' | 'editor.open' | 'session.new-window'>;

const SESSION_KEYS: readonly SessionKey[] = ['terminal.maximize', 'terminal.toggle', 'editor.open', 'session.new-window'];

/**
 * Which of those a key press is, or null. In a pop-out the session is already in a window of its own, so
 * "Open in new window" means nothing there and is left alone.
 */
export function sessionKey(event: Parameters<typeof matches>[0], inPopout: boolean): SessionKey | null {
  for (const id of SESSION_KEYS) {
    if (inPopout && id === 'session.new-window') continue;
    if (matches(event, id)) return id;
  }
  return null;
}

/**
 * What the terminal's maximize key does: a panel that is open takes the whole view (or gives it back, which is
 * the store's own toggle); a closed one opens maximized.
 */
export const maximizeStep = (open: boolean): 'toggle' | 'open-maximized' => (open ? 'toggle' : 'open-maximized');
