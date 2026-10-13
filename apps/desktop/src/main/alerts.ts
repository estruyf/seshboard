import { NO_SOUND, type Preferences, type SoundEvent } from '@switchboard/protocol/bridge';
import type { AttentionEvent } from './attention.ts';

/** Settings › Notifications. */
export type AlertPrefs = Pick<Preferences, 'notifications' | 'sounds'>;

/** What one attention event does: show a notification, and which moment's sound it plays (null: none). */
export interface Alert {
  notify: boolean;
  sound: SoundEvent | null;
}

const EVENT_SOUND: Record<AttentionEvent['kind'], SoundEvent> = { 'needs-you': 'needsYou', finished: 'finished', failed: 'error', 'action-done': 'actionEnded' };

/** Each kind of event has its own moment, and so its own sound. */
export const soundEventOf = (kind: AttentionEvent['kind']): SoundEvent => EVENT_SOUND[kind];

/**
 * What an event does with these settings. Nothing at all for the session you are looking at (`suppressed`);
 * the badge and the Dock bounce don't depend on it. Notifications and sounds don't depend on each other.
 */
export function alertFor(kind: AttentionEvent['kind'], suppressed: boolean, prefs: AlertPrefs): Alert {
  if (suppressed) return { notify: false, sound: null };
  const event = soundEventOf(kind);
  const { enabled, volume, byEvent } = prefs.sounds;
  return { notify: prefs.notifications.enabled, sound: enabled && volume > 0 && byEvent[event] !== NO_SOUND ? event : null };
}

/** Events that arrive together play one sound, not one each: needing you first, then an error, a finished turn, an action. */
const LOUDEST_FIRST: readonly SoundEvent[] = ['needsYou', 'error', 'finished', 'actionEnded'];
export const louder = (a: SoundEvent | null, b: SoundEvent | null): SoundEvent | null => {
  if (a === null || b === null) return a ?? b;
  return LOUDEST_FIRST.indexOf(a) <= LOUDEST_FIRST.indexOf(b) ? a : b;
};
