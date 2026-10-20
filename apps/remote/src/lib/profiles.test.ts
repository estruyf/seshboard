import { describe, expect, it } from 'vitest';
import type { RemoteProfileUsage, UsageLimit } from '@switchboard/protocol/remote-client';
import { byClosest, cardRows, compactProfiles, compactText, highestPercent, windowPercent } from './profiles.ts';

const limit = (kind: string, percent: number): UsageLimit => ({ kind, group: kind === 'session' ? 'session' : 'weekly', percent, resetsAt: null, scope: null, severity: 'normal', isActive: true });
const profile = (name: string, session: number | null, week = 0): RemoteProfileUsage => ({
  profile: { id: name.toLowerCase(), name, color: 'blue' },
  usage: session === null ? null : { fetchedAt: 1, limits: [limit('session', session), limit('weekly_all', week)], extraUsage: null },
  error: null,
});

describe('profile usage in little room', () => {
  it('takes the highest of a profile’s windows', () => {
    expect(highestPercent(profile('Work', 40, 82))).toBe(82);
    expect(highestPercent(profile('Work', null))).toBeNull();
    expect(windowPercent(profile('Work', 40, 82), 'session')).toBe(40);
    expect(windowPercent(profile('Work', 40, 82), 'weekly_all')).toBe(82);
    expect(windowPercent(profile('Work', null), 'session')).toBeNull();
  });

  it('puts the profiles closest to a limit first, those without numbers last', () => {
    const order = byClosest([profile('Personal', 18), profile('Side', null), profile('Work', 30, 82), profile('Client', 50)]);
    expect(order.map((p) => p.profile.name)).toEqual(['Work', 'Client', 'Personal', 'Side']);
  });

  it('shows every profile up to two on the card, else the two closest and +N', () => {
    expect(cardRows([profile('Personal', 18), profile('Work', 82)])).toEqual({ rows: [profile('Personal', 18), profile('Work', 82)], more: 0 });
    const three = cardRows([profile('Personal', 18), profile('Work', 82), profile('Client', 50), profile('Side', 5)]);
    expect(three.rows.map((p) => p.profile.name)).toEqual(['Work', 'Client']);
    expect(three.more).toBe(2);
  });

  it('writes the Home row: each of two profiles, or the closest of three and +2', () => {
    const two = compactProfiles([profile('Work', 82), profile('Personal', 18)]);
    expect(two.items.map((i) => [i.name, i.percent, i.level])).toEqual([
      ['Work', 82, 'caution'],
      ['Personal', 18, 'ok'],
    ]);
    expect(compactText(two)).toBe('Work 82%, Personal 18%');

    const three = compactProfiles([profile('Personal', 18), profile('Work', 90), profile('Client', 50)]);
    expect(three.items.map((i) => i.name)).toEqual(['Work']);
    expect(three.items[0]!.level).toBe('high');
    expect(three.more).toBe(2);
    expect(compactText(three)).toBe('Work 90%, 2 more');
  });

  it('shows nothing with one profile', () => {
    expect(compactProfiles([profile('Personal', 18)])).toEqual({ items: [], more: 0 });
  });

  it('names a profile without numbers on its own', () => {
    expect(compactText(compactProfiles([profile('Work', null), profile('Personal', 18.4)]))).toBe('Work, Personal 18%');
  });
});
