import { describe, expect, it } from 'vitest';
import {
  describeTurn,
  durationWords,
  formatLiveDuration,
  formatTurnDuration,
  formatTurnTime,
  formatTurnTokens,
  lineParts,
  liveParts,
  modelTitle,
  sentLine,
  tokensHeading,
  tokenWords,
} from './turnFormat.ts';
import type { Turn } from './turns.ts';

const UTC = 'UTC';
const now = Date.parse('2026-10-16T15:00:00Z'); // a Friday

describe('formatTurnTime', () => {
  it('shows the time today, the day this week, the date this year, and the date with its year before', () => {
    expect(formatTurnTime(Date.parse('2026-10-16T14:32:00Z'), now, 'en-GB', UTC)).toBe('14:32');
    expect(formatTurnTime(Date.parse('2026-10-12T09:12:00Z'), now, 'en-GB', UTC)).toBe('Mon 09:12');
    expect(formatTurnTime(Date.parse('2026-10-03T14:32:00Z'), now, 'en-GB', UTC)).toBe('3 Oct 14:32');
    expect(formatTurnTime(Date.parse('2025-12-12T14:32:00Z'), now, 'en-GB', UTC)).toBe('12 Dec 2025');
  });

  it("follows the locale's clock, never a hard-coded 24 hours", () => {
    expect(formatTurnTime(Date.parse('2026-10-16T14:32:00Z'), now, 'en-US', UTC)).toBe('2:32 PM');
    expect(formatTurnTime(Date.parse('2026-10-12T09:12:00Z'), now, 'en-US', UTC)).toBe('Mon 9:12 AM');
  });

  it('counts days by the calendar in the time zone, not 24-hour steps', () => {
    // 23:30 yesterday in Brussels is not today, though it is less than a day ago.
    expect(formatTurnTime(Date.parse('2026-10-15T21:30:00Z'), now, 'en-GB', 'Europe/Brussels')).toBe('Thu 23:30');
  });
});

describe('sentLine', () => {
  it('says when a prompt was sent, and from which paired device', () => {
    expect(sentLine(Date.parse('2026-10-16T14:30:00Z'), null, now, 'en-GB', UTC)).toBe('Sent today at 14:30');
    expect(sentLine(Date.parse('2026-10-15T14:30:00Z'), "Elio's iPhone", now, 'en-GB', UTC)).toBe("Sent yesterday at 14:30 from Elio's iPhone");
    expect(sentLine(Date.parse('2026-03-03T08:05:00Z'), null, now, 'en-GB', UTC)).toBe('Sent 3 Mar at 08:05');
  });
});

describe('durations', () => {
  it('reads a finished turn as seconds, minutes and seconds, or hours and minutes', () => {
    expect(formatTurnDuration(48_000)).toBe('48s');
    expect(formatTurnDuration(134_000)).toBe('2m 14s');
    expect(formatTurnDuration(62_000)).toBe('1m 02s');
    expect(formatTurnDuration(3_900_000)).toBe('1h 05m');
  });

  it('keeps the live clock in minutes and seconds', () => {
    expect(formatLiveDuration(37_400)).toBe('0m 37s');
    expect(formatLiveDuration(70_000)).toBe('1m 10s');
    expect(formatLiveDuration(3_900_000)).toBe('1h 05m');
  });

  it('says them in words for screen readers', () => {
    expect(durationWords(134_000)).toBe('2 minutes 14 seconds');
    expect(durationWords(1_000)).toBe('1 second');
    expect(durationWords(120_000)).toBe('2 minutes');
    expect(durationWords(3_900_000)).toBe('1 hour 5 minutes');
  });
});

