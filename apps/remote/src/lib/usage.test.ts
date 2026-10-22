import { describe, expect, it } from 'vitest';
import type { RemoteProfileUsage, UsageLimit } from '@switchboard/protocol/remote-client';
import { countdown, levelOf, limitName, onComputers, spokenLimit, usageMessage, visibleLimits, withUsage } from './usage.ts';

const NOW = new Date(2026, 9, 15, 14, 0).getTime();
const MINUTE = 60_000;
const limit = (kind: string, percent: number, extra: Partial<UsageLimit> = {}): UsageLimit => ({ kind, group: kind === 'session' ? 'session' : 'weekly', percent, resetsAt: null, scope: null, severity: 'normal', isActive: true, ...extra });
const entry = (id: string, percent: number | null, error: string | null = null): RemoteProfileUsage => ({
  profile: { id, name: id, color: 'yellow' },
  usage: percent === null ? null : { fetchedAt: 1, limits: [limit('session', percent)], extraUsage: null },
  error,
});

describe('plan usage on Home', () => {
  it('shows the 5-hour and weekly windows, and a scoped one only once it is in use', () => {
    const limits = [limit('session', 0), limit('weekly_all', 0), limit('weekly_scoped', 0, { scope: 'Opus' }), limit('weekly_scoped', 12, { scope: 'Sonnet' })];
    expect(visibleLimits(limits).map(limitName)).toEqual(['5h', 'Week', 'Week · Sonnet']);
  });

  it('counts down to the reset', () => {
    expect(countdown(NOW + 182 * MINUTE, NOW)).toBe('3h2m');
    expect(countdown(NOW + (5 * 24 * 60 + 4 * 60) * MINUTE, NOW)).toBe('5d4h');
    expect(countdown(NOW + 12 * MINUTE, NOW)).toBe('12m');
    expect(countdown(NOW - MINUTE, NOW)).toBe('now');
  });

  it('reads a window as a sentence', () => {
    expect(spokenLimit(limit('session', 43.6, { resetsAt: NOW + 182 * MINUTE }), NOW)).toBe('5-hour limit: 44% used, resets in 3h2m');
    expect(spokenLimit(limit('weekly_scoped', 5, { scope: 'Opus' }), NOW)).toBe('Weekly limit (Opus): 5% used');
  });

  it('is green under 60%, orange to 85% and red from there', () => {
    expect([0, 59, 60, 84, 85, 100].map(levelOf)).toEqual(['ok', 'ok', 'caution', 'caution', 'high', 'high']);
  });

  it('says why a card has no bars', () => {
    expect(usageMessage(entry('a', null, 'Not logged in'))).toBe('Usage unavailable');
    expect(usageMessage(entry('a', null))).toBe('No plan limits reported.');
  });

  it('takes a profile\'s new numbers, and keeps the old ones when a check brought none', () => {
    const list = [entry('a', 10), entry('b', null, 'Timed out')];
    const next = { fetchedAt: 2, limits: [limit('session', 20)], extraUsage: null };
    expect(withUsage(list, 'b', next)[1]).toEqual({ ...list[1], usage: next, error: null });
    expect(withUsage(list, 'a', null)).toEqual(list);
    expect(withUsage(list, 'c', next)).toEqual(list);
  });

  it('says which computers a profile is on', () => {
    expect(onComputers(['mystic', 'studio'])).toBe('On mystic and studio');
    expect(onComputers(['mystic', 'studio', 'laptop'])).toBe('On mystic, studio and laptop');
  });
});
