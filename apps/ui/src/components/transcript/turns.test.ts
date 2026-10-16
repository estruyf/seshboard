import { describe, expect, it } from 'vitest';
import type { DisplayItem, ReplyUsage } from './displayItems.ts';
import { buildTurns, claudeMs, liveTurn, updateTurns, type Wait } from './turns.ts';

const T = Date.parse('2026-10-16T14:00:00Z');
const s = (seconds: number) => T + seconds * 1000;

const usage = (id: string, o: Partial<ReplyUsage> = {}): ReplyUsage => ({ id, model: 'claude-opus-5-5', agent: null, input: 10, output: 100, cacheRead: 1000, cacheWrite: 200, ...o });

const prompt = (key: string, at: number, subagent = false): DisplayItem => ({ kind: 'user', key, at, text: 'Do it', images: [], subagent });
const command = (key: string, at: number, name = '/model'): DisplayItem => ({ kind: 'command', key, at, name, args: '' });
const reply = (key: string, at: number, o: { usage?: ReplyUsage; subagent?: boolean; failed?: true } = {}): DisplayItem => ({
  kind: 'text',
  key,
  at,
  text: 'Done.',
  subagent: o.subagent ?? false,
  ...(o.usage ? { usage: o.usage } : {}),
  ...(o.failed ? { failed: o.failed } : {}),
});
const tool = (key: string, at: number, o: { name?: string; id?: string; resultAt?: number | null; usage?: ReplyUsage; subagent?: boolean } = {}): DisplayItem => ({
  kind: 'tool',
  key,
  at,
  id: o.id ?? `toolu_${key}`,
  name: o.name ?? 'Bash',
  input: {},
  inputTruncated: false,
  result: o.resultAt === null ? null : { text: '', isError: false, truncated: false, images: [], at: o.resultAt ?? at + 1000 },
  subagent: o.subagent ?? false,
  ...(o.usage ? { usage: o.usage } : {}),
});
const notice = (key: string, at: number, text: string): DisplayItem => ({ kind: 'notice', key, at, text });

