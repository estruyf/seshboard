import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, DEFAULT_SOUNDS, type SoundPrefs } from '@switchboard/protocol/bridge';
import { alertFor, louder, soundEventOf, type AlertPrefs } from './alerts.ts';

const KINDS = ['needs-you', 'finished', 'failed', 'action-done', 'resumed', 'checks-failed', 'checks-passed'] as const;
const prefs = ({ notifications = true, ...sounds }: Partial<SoundPrefs> & { notifications?: boolean } = {}): AlertPrefs => ({
  notifications: { enabled: notifications },
  sounds: { ...DEFAULT_SOUNDS, ...sounds },
});
/** Every moment has a sound, so each one plays. */
const ALL = { needsYou: 'Ping', finished: 'Glass', error: 'Basso', actionEnded: 'Pop' };

describe('alertFor', () => {
  it('notifies without a sound by default', () => {
    for (const kind of KINDS) expect(alertFor(kind, false, DEFAULT_PREFERENCES)).toEqual({ notify: true, sound: null });
  });

  it('plays each moment its own sound', () => {
    const on = prefs({ enabled: true, byEvent: ALL });
    expect(alertFor('needs-you', false, on)).toEqual({ notify: true, sound: 'needsYou' });
    expect(alertFor('finished', false, on)).toEqual({ notify: true, sound: 'finished' });
    expect(alertFor('failed', false, on)).toEqual({ notify: true, sound: 'error' });
    expect(alertFor('action-done', false, on)).toEqual({ notify: true, sound: 'actionEnded' });
    expect(alertFor('checks-failed', false, on)).toEqual({ notify: true, sound: 'error' });
    expect(alertFor('checks-passed', false, on)).toEqual({ notify: true, sound: 'actionEnded' });
  });

  it('plays nothing for a moment set to none, and the others still play', () => {
    const on = prefs({ enabled: true, byEvent: { ...ALL, error: 'none' } });
    expect(alertFor('failed', false, on)).toEqual({ notify: true, sound: null });
    expect(alertFor('finished', false, on)).toEqual({ notify: true, sound: 'finished' });
    // A new install: every moment has a sound.
    for (const kind of KINDS) expect(alertFor(kind, false, prefs({ enabled: true })).sound).not.toBeNull();
  });

  it('plays nothing with sounds off or at volume 0, and keeps notifying', () => {
    for (const kind of KINDS) {
      expect(alertFor(kind, false, prefs({ enabled: false, byEvent: ALL }))).toEqual({ notify: true, sound: null });
      expect(alertFor(kind, false, prefs({ enabled: true, byEvent: ALL, volume: 0 }))).toEqual({ notify: true, sound: null });
    }
  });

  it('plays sounds with notifications off, and notifies with sounds off', () => {
    expect(alertFor('needs-you', false, prefs({ notifications: false, enabled: true, byEvent: ALL }))).toEqual({ notify: false, sound: 'needsYou' });
    expect(alertFor('failed', false, prefs({ notifications: false, enabled: true, byEvent: ALL }))).toEqual({ notify: false, sound: 'error' });
    expect(alertFor('needs-you', false, prefs({ notifications: true, enabled: false, byEvent: ALL }))).toEqual({ notify: true, sound: null });
    expect(alertFor('needs-you', false, prefs({ notifications: false, enabled: false, byEvent: ALL }))).toEqual({ notify: false, sound: null });
  });

  it('does nothing for the session you are looking at', () => {
    expect(alertFor('needs-you', true, prefs({ enabled: true, byEvent: ALL }))).toEqual({ notify: false, sound: null });
  });
});

describe('sounds for events that arrive together', () => {
  it('maps kinds to moments', () => {
    expect(KINDS.map(soundEventOf)).toEqual(['needsYou', 'finished', 'error', 'actionEnded', 'finished', 'error', 'actionEnded']);
  });

  it('gives a pipeline that needs you the sound of needing you', () => {
    expect(soundEventOf('pipeline-needs-you')).toBe('needsYou');
    expect(alertFor('pipeline-needs-you', false, prefs({ enabled: true })).notify).toBe(true);
    expect(alertFor('pipeline-needs-you', true, prefs({ enabled: true }))).toEqual({ notify: false, sound: null });
  });

  it('plays one: needing you, then an error, a finished turn, an action', () => {
    expect(louder(null, null)).toBeNull();
    expect(louder(null, 'finished')).toBe('finished');
    expect(louder('finished', 'needsYou')).toBe('needsYou');
    expect(louder('needsYou', 'error')).toBe('needsYou');
    expect(louder('finished', 'error')).toBe('error');
    expect(louder('actionEnded', 'finished')).toBe('finished');
  });
});
