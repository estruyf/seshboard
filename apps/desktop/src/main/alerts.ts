import type { Preferences, SoundKind } from '@switchboard/protocol/bridge';
import type { AttentionEvent } from './attention.ts';

/** Settings › Notifications. */
export type AlertPrefs = Pick<Preferences, 'notifications' | 'sounds' | 'soundComplete' | 'soundNeedsInput' | 'soundVolume'>;

/** What one attention event does: show a notification, and which of the two sounds it plays (null: none). */
export interface Alert {
  notify: boolean;
  sound: SoundKind | null;
}

/** Needing you has its own sound; a finished turn, an error and a project action that ends share Session complete. */
export const soundKindOf = (kind: AttentionEvent['kind']): SoundKind => (kind === 'needs-you' ? 'needsInput' : 'complete');

/** The sound a kind is set to, or null for none. */
export const soundFor = (kind: SoundKind, prefs: AlertPrefs): string | null => (kind === 'needsInput' ? prefs.soundNeedsInput : prefs.soundComplete);

/**
 * What an event does with these settings. Nothing at all for the session you are looking at (`suppressed`);
 * the badge and the Dock bounce don't depend on it.
 */
export function alertFor(kind: AttentionEvent['kind'], suppressed: boolean, prefs: AlertPrefs): Alert {
  if (suppressed) return { notify: false, sound: null };
  const sound = soundKindOf(kind);
  return { notify: prefs.notifications, sound: prefs.sounds && prefs.soundVolume > 0 && soundFor(sound, prefs) !== null ? sound : null };
}

/** Events that arrive together play one sound, not one each: needing you comes first. */
export const louder = (a: SoundKind | null, b: SoundKind | null): SoundKind | null => (a === 'needsInput' || b === 'needsInput' ? 'needsInput' : (a ?? b));
