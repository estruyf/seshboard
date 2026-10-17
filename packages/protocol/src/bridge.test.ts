import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, DEFAULT_SOUNDS, mergePreferences, resolveSound, sanitizePreferences, type SoundList, type SoundPrefs } from './bridge.ts';

describe('sidebarCollapsed preference', () => {
  it('collapses to the minimal rail by default', () => {
    expect(DEFAULT_PREFERENCES.sidebarCollapsed).toBe('minimal');
  });

  it('keeps minimal and closed, and drops anything else', () => {
    expect(sanitizePreferences({ sidebarCollapsed: 'closed' })).toEqual({ sidebarCollapsed: 'closed' });
    expect(sanitizePreferences({ sidebarCollapsed: 'minimal' })).toEqual({ sidebarCollapsed: 'minimal' });
    expect(sanitizePreferences({ sidebarCollapsed: 'hidden' })).toEqual({});
    expect(sanitizePreferences({ sidebarCollapsed: 1 })).toEqual({});
  });
});

describe('fileLinkClick preference', () => {
  it('shows the file in the file manager by default', () => {
    expect(DEFAULT_PREFERENCES.fileLinkClick).toBe('file-manager');
  });

  it('keeps the two choices, and drops anything else', () => {
    expect(sanitizePreferences({ fileLinkClick: 'editor' })).toEqual({ fileLinkClick: 'editor' });
    expect(sanitizePreferences({ fileLinkClick: 'file-manager' })).toEqual({ fileLinkClick: 'file-manager' });
    expect(sanitizePreferences({ fileLinkClick: 'finder' })).toEqual({});
    expect(sanitizePreferences({ fileLinkClick: true })).toEqual({});
    expect(sanitizePreferences({ fileLinkClick: null })).toEqual({});
  });

  it('falls back to the default for an unknown saved value, and to the last good one for an unknown change', () => {
    expect({ ...DEFAULT_PREFERENCES, ...sanitizePreferences({ fileLinkClick: 'reveal' }) }.fileLinkClick).toBe('file-manager');
    const editor = { ...DEFAULT_PREFERENCES, fileLinkClick: 'editor' as const };
    expect({ ...editor, ...sanitizePreferences(mergePreferences(editor, { fileLinkClick: 'reveal' })) }.fileLinkClick).toBe('editor');
  });
});

describe('fadeInactivePanes preference', () => {
  it('fades the inactive panes by default', () => {
    expect(DEFAULT_PREFERENCES.fadeInactivePanes).toBe(true);
  });

  it('keeps on and off, and drops anything else', () => {
    expect(sanitizePreferences({ fadeInactivePanes: false })).toEqual({ fadeInactivePanes: false });
    expect(sanitizePreferences({ fadeInactivePanes: true })).toEqual({ fadeInactivePanes: true });
    expect(sanitizePreferences({ fadeInactivePanes: 'off' })).toEqual({});
    expect(sanitizePreferences({ fadeInactivePanes: 0 })).toEqual({});
  });
});

describe('newSessionMode preference', () => {
  it('starts new sessions in the mode picked last by default', () => {
    expect(DEFAULT_PREFERENCES.newSessionMode).toBe('last');
  });

  it('keeps the offered modes, and drops bypass and anything else', () => {
    for (const mode of ['last', 'default', 'acceptEdits', 'plan', 'auto']) expect(sanitizePreferences({ newSessionMode: mode })).toEqual({ newSessionMode: mode });
    expect(sanitizePreferences({ newSessionMode: 'bypassPermissions' })).toEqual({});
    expect(sanitizePreferences({ newSessionMode: 'dontAsk' })).toEqual({});
    expect(sanitizePreferences({ newSessionMode: null })).toEqual({});
  });
});