describe('tokens', () => {
  it('has one decimal under 100k, none above, and M for millions', () => {
    expect(formatTurnTokens(842)).toBe('842');
    expect(formatTurnTokens(18_400)).toBe('18.4k');
    expect(formatTurnTokens(18_000)).toBe('18k');
    expect(formatTurnTokens(184_300)).toBe('184k');
    expect(formatTurnTokens(1_240_000)).toBe('1.2M');
    expect(tokenWords(18_400)).toBe('18.4 thousand tokens');
    expect(tokenWords(1_240_000)).toBe('1.2 million tokens');
  });

  it('names the model with its version', () => {
    expect(modelTitle('claude-opus-5-5')).toBe('Opus 5.5');
    expect(modelTitle('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(modelTitle('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5');
    expect(modelTitle('claude-fable-5-1[1m]')).toBe('Fable 5.1');
  });
});

describe('narrow panes', () => {
  it('drops the tokens first, then the duration, and keeps the time', () => {
    expect(lineParts('tokens', 700)).toEqual({ time: true, duration: true, tokens: true });
    expect(lineParts('tokens', 500)).toEqual({ time: true, duration: true, tokens: false });
    expect(lineParts('tokens', 360)).toEqual({ time: true, duration: false, tokens: false });
    expect(lineParts('duration', 360)).toEqual({ time: true, duration: false, tokens: false });
    expect(lineParts('tokens', null)).toEqual({ time: true, duration: true, tokens: true });
  });
});

const turn = (o: Partial<Turn> = {}): Turn => ({
  key: 'p1',
  start: 0,
  end: 3,
  startedAt: Date.parse('2026-10-16T14:30:00Z'),
  endedAt: Date.parse('2026-10-16T14:32:14Z'),
  durationMs: 134_000,
  outcome: 'done',
  tokens: { input: 1_200, cacheRead: 15_000, cacheWrite: 1_700, output: 500, total: 18_400, replies: 4, model: 'claude-opus-5-5' },
  replyKey: 'r1',
  ...o,
});

describe('the setting', () => {
  const line = (mode: Parameters<typeof describeTurn>[1], t = turn(), width: number | null = 700) => describeTurn(t, mode, width, now, 'en-GB', UTC);

  it('shows nothing, the time, the time and duration, or all three', () => {
    expect(line('none')).toBeNull();
    expect(line('time')).toMatchObject({ time: '14:32', duration: null, tokens: null, label: 'Ended at 14:32' });
    expect(line('duration')).toMatchObject({ time: '14:32', duration: { text: '2m 14s', waiting: null, failed: false }, tokens: null, label: 'Ended at 14:32, took 2 minutes 14 seconds' });
    expect(line('tokens')).toMatchObject({ time: '14:32', duration: { text: '2m 14s' }, tokens: '18.4k tokens', label: 'Ended at 14:32, took 2 minutes 14 seconds, 18.4 thousand tokens' });
    expect(liveParts('none')).toEqual({ duration: false, tokens: false });
    expect(liveParts('time')).toEqual({ duration: false, tokens: false });
    expect(liveParts('duration')).toEqual({ duration: true, tokens: false });
    expect(liveParts('tokens')).toEqual({ duration: true, tokens: true });
  });

  it("puts what it leaves out in the time's tooltip", () => {
    expect(line('time')!.tooltip).toBe('Friday, 16 October 2026 at 14:32\nTook 2m 14s\n18.4k tokens · 4 replies');
    expect(line('tokens', turn(), 360)).toMatchObject({ duration: null, tokens: null });
  });

  it("shows Claude's own time, with the waiting in brackets", () => {
    expect(line('duration', turn({ durationMs: 60_000, waitingMs: 12_000 }))!.duration).toEqual({ text: '48s', waiting: '12s waiting on you', failed: false });
    expect(line('duration', turn({ durationMs: 60_000, waitingMs: 12_000 }))!.label).toBe('Ended at 14:32, took 48 seconds, 12 seconds waiting on you');
  });

  it('says a turn was stopped or failed', () => {
    expect(line('duration', turn({ durationMs: 62_000, outcome: 'stopped' }))!.duration).toEqual({ text: 'Stopped after 1m 02s', waiting: null, failed: false });
    expect(line('duration', turn({ durationMs: 18_000, outcome: 'failed' }))!.duration).toEqual({ text: 'Failed after 18s', waiting: null, failed: true });
  });

  it('shows no token part for a turn without usage', () => {
    expect(line('tokens', turn({ tokens: null }))).toMatchObject({ tokens: null, label: 'Ended at 14:32, took 2 minutes 14 seconds' });
  });

  it("heads the token tooltip with the turn's total and replies", () => {
    expect(tokensHeading(turn().tokens!)).toBe('18.4k tokens · this turn · 4 replies');
  });
});
