import { describe, expect, it } from 'vitest';
import type { RemoteMessage } from '@switchboard/protocol/remote-client';
import { formatTurnDuration, formatTurnTime, turnEnds, turnLine } from './turns.ts';

const T = Date.parse('2026-10-16T14:30:00Z');
const at = (s: number) => T + s * 1000;
const msg = (uuid: string, role: RemoteMessage['role'], timestamp: number, blocks: RemoteMessage['blocks']): RemoteMessage => ({ uuid, role, timestamp, parentToolUseId: null, blocks });
const text = (t: string) => ({ type: 'text' as const, text: t });
const call = { type: 'tool_use' as const, id: 't1', name: 'Bash', input: {}, truncated: false };
const result = { type: 'tool_result' as const, toolUseId: 't1', isError: false, text: 'ok', truncated: false };

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
        ['a2:0', { endedAt: at(134), durationMs: 134_000, stopped: false }],
        ['a3:0', { endedAt: at(205), durationMs: 5_000, stopped: false }],
      ]),
    );
  });

  it('leaves out the turn Claude still works on', () => {
    expect([...turnEnds(messages, true).keys()]).toEqual(['a2:0']);
  });

  it('says a turn you stopped was stopped', () => {
    const stopped = [msg('u1', 'user', at(0), [text('Go')]), msg('a1', 'assistant', at(5), [text('On it.'), call]), msg('i', 'user', at(62), [text('[Request interrupted by user]')])];
    expect(turnEnds(stopped, false).get('a1:0')).toEqual({ endedAt: at(62), durationMs: 62_000, stopped: true });
  });
});

describe('the line', () => {
  it('reads as the computer’s', () => {
    expect(formatTurnDuration(134_000)).toBe('2m 14s');
    expect(formatTurnTime(Date.parse('2026-10-16T14:32:00Z'), at(600), 'en-GB', 'UTC')).toBe('14:32');
    expect(formatTurnTime(Date.parse('2026-10-16T14:32:00Z'), at(600), 'en-US', 'UTC')).toBe('2:32 PM');
    expect(turnLine({ endedAt: Date.parse('2026-10-16T14:32:00Z'), durationMs: 62_000, stopped: true }, at(600), 'en-GB', 'UTC')).toBe('14:32 · Stopped after 1m 02s');
  });
});