describe('archive and delete preferences', () => {
  it('archives after 3 days and leaves deleting off by default', () => {
    expect(DEFAULT_PREFERENCES.archiveAfterDays).toBe(3);
    expect(DEFAULT_PREFERENCES.deleteArchived).toEqual({ enabled: false, afterDays: 30 });
  });

  it('keeps archive days between 1 and 365, rounded', () => {
    expect(sanitizePreferences({ archiveAfterDays: 7 })).toEqual({ archiveAfterDays: 7 });
    expect(sanitizePreferences({ archiveAfterDays: 0 })).toEqual({ archiveAfterDays: 1 });
    expect(sanitizePreferences({ archiveAfterDays: 900 })).toEqual({ archiveAfterDays: 365 });
    expect(sanitizePreferences({ archiveAfterDays: 2.6 })).toEqual({ archiveAfterDays: 3 });
    expect(sanitizePreferences({ archiveAfterDays: '7' })).toEqual({});
    expect(sanitizePreferences({ archiveAfterDays: Number.NaN })).toEqual({});
  });

  it('takes deleting only as a whole: a switch and days between 1 and 3650', () => {
    expect(sanitizePreferences({ deleteArchived: { enabled: true, afterDays: 60 } })).toEqual({ deleteArchived: { enabled: true, afterDays: 60 } });
    expect(sanitizePreferences({ deleteArchived: { enabled: false, afterDays: 99999 } })).toEqual({ deleteArchived: { enabled: false, afterDays: 3650 } });
    expect(sanitizePreferences({ deleteArchived: { enabled: true, afterDays: -4 } })).toEqual({ deleteArchived: { enabled: true, afterDays: 1 } });
    expect(sanitizePreferences({ deleteArchived: { enabled: true } })).toEqual({});
    expect(sanitizePreferences({ deleteArchived: { afterDays: 10 } })).toEqual({});
    expect(sanitizePreferences({ deleteArchived: 'yes' })).toEqual({});
    expect(sanitizePreferences({ deleteArchived: null })).toEqual({});
  });
});

describe('githubStar preference', () => {
  it('asks by default, and keeps only ask and done', () => {
    expect(DEFAULT_PREFERENCES.githubStar).toBe('ask');
    expect(sanitizePreferences({ githubStar: 'done' })).toEqual({ githubStar: 'done' });
    expect(sanitizePreferences({ githubStar: 'starred' })).toEqual({});
    expect(sanitizePreferences({ githubStar: true })).toEqual({});
  });
});

