import { NO_SOUND, type Preferences, type SoundEvent } from '@switchboard/protocol/bridge';
import type { AttentionEvent } from './attention.ts';

/** Settings › Notifications. */
export type AlertPrefs = Pick<Preferences, 'notifications' | 'sounds'>;

/** What one attention event does: show a notification, and which moment's sound it plays (null: none). */
export interface Alert {
  notify: boolean;
  sound: SoundEvent | null;
}

// A session resuming after a usage limit is news like a finished turn: it shares that moment's sound. So does a large
// session's cache about to lapse (Settings › Usage), and a queued item that started by itself. Checks that finish are
// like an action that ends, and failed ones like an error, as is a queued item that didn't start. A scheduled run that
// started or went to the queue is news like a finished turn; one that was skipped or couldn't start is like an error.
const EVENT_SOUND: Record<AttentionEvent['kind'], SoundEvent> = {
  'needs-you': 'needsYou',
  finished: 'finished',
  failed: 'error',
  'action-done': 'actionEnded',
  resumed: 'finished',
  'checks-failed': 'error',
  'checks-passed': 'actionEnded',
  'cache-expiring': 'finished',
  'queue-started': 'finished',
  'queue-skipped': 'error',
  'schedule-started': 'finished',
  'schedule-queued': 'finished',
  'schedule-skipped': 'error',
  'trigger-started': 'finished',
  'trigger-paused': 'error',
};

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
