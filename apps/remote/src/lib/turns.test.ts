import { describe, expect, it } from 'vitest';
import type { RemoteMessage } from '@seshboard/protocol/remote-client';
import { formatTurnDuration, formatTurnTime, formatTurnTokens, readingOf, turnEnds, turnLine } from './turns.ts';

const T = Date.parse('2026-10-16T14:30:00Z');
const at = (s: number) => T + s * 1000;
const msg = (uuid: string, role: RemoteMessage['role'], timestamp: number, blocks: RemoteMessage['blocks']): RemoteMessage => ({ uuid, role, timestamp, parentToolUseId: null, blocks });
const text = (t: string) => ({ type: 'text' as const, text: t });
const call = { type: 'tool_use' as const, id: 't1', name: 'Bash', input: {}, truncated: false };
const result = { type: 'tool_result' as const, toolUseId: 't1', isError: false, text: 'ok', truncated: false };
/** The tokens of one response: input 10, cache read 1000, cache write 100, output 50 (1,160 in all). */
const usage = (id: string) => ({ id, input: 10, output: 50, cacheRead: 1000, cacheWrite: 100 });

describe('turnEnds', () => {
  const messages = [
    msg('u1', 'user', at(0), [text('Fix it')]),
    msg('a1', 'assistant', at(2), [call]),
    msg('r1', 'user', at(30), [result]),
    msg('s1', 'user', at(31), [text('Also the docs')]),
    msg('a2', 'assistant', at(134), [text('Done.')]),
    msg('u2', 'user', at(200), [text('Thanks')]),
    msg('a3', 'assistant', at(205), [text('You’re welcome.')]),
  ];

  it('times each finished turn under its last reply, keeping a steered message in its turn', () => {
    expect(turnEnds(messages, false)).toEqual(
      new Map([
        ['a2:0', { endedAt: at(134), durationMs: 134_000, stopped: false, tokens: null, texts: ['Done.'] }],
        ['a3:0', { endedAt: at(205), durationMs: 5_000, stopped: false, tokens: null, texts: ['You’re welcome.'] }],
      ]),
    );
  });

  it('leaves out the turn Claude still works on', () => {
    expect([...turnEnds(messages, true).keys()]).toEqual(['a2:0']);
  });

  it('says a turn you stopped was stopped', () => {
    const stopped = [msg('u1', 'user', at(0), [text('Go')]), msg('a1', 'assistant', at(5), [text('On it.'), call]), msg('i', 'user', at(62), [text('[Request interrupted by user]')])];
    expect(turnEnds(stopped, false).get('a1:0')).toEqual({ endedAt: at(62), durationMs: 62_000, stopped: true, tokens: null, texts: ['On it.'] });
  });

  it('adds up the tokens of a turn once per response, since each block repeats its response’s usage', () => {
    const withUsage = [
      msg('u1', 'user', at(0), [text('Go')]),
      { ...msg('a1', 'assistant', at(5), [text('Looking.')]), usage: usage('resp-1') },
      { ...msg('a2', 'assistant', at(6), [call]), usage: usage('resp-1') },
      { ...msg('a3', 'assistant', at(9), [text('Done.')]), usage: usage('resp-2') },
    ];
    expect(turnEnds(withUsage, false).get('a3:0')?.tokens).toBe(2 * 1160);
  });

  it('counts subagents’ replies in the turn that started them', () => {
    const withAgent = [
      msg('u1', 'user', at(0), [text('Go')]),
      { ...msg('s1', 'assistant', at(3), [text('Searching.')]), parentToolUseId: 'agent-1', usage: usage('sub-1') },
      { ...msg('a1', 'assistant', at(8), [text('Found it.')]), usage: usage('resp-1') },
    ];
    expect(turnEnds(withAgent, false).get('a1:0')?.tokens).toBe(2 * 1160);
  });

  it('has no tokens when no reply reported any (an older computer)', () => {
    expect(turnEnds(messages, false).get('a2:0')?.tokens).toBeNull();
  });

  it('keeps every text reply of the turn for Read, in order, and not a subagent’s', () => {
    const reading = [
      msg('u1', 'user', at(0), [text('Explain')]),
      msg('a1', 'assistant', at(2), [text('First, the setup.'), call]),
      { ...msg('s1', 'assistant', at(3), [text('Sub-agent note.')]), parentToolUseId: 'agent-1' },
      msg('a2', 'assistant', at(9), [text('Then the rest.')]),
    ];
    expect(turnEnds(reading, false).get('a2:0')?.texts).toEqual(['First, the setup.', 'Then the rest.']);
  });
});

describe('the line', () => {
  it('reads as the computer’s', () => {
    expect(formatTurnDuration(134_000)).toBe('2m 14s');
    expect(formatTurnTime(Date.parse('2026-10-16T14:32:00Z'), at(600), 'en-GB', 'UTC')).toBe('14:32');
    expect(formatTurnTime(Date.parse('2026-10-16T14:32:00Z'), at(600), 'en-US', 'UTC')).toBe('2:32 PM');
    expect(turnLine({ endedAt: Date.parse('2026-10-16T14:32:00Z'), durationMs: 62_000, stopped: true, tokens: null, texts: [] }, at(600), 'en-GB', 'UTC')).toBe('14:32 · Stopped after 1m 02s');
  });

  it('adds the tokens after the duration, as the computer does', () => {
    const end = { endedAt: Date.parse('2026-10-16T14:32:00Z'), durationMs: 134_000, stopped: false, tokens: 18_400, texts: [] };
    expect(turnLine(end, at(600), 'en-GB', 'UTC')).toBe('14:32 · 2m 14s · 18.4k tokens');
  });

  it('formats token counts as the computer does', () => {
    expect(formatTurnTokens(842)).toBe('842');
    expect(formatTurnTokens(18_400)).toBe('18.4k');
    expect(formatTurnTokens(184_000)).toBe('184k');
    expect(formatTurnTokens(1_200_000)).toBe('1.2M');
  });

  it('measures a reply in words and minutes, at least a minute when there are words', () => {
    expect(readingOf(['one two three', 'four'])).toEqual({ words: 4, minutes: 1 });
    expect(readingOf([Array(461).fill('word').join(' ')])).toEqual({ words: 461, minutes: 3 });
    expect(readingOf([])).toEqual({ words: 0, minutes: 0 });
  });
});
