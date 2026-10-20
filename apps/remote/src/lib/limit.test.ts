import { describe, expect, it } from 'vitest';
import { clockTime } from '@switchboard/protocol/remote-client';
import { heldLine, limitHeadline, limitHolds, resumeLine } from './limit.ts';

const NOW = new Date(2026, 9, 15, 14, 0).getTime();
const MINUTE = 60_000;
/** The clock the way this machine writes it, so the test holds in any locale. */
const at = (offset: number) => clockTime(NOW + offset, NOW);

describe('the usage limit notice', () => {
  it('says which limit, when it resets and how long that is', () => {
    expect(limitHeadline({ kind: 'five_hour', resetsAt: NOW + 31 * MINUTE }, NOW)).toBe(`5-hour limit reached. Resets at ${at(31 * MINUTE)} · in 31m`);
    expect(limitHeadline({ kind: 'seven_day_opus', resetsAt: NOW + 182 * MINUTE }, NOW)).toBe(`Weekly Opus limit reached. Resets at ${at(182 * MINUTE)} · in 3h2m`);
  });

  it('copes with a limit Claude Code gave no time for, or one that has reset', () => {
    expect(limitHeadline({ kind: null, resetsAt: null }, NOW)).toBe('Usage limit reached.');
    expect(limitHeadline({ kind: 'five_hour', resetsAt: NOW - MINUTE }, NOW)).toBe(`5-hour limit reached. It reset at ${at(-MINUTE)}.`);
  });

  it('says when an armed session resumes and how many messages wait', () => {
    expect(resumeLine(NOW + 31 * MINUTE, NOW)).toBe(`Resumes at ${at(31 * MINUTE)}`);
    expect(heldLine(0)).toBeNull();
    expect(heldLine(1)).toBe('1 message held');
    expect(heldLine(3)).toBe('3 messages held');
  });

  it('holds until its reset, and without a time', () => {
    expect(limitHolds({ resetsAt: NOW + MINUTE }, NOW)).toBe(true);
    expect(limitHolds({ resetsAt: null }, NOW)).toBe(true);
    expect(limitHolds({ resetsAt: NOW - MINUTE }, NOW)).toBe(false);
  });
});
