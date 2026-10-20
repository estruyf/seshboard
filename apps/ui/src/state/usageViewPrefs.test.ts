import { describe, expect, it } from 'vitest';
import { backTarget, readRemembered } from './usageViewPrefs.ts';

describe('the Usage view', () => {
  it('opens on the tab and period left last time, and on Limits for the current window the first time', () => {
    expect(readRemembered(null)).toEqual({ tab: 'limits', period: 'window', computers: 'all' });
    expect(readRemembered(JSON.stringify({ tab: 'tokens', period: 'week', computers: 'this' }))).toEqual({ tab: 'tokens', period: 'week', computers: 'this' });
    expect(readRemembered(JSON.stringify({ tab: 'other', period: 'year', computers: 'some' }))).toEqual({ tab: 'limits', period: 'window', computers: 'all' });
    expect(readRemembered('{broken')).toEqual({ tab: 'limits', period: 'window', computers: 'all' });
  });

  it('goes back to the view it was opened from', () => {
    expect(backTarget('project', 'session')).toBe('project');
    expect(backTarget('session', 'project')).toBe('session');
    // Opened again while open, or from Settings over it: Back still goes where it first came from.
    expect(backTarget('usage', 'project')).toBe('project');
    expect(backTarget('settings', 'new')).toBe('new');
  });
});
