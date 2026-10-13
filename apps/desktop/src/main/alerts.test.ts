import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES } from '@switchboard/protocol/bridge';
import { alertFor, louder, soundKindOf, type AlertPrefs } from './alerts.ts';

const prefs = (extra: Partial<AlertPrefs> = {}): AlertPrefs => ({ ...DEFAULT_PREFERENCES, ...extra });

describe('alertFor', () => {
  it('notifies without a sound by default, as before', () => {
    for (const kind of ['needs-you', 'finished', 'failed', 'action-done'] as const) expect(alertFor(kind, false, prefs())).toEqual({ notify: true, sound: null });
  });

  it('plays the needs input sound for a prompt, and session complete for the rest', () => {
    const on = prefs({ sounds: true });
    expect(alertFor('needs-you', false, on)).toEqual({ notify: true, sound: 'needsInput' });
    expect(alertFor('finished', false, on)).toEqual({ notify: true, sound: 'complete' });
    expect(alertFor('failed', false, on)).toEqual({ notify: true, sound: 'complete' });
    expect(alertFor('action-done', false, on)).toEqual({ notify: true, sound: 'complete' });
  });

  it('plays sounds with notifications off', () => {
    expect(alertFor('needs-you', false, prefs({ notifications: false, sounds: true }))).toEqual({ notify: false, sound: 'needsInput' });
  });

  it('plays nothing for a sound set to none, or at volume 0', () => {
    expect(alertFor('finished', false, prefs({ sounds: true, soundComplete: null }))).toEqual({ notify: true, sound: null });
    expect(alertFor('needs-you', false, prefs({ sounds: true, soundComplete: null }))).toEqual({ notify: true, sound: 'needsInput' });
    expect(alertFor('needs-you', false, prefs({ sounds: true, soundVolume: 0 }))).toEqual({ notify: true, sound: null });
  });

  it('does nothing for the session you are looking at', () => {
    expect(alertFor('needs-you', true, prefs({ sounds: true }))).toEqual({ notify: false, sound: null });
  });
});

describe('sounds for events that arrive together', () => {
  it('maps kinds to sounds', () => {
    expect(soundKindOf('needs-you')).toBe('needsInput');
    expect(soundKindOf('action-done')).toBe('complete');
  });

  it('plays one, needing you first', () => {
    expect(louder(null, null)).toBeNull();
    expect(louder(null, 'complete')).toBe('complete');
    expect(louder('complete', 'needsInput')).toBe('needsInput');
    expect(louder('needsInput', 'complete')).toBe('needsInput');
  });
});
