import { describe, expect, it } from 'vitest';
import type { LimitsState } from '@switchboard/protocol';
import { isUsageLimitText, limitPrefixes, limitStop, remoteLimit, resetMs, RESUME_GRACE_MS, resumeTime, snapshotReset } from './usageLimit.ts';

const PREFIXES = ["You've hit your", "You've reached your", "You're out of usage credits"];

describe('limitPrefixes', () => {
  it('reads the SDK\'s list, and is empty when the SDK has none', () => {
    expect(limitPrefixes({ USAGE_LIMIT_ERROR_PREFIXES: PREFIXES })).toEqual(PREFIXES);
    expect(limitPrefixes({})).toEqual([]);
    expect(limitPrefixes(null)).toEqual([]);
    expect(limitPrefixes({ USAGE_LIMIT_ERROR_PREFIXES: 'nope' })).toEqual([]);
    expect(limitPrefixes({ USAGE_LIMIT_ERROR_PREFIXES: ['ok', 3, ''] })).toEqual(['ok']);
  });
});

describe('isUsageLimitText', () => {
  it('recognises Claude Code\'s usage limit messages, and nothing else', () => {
    expect(isUsageLimitText("You've hit your limit · resets 3pm (Europe/Brussels)", PREFIXES)).toBe(true);
    expect(isUsageLimitText("  You've reached your weekly limit", PREFIXES)).toBe(true);
    expect(isUsageLimitText('API Error: 529 Overloaded', PREFIXES)).toBe(false);
    expect(isUsageLimitText(null, PREFIXES)).toBe(false);
    expect(isUsageLimitText("You've hit your limit", [])).toBe(false);
  });
});

describe('resetMs', () => {
  it('takes seconds or ms', () => {
    expect(resetMs(1_760_000_000)).toBe(1_760_000_000_000);
    expect(resetMs(1_760_000_000_000)).toBe(1_760_000_000_000);
    expect(resetMs(undefined)).toBeNull();
    expect(resetMs(Number.NaN)).toBeNull();
  });
});

describe('limitStop', () => {
  it('stops on the message, with what the rate-limit update said', () => {
    const stop = limitStop({ error: "You've hit your limit · resets 3pm", rejected: null, last: { status: 'allowed_warning', rateLimitType: 'five_hour', resetsAt: 1_760_000_000 }, prefixes: PREFIXES });
    expect(stop).toEqual({ kind: 'five_hour', resetsAt: 1_760_000_000_000, message: "You've hit your limit · resets 3pm" });
  });

  it('stops on a rejected update without a message', () => {
    const stop = limitStop({ error: 'Something else', rejected: { status: 'rejected', rateLimitType: 'seven_day' }, last: null, prefixes: [] });
    expect(stop).toEqual({ kind: 'seven_day', resetsAt: null, message: null });
  });

  it('is null for any other failure', () => {
    expect(limitStop({ error: 'API Error: 500', rejected: null, last: { status: 'allowed' }, prefixes: PREFIXES })).toBeNull();
  });
});

describe('resumeTime', () => {
  it('waits the grace period after the reset', () => {
    expect(resumeTime(1_000_000)).toBe(1_000_000 + RESUME_GRACE_MS);
    expect(RESUME_GRACE_MS).toBe(30_000);
    expect(resumeTime(null)).toBeNull();
  });
});

describe('snapshotReset', () => {
  const meters = [
    { kind: 'session', percent: 100, resetsAt: 1000 },
    { kind: 'weekly_all', percent: 40, resetsAt: 9000 },
    { kind: 'weekly_scoped', percent: 100, resetsAt: 8000 },
  ];
  it('takes the meter of the limit\'s kind, else the full one', () => {
    expect(snapshotReset(meters, 'five_hour')).toBe(1000);
    expect(snapshotReset(meters, 'seven_day_opus')).toBe(8000);
    expect(snapshotReset(meters, null)).toBe(1000);
    expect(snapshotReset([], 'five_hour')).toBeNull();
  });
});

describe('remoteLimit', () => {
  const hit = { profileId: 'p', kind: 'five_hour', resetsAt: 5000, since: 1, message: null, sessionIds: ['a'] };
  const state = (extra: Partial<LimitsState> = {}): LimitsState => ({ limits: [hit], resumes: [], gaveUp: [], ...extra });

  it('is null while the profile is not at a limit', () => {
    expect(remoteLimit(state({ limits: [] }), 'a', 'p')).toBeNull();
    expect(remoteLimit(state(), 'a', 'other')).toBeNull();
  });

  it('says whether the limit stopped the session, and when it resumes', () => {
    expect(remoteLimit(state(), 'a', 'p')).toEqual({ stopped: true, kind: 'five_hour', resetsAt: 5000, resumeAt: null, gaveUp: false });
    expect(remoteLimit(state(), 'b', 'p')?.stopped).toBe(false);
    expect(remoteLimit(state({ resumes: [{ sessionId: 'b', profileId: 'p', at: 5030, attempts: 0 }] }), 'b', 'p')).toMatchObject({ stopped: true, resumeAt: 5030 });
    expect(remoteLimit(state({ gaveUp: ['b'] }), 'b', 'p')).toMatchObject({ stopped: true, gaveUp: true });
  });
});