describe('turns', () => {
  it('starts a turn at each prompt of yours and ends it at the last thing Claude did', () => {
    const turns = buildTurns([prompt('p1', s(0)), tool('t1', s(2)), reply('r1', s(10)), prompt('p2', s(60)), reply('r2', s(108))]);
    expect(turns.map((t) => [t.key, t.start, t.end, t.replyKey, t.durationMs, t.outcome])).toEqual([
      ['p1', 0, 2, 'r1', 10_000, 'done'],
      ['p2', 3, 4, 'r2', 48_000, 'done'],
    ]);
    expect(turns[0]!.endedAt).toBe(s(10));
  });

  it("leaves out what comes before the first prompt, and a subagent's prompt doesn't start a turn", () => {
    const turns = buildTurns([notice('n0', s(-5), 'Conversation compacted'), prompt('p1', s(0)), tool('a', s(1), { name: 'Agent' }), prompt('sp', s(2), true), reply('sr', s(5), { subagent: true }), reply('r1', s(9))]);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ key: 'p1', start: 1, end: 5, replyKey: 'r1' });
  });

  it("doesn't start a turn at a command Claude Code handles itself, nor move the turn's end", () => {
    const turns = buildTurns([prompt('p1', s(0)), reply('r1', s(20)), command('c1', s(600)), notice('n1', s(600), 'Set model to Opus'), prompt('p2', s(700)), reply('r2', s(710))]);
    expect(turns.map((t) => [t.key, t.end, t.durationMs])).toEqual([
      ['p1', 3, 20_000],
      ['p2', 5, 10_000],
    ]);
  });

  it('starts a turn at a command Claude works on', () => {
    const turns = buildTurns([prompt('p1', s(0)), reply('r1', s(20)), command('c1', s(600), '/review'), tool('t1', s(602)), reply('r2', s(640))]);
    expect(turns.map((t) => [t.key, t.replyKey, t.durationMs])).toEqual([
      ['p1', 'r1', 20_000],
      ['c1', 'r2', 40_000],
    ]);
  });

  it('keeps a message you steered or queued while Claude worked in the turn it was handled in', () => {
    const items = [prompt('p1', s(0)), tool('t1', s(1), { resultAt: s(30) }), prompt('steer', s(31)), tool('t2', s(32)), reply('r1', s(50)), prompt('p2', s(90)), reply('r2', s(95))];
    const turns = buildTurns(items);
    expect(turns.map((t) => [t.key, t.end, t.replyKey])).toEqual([
      ['p1', 4, 'r1'],
      ['p2', 6, 'r2'],
    ]);
  });

  it('starts a new turn at a prompt sent long after a session stopped mid-step', () => {
    const turns = buildTurns([prompt('p1', s(0)), tool('t1', s(1), { resultAt: null }), prompt('p2', s(3 * 3600)), reply('r2', s(3 * 3600 + 5))]);
    expect(turns.map((t) => t.key)).toEqual(['p1', 'p2']);
  });

  it('counts a question or a plan as time waiting on you, and leaves waiting out when it isn’t known', () => {
    const turns = buildTurns([
      prompt('p1', s(0)),
      tool('q', s(5), { name: 'AskUserQuestion', resultAt: s(17) }),
      reply('r1', s(48)),
      prompt('p2', s(100)),
      tool('t2', s(101)),
      reply('r2', s(130)),
    ]);
    expect(turns[0]).toMatchObject({ durationMs: 48_000, waitingMs: 12_000 });
    expect(claudeMs(turns[0]!)).toBe(36_000);
    expect(turns[1]!.waitingMs).toBeUndefined();
    expect(claudeMs(turns[1]!)).toBe(30_000);
  });

  it('adds the permission prompts answered in this window, by tool call or by when they asked', () => {
    const waits: Wait[] = [
      { toolUseId: 'toolu_t1', from: s(2), to: s(9) },
      { toolUseId: null, from: s(20), to: s(25) },
      { toolUseId: null, from: s(200), to: s(210) },
      { toolUseId: 'toolu_elsewhere', from: s(3), to: s(4) },
    ];
    const turns = buildTurns([prompt('p1', s(0)), tool('t1', s(1), { resultAt: s(10) }), reply('r1', s(40)), prompt('p2', s(100)), reply('r2', s(220))], { waits });
    expect(turns[0]!.waitingMs).toBe(12_000);
    expect(turns[1]!.waitingMs).toBe(10_000);
  });

  it('is stopped when you interrupted it, and failed when it ended on an API error', () => {
    const turns = buildTurns([
      prompt('p1', s(0)),
      reply('r1', s(10)),
      tool('t1', s(20), { resultAt: null }),
      notice('i1', s(62), 'Interrupted by you'),
      prompt('p2', s(100)),
      reply('r2', s(118), { failed: true }),
      prompt('p3', s(200)),
      reply('bad', s(205), { failed: true }),
      tool('t3', s(206)),
      reply('r3', s(210)),
    ]);
    expect(turns.map((t) => [t.outcome, t.durationMs, t.replyKey])).toEqual([
      ['stopped', 62_000, 'r1'],
      ['failed', 18_000, 'r2'],
      ['done', 10_000, 'r3'],
    ]);
  });

  it('sums every reply once, with what its subagents used', () => {
    const items = [
      prompt('p1', s(0)),
      // One response, written as two items: counted once.
      tool('t1', s(1), { usage: usage('msg_1') }),
      tool('a1', s(2), { name: 'Agent', id: 'toolu_agent', usage: usage('msg_1') }),
      reply('sr', s(3), { subagent: true, usage: usage('msg_sub', { agent: 'toolu_agent', model: 'claude-haiku-4-5' }) }),
      reply('r1', s(9), { usage: usage('msg_2', { output: 50 }) }),
    ];
    // While the subagent's transcript isn't read, its replies count as they stream in.
    expect(buildTurns(items)[0]!.tokens).toEqual({ input: 30, cacheRead: 3000, cacheWrite: 600, output: 250, total: 3880, replies: 3, model: null });
    // Once it is, its own count replaces them.
    const agents = new Map([['toolu_agent', { model: 'claude-opus-5-5', input: 5, output: 7, cacheRead: 11, cacheWrite: 13, replies: 4 }]]);
    expect(buildTurns(items, { agents })[0]!.tokens).toEqual({ input: 25, cacheRead: 2011, cacheWrite: 413, output: 157, total: 2606, replies: 6, model: 'claude-opus-5-5' });
  });

  it('has no tokens for a turn without usage, never zero', () => {
    expect(buildTurns([prompt('p1', s(0)), reply('r1', s(5))])[0]!.tokens).toBeNull();
  });

  it('groups only the open turn again as messages land', () => {
    const first = [prompt('p1', s(0)), reply('r1', s(5)), prompt('p2', s(10)), tool('t2', s(11))];
    const before = updateTurns(null, first);
    const after = updateTurns(before, [...first.map((i) => ({ ...i })), reply('r2', s(20))]);
    expect(after.turns[0]).toBe(before.turns[0]);
    expect(after.turns[1]).toMatchObject({ key: 'p2', replyKey: 'r2', durationMs: 10_000 });
    // A rewind replaces the messages: everything is grouped again.
    const rewound = updateTurns(after, [prompt('p1', s(0)), reply('other', s(7))]);
    expect(rewound.turns).toEqual([expect.objectContaining({ key: 'p1', replyKey: 'other' })]);
  });

  it("doesn't count a prompt that waits on you as Claude's time", () => {
    const turn = { startedAt: s(0), waitingMs: 5_000 };
    expect(liveTurn(turn, s(40), null)).toEqual({ workedMs: 35_000, waiting: false });
    expect(liveTurn(turn, s(90), s(75))).toEqual({ workedMs: 70_000, waiting: true });
  });
});
