import { describe, expect, it } from 'vitest';
import type { LimitsState, UsageLimitHit } from '@switchboard/protocol/client';
import { clockTime, heldLine, limitHeadline, limitName, limitStanding, resumeLine, rowLimitLabel } from './usageLimit.ts';

const NOW = new Date(2026, 9, 15, 10, 34).getTime();
const at = (hours: number, minutes = 0) => new Date(2026, 9, 15, hours, minutes).getTime();
const limit = (extra: Partial<UsageLimitHit> = {}): UsageLimitHit => ({ profileId: 'default', kind: 'five_hour', resetsAt: at(15, 16), since: NOW, message: null, sessionIds: ['s1'], ...extra });

describe('limitName', () => {
  it('says the kind in plain words', () => {
    expect(limitName('five_hour')).toBe('5-hour limit');
    expect(limitName('seven_day')).toBe('Weekly limit');
    expect(limitName('seven_day_opus')).toBe('Weekly Opus limit');
    expect(limitName(null)).toBe('Usage limit');
    expect(limitName('something_new')).toBe('Usage limit');
  });
});

describe('clockTime', () => {
  it('gives the time today, and the weekday further away', () => {
    expect(clockTime(at(15, 16), NOW, 'en-GB')).toBe('15:16');
    expect(clockTime(new Date(2026, 9, 19, 9, 0).getTime(), NOW, 'en-GB')).toBe('Mon 09:00');
  });
});

describe('limitHeadline', () => {
  it('says which limit, when it resets and how long that is', () => {
    expect(limitHeadline(limit(), NOW, 'en-GB')).toBe('5-hour limit reached. Resets at 15:16 · in 4h 42m');
  });
  it('leaves the time out when Claude Code gave none', () => {
    expect(limitHeadline(limit({ resetsAt: null, kind: null }), NOW, 'en-GB')).toBe('Usage limit reached.');
  });
  it('says it has reset once the time has passed', () => {
    expect(limitHeadline(limit({ resetsAt: at(10, 0) }), NOW, 'en-GB')).toBe('5-hour limit reached. It reset at 10:00.');
  });
});

describe('the other lines', () => {
  it('says when an armed session resumes, how many messages are held and what the row shows', () => {
    expect(resumeLine({ sessionId: 's1', profileId: 'default', at: at(15, 16) + 30_000, attempts: 0 }, NOW, 'en-GB')).toBe('Resumes at 15:16');
    expect(heldLine(0)).toBeNull();
    expect(heldLine(1)).toBe('1 message held');
    expect(heldLine(3)).toBe('3 messages held');
    expect(rowLimitLabel(limit(), NOW, 'en-GB')).toBe('Usage limit · resets 15:16');
    expect(rowLimitLabel(limit({ resetsAt: null }), NOW, 'en-GB')).toBe('Usage limit');
  });
});

describe('limitStanding', () => {
  const state = (extra: Partial<LimitsState> = {}): LimitsState => ({ limits: [limit()], resumes: [], gaveUp: [], ...extra });
  it('tells a session the limit stopped from one that is only at it', () => {
    expect(limitStanding(state(), 's1', 'default')).toMatchObject({ kind: 'stopped', resume: null, gaveUp: false });
    expect(limitStanding(state(), 's2', 'default')).toMatchObject({ kind: 'at' });
    expect(limitStanding(state(), 's1', 'work')).toBeNull();
  });
  it('keeps an armed or given-up session as stopped after its resume took it off the list', () => {
    const resume = { sessionId: 's2', profileId: 'default', at: at(15, 17), attempts: 1 };
    expect(limitStanding(state({ resumes: [resume] }), 's2', 'default')).toMatchObject({ kind: 'stopped', resume });
    expect(limitStanding(state({ gaveUp: ['s3'] }), 's3', 'default')).toMatchObject({ kind: 'stopped', gaveUp: true });
  });
});
