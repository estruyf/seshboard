import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, sanitizePreferences } from './bridge.ts';

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