describe('notification and sound preferences', () => {
  const sounds = (extra: Partial<SoundPrefs> = {}): SoundPrefs => ({ ...DEFAULT_SOUNDS, ...extra });

  it('notifies and stays quiet on a fresh install, with a different sound for each moment', () => {
    const fresh = { ...DEFAULT_PREFERENCES, ...sanitizePreferences(undefined) };
    expect(fresh.notifications).toEqual({ enabled: true });
    expect(fresh.sounds).toEqual({ enabled: false, byEvent: { needsYou: 'Ping', finished: 'Glass', error: 'Basso', actionEnded: 'Pop' }, volume: 0.5, revision: 2 });
    expect(new Set(Object.values(fresh.sounds.byEvent)).size).toBe(4);
  });

  describe('sounds saved before the current defaults', () => {
    const saved = (byEvent: Record<string, string>, extra: Record<string, unknown> = {}) => sanitizePreferences({ sounds: { enabled: true, byEvent, volume: 0.3, ...extra } }).sounds;

    it('take the current defaults when nobody picked them: Glass from Session complete, or the first defaults', () => {
      expect(saved({ needsYou: 'Ping', finished: 'Glass', error: 'Glass', actionEnded: 'Glass' })).toEqual(sounds({ enabled: true, volume: 0.3 }));
      expect(saved({ needsYou: 'Ping', finished: 'Glass', error: 'Basso', actionEnded: 'none' })).toEqual(sounds({ enabled: true, volume: 0.3 }));
    });

    it('keep sounds someone picked', () => {
      const picked = { needsYou: 'Ping', finished: 'Hero', error: 'Glass', actionEnded: 'Glass' };
      expect(saved(picked)?.byEvent).toEqual(picked);
    });

    it('happens once: the same sounds picked after it stay', () => {
      const glass = { needsYou: 'Ping', finished: 'Glass', error: 'Glass', actionEnded: 'Glass' };
      expect(saved(glass, { revision: 2 })?.byEvent).toEqual(glass);
    });
  });

  describe('moving the settings from before a sound per moment', () => {
    const old = (extra: Record<string, unknown>) => sanitizePreferences({ notifications: true, sounds: false, soundComplete: 'Glass', soundNeedsInput: 'Ping', soundVolume: 0.5, ...extra });

    it('keeps both switches, in every combination', () => {
      for (const notifications of [true, false]) {
        for (const on of [true, false]) {
          const moved = old({ notifications, sounds: on });
          expect(moved.notifications).toEqual({ enabled: notifications });
          expect(moved.sounds?.enabled).toBe(on);
        }
      }
    });

    it('plays Needs input for Needs you, and Session complete for the three other moments', () => {
      expect(old({ sounds: true, soundComplete: 'Hero', soundNeedsInput: 'Tink' }).sounds).toEqual(
        sounds({ enabled: true, byEvent: { needsYou: 'Tink', finished: 'Hero', error: 'Hero', actionEnded: 'Hero' } }),
      );
    });

    it('gives each moment its own sound when the old ones were never changed', () => {
      expect(old({}).sounds?.byEvent).toEqual({ needsYou: 'Ping', finished: 'Glass', error: 'Basso', actionEnded: 'Pop' });
    });

    it('keeps None (null) as none for every moment it played for, in every combination', () => {
      expect(old({ soundComplete: null, soundNeedsInput: null }).sounds?.byEvent).toEqual({ needsYou: 'none', finished: 'none', error: 'none', actionEnded: 'none' });
      expect(old({ soundComplete: null }).sounds?.byEvent).toEqual({ needsYou: 'Ping', finished: 'none', error: 'none', actionEnded: 'none' });
      expect(old({ soundNeedsInput: null }).sounds?.byEvent).toEqual({ ...{ needsYou: 'Ping', finished: 'Glass', error: 'Basso', actionEnded: 'Pop' }, needsYou: 'none' });
    });

    it('keeps the volume', () => {
      expect(old({ soundVolume: 0.25 }).sounds?.volume).toBe(0.25);
      expect(old({ soundVolume: 4 }).sounds?.volume).toBe(1);
      expect(old({ soundVolume: 'loud' }).sounds?.volume).toBe(0.5);
    });

    it('moves a file that has only some of the old settings', () => {
      expect(sanitizePreferences({ sounds: true }).sounds).toEqual(sounds({ enabled: true }));
      expect(sanitizePreferences({ soundVolume: 0.8 }).sounds).toEqual(sounds({ volume: 0.8 }));
    });
  });

  it('keeps sound names and none, and drops paths and anything else', () => {
    const byEvent = (value: unknown) => sanitizePreferences({ sounds: { ...DEFAULT_SOUNDS, byEvent: { ...DEFAULT_SOUNDS.byEvent, finished: value } } }).sounds?.byEvent.finished;
    expect(byEvent('Hero')).toBe('Hero');
    expect(byEvent('Windows Notify Messaging')).toBe('Windows Notify Messaging');
    expect(byEvent('none')).toBe('none');
    expect(byEvent(null)).toBe('none');
    for (const bad of ['../../etc/passwd', 'C:\\Windows\\Media\\ding', '', 3]) expect(byEvent(bad)).toBe('Glass');
  });

  it('keeps the volume between 0 and 1', () => {
    const volume = (value: unknown) => sanitizePreferences({ sounds: { ...DEFAULT_SOUNDS, volume: value } }).sounds?.volume;
    expect(volume(0.25)).toBe(0.25);
    expect(volume(4)).toBe(1);
    expect(volume(-1)).toBe(0);
    expect(volume('1')).toBe(0.5);
    expect(volume(Number.NaN)).toBe(0.5);
  });

  it('drops switches that are not on or off', () => {
    expect(sanitizePreferences({ notifications: 'yes' })).toEqual({});
    expect(sanitizePreferences({ notifications: { enabled: 1 } })).toEqual({});
    expect(sanitizePreferences({ sounds: 'on' })).toEqual({});
  });

  it('merges a change field by field, so turning sounds off keeps every sound', () => {
    const current = { ...DEFAULT_PREFERENCES, sounds: sounds({ enabled: true, byEvent: { ...DEFAULT_SOUNDS.byEvent, finished: 'Hero' } }) };
    const off = { ...current, ...sanitizePreferences(mergePreferences(current, { sounds: { enabled: false } })) };
    expect(off.sounds).toEqual({ ...current.sounds, enabled: false });
    const on = { ...off, ...sanitizePreferences(mergePreferences(off, { sounds: { enabled: true } })) };
    expect(on.sounds).toEqual(current.sounds);
    const picked = sanitizePreferences(mergePreferences(current, { sounds: { byEvent: { error: 'none' } } }));
    expect(picked.sounds?.byEvent).toEqual({ ...current.sounds.byEvent, error: 'none' });
    expect(sanitizePreferences(mergePreferences(current, { notifications: { enabled: false } })).notifications).toEqual({ enabled: false });
  });

  it('plays a missing sound as the fallback, and none as none', () => {
    const list: SoundList = { sounds: ['chimes', 'Windows Ding'], fallback: { needsYou: 'Windows Ding', finished: 'chimes', error: 'chimes', actionEnded: 'chimes' } };
    expect(resolveSound('Windows Ding', list, 'finished')).toBe('Windows Ding');
    expect(resolveSound('Glass', list, 'finished')).toBe('chimes');
    expect(resolveSound('Ping', list, 'needsYou')).toBe('Windows Ding');
    expect(resolveSound('none', list, 'finished')).toBeNull();
    expect(resolveSound('Glass', { sounds: [], fallback: { needsYou: null, finished: null, error: null, actionEnded: null } }, 'finished')).toBeNull();
  });
});
