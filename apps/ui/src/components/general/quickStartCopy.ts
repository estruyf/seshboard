import { isQuickStartShortcut } from '@seshboard/protocol/client';
import { currentPlatform } from '../../lib/platform.ts';
import { formatKeys, keysFor, normalizeShortcut, reservedShortcuts } from '../../lib/shortcuts.ts';

/** Settings › General › Quick start: what it shows, and what Settings search finds it by. */
export const QUICK_START_TITLE = 'Quick start';

export const SHORTCUT_LABEL = 'Shortcut';
export const SHORTCUT_DETAIL = 'Opens quick start in any app. Seshboard stays where it is.';

export const BACKGROUND_LABEL = 'Start in the background';
export const backgroundDetail = () => `${formatKeys(keysFor('quickstart.start'))} starts without bringing Seshboard forward. ${formatKeys(keysFor('quickstart.start-open'))} opens it.`;

export const NEEDS_YOU_LABEL = 'Show what needs you';
export const NEEDS_YOU_DETAIL = 'Waiting sessions on top, with what they want.';

/** What Settings search also finds these by. */
export const QUICK_START_KEYWORDS = 'quick start launcher global shortcut hotkey raycast spotlight alfred any app anywhere background panel';

/** What Settings says when another app has the shortcut, as the panel can't open then. */
export const inUseMessage = (shortcut: string) => `${formatKeys(shortcut)} is in use by another app. Pick another.`;

/**
 * Why a recorded shortcut can't be quick start's, or null: it needs ⌘, ⌃ or ⌥ (Ctrl or Alt elsewhere), and it can't be
 * one Seshboard uses in its windows, which would stop working there.
 */
export function shortcutProblem(shortcut: string, platform = currentPlatform()): string | null {
  if (!isQuickStartShortcut(shortcut)) return platform === 'darwin' ? 'Include ⌘, ⌃ or ⌥' : 'Include Ctrl or Alt';
  const own = normalizeShortcut(keysFor('quickstart.open'));
  const pressed = normalizeShortcut(shortcut);
  if (pressed !== own && reservedShortcuts().has(pressed)) return `Seshboard uses ${formatKeys(shortcut)}. Pick another.`;
  return null;
}
