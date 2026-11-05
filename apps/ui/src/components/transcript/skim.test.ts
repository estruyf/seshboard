import { describe, expect, it } from 'vitest';
import { groupActivity, isFoldedMessage, type DisplayItem, type RenderItem } from './displayItems.ts';
import { findMatches, searchableText } from './findInSession.ts';
import { foldedLabel, foldedMessages, latestTests, statParts, turnStats } from './skim.ts';
import { buildTurns } from './turns.ts';

const prompt = (key: string, at: number | null = 0): DisplayItem => ({ kind: 'user', key, at, text: 'Do it', images: [], subagent: false });
const text = (key: string, value = 'Let me look.', extra: Partial<Extract<DisplayItem, { kind: 'text' }>> = {}): DisplayItem => ({ kind: 'text', key, at: 0, text: value, subagent: false, ...extra });
const tool = (key: string, name = 'Read', input: unknown = {}, result: { isError: boolean } | null = { isError: false }, subagent = false): DisplayItem => ({
  kind: 'tool',
  key,
  at: 0,
  id: key,
  name,
  input,
  inputTruncated: false,
  result: result && { text: '', isError: result.isError, truncated: false, images: [], at: 0 },
  subagent,
});

describe('foldedMessages', () => {
  it('folds messages with a tool call after them, never the last reply', () => {
    const items = [prompt('p'), text('a'), tool('t1'), text('b'), tool('t2'), text('reply')];
    expect([...foldedMessages(items, buildTurns(items), null)].sort()).toEqual(['a', 'b']);
  });

  it('leaves a turn that is still running as it is', () => {
    const items = [prompt('p1'), text('a'), tool('t1'), text('reply1'), prompt('p2'), text('c'), tool('t2')];
    const turns = buildTurns(items);
    expect([...foldedMessages(items, turns, turns.at(-1)!)]).toEqual(['a']);
  });

  it('keeps the last reply open when a tool call came after it', () => {
    const items = [prompt('p'), tool('t1'), text('reply'), tool('t2')];
    expect(foldedMessages(items, buildTurns(items), null).size).toBe(0);
  });

  it('keeps messages with no tool call after them, an API error and a subagent’s text out of it', () => {
    const items = [prompt('p'), text('error', 'API Error: 529', { failed: true }), text('sub', 'Working', { subagent: true }), tool('t1'), text('first'), text('reply')];
    expect(foldedMessages(items, buildTurns(items), null).size).toBe(0);
  });

  it('a turn without tool calls folds nothing', () => {
    const items = [prompt('p'), text('reply')];
    expect(foldedMessages(items, buildTurns(items), null).size).toBe(0);
  });
});

describe('groupActivity with folded messages', () => {
  const items = [prompt('p'), text('a', 'First look at needle here'), tool('t1'), text('b', 'Second needle and needle'), tool('t2'), text('reply', 'The needle reply')];
  const folded = foldedMessages(items, buildTurns(items), null);
  const grouped = groupActivity(items, () => false, folded);

  it('puts them in one group, with the prompt and the reply outside it', () => {
    expect(grouped.map((item) => item.kind)).toEqual(['user', 'activity', 'text']);
    const group = grouped[1] as Extract<RenderItem, { kind: 'activity' }>;
    expect(group.items.map((item) => item.key)).toEqual(['a', 't1', 'b', 't2']);
    expect(group.items.filter(isFoldedMessage).map((item) => item.key)).toEqual(['a', 'b']);
  });

  it('without folded messages, a message still breaks the run', () => {
    expect(groupActivity(items).map((item) => item.kind)).toEqual(['user', 'text', 'activity', 'text', 'activity', 'text']);
  });

  it('find still counts what is in the folded messages, and only that', () => {
    expect(searchableText(grouped[1]!)).toBe('First look at needle here\n\nSecond needle and needle');
    expect(findMatches(grouped, 'needle').map((match) => match.index)).toEqual([1, 1, 1, 2]);
    expect(searchableText(groupActivity([tool('t3')])[0]!)).toBeNull();
  });
});

describe('foldedLabel', () => {
  it('counts messages and steps', () => {
    expect(foldedLabel(3, 9)).toBe('3 messages and 9 steps');
    expect(foldedLabel(1, 1)).toBe('1 message and 1 step');
    expect(foldedLabel(1, 0)).toBe('1 message');
  });
});

describe('turnStats', () => {
  const edit = (key: string, file: string, before: string, after: string, result: { isError: boolean } | null = { isError: false }) => tool(key, 'Edit', { file_path: file, old_string: before, new_string: after }, result);

  it('counts lines and files from the file tools that went through', () => {
    const items = [
      prompt('p', 1_000),
      edit('e1', '/a.ts', 'one\ntwo\n', 'one\nTWO\nthree\n'),
      edit('e2', '/a.ts', 'x\n', 'y\n'),
      tool('w', 'Write', { file_path: '/b.ts', content: 'a\nb\nc\n' }),
      edit('failed', '/c.ts', 'x\n', 'y\n', { isError: true }),
      edit('declined', '/d.ts', 'x\n', 'y\n', null),
      tool('r', 'Read', { file_path: '/e.ts' }),
    ];
    const stats = turnStats(items, buildTurns(items)[0]!, null);
    expect(stats).toMatchObject({ added: 6, removed: 2, files: 2, tests: null });
  });

  it('leaves out the time waiting on you', () => {
    const items: DisplayItem[] = [prompt('p', 0), { ...tool('q', 'AskUserQuestion'), at: 1_000, result: { text: '', isError: false, truncated: false, images: [], at: 61_000 } } as DisplayItem, { ...text('reply'), at: 65_000 }];
    expect(turnStats(items, buildTurns(items)[0]!, null).durationMs).toBe(5_000);
  });
});

describe('statParts', () => {
  const stats = { added: 42, removed: 7, files: 3, tests: null, durationMs: 252_000 };
  const texts = (s: Parameters<typeof statParts>[0]) => statParts(s).map((part) => part.text);

  it('reads like the issue’s example', () => {
    expect(texts({ ...stats, tests: { state: 'failed', failed: 2, passed: 40 } })).toEqual(['+42', '−7', '3 files', '2 tests fail', '4m 12s']);
  });
  it('words test results', () => {
    expect(texts({ ...stats, tests: { state: 'passed' } })).toContain('tests pass');
    expect(texts({ ...stats, tests: { state: 'failed', failed: 1 } })).toContain('1 test fails');
    expect(texts({ ...stats, tests: { state: 'failed' } })).toContain('tests fail');
    expect(texts({ ...stats, tests: { state: 'notRun' } })).toEqual(['+42', '−7', '3 files', '4m 12s']);
  });
  it('leaves out what is zero', () => {
    expect(texts({ ...stats, added: 5, removed: 0, files: 1 })).toEqual(['+5', '1 file', '4m 12s']);
  });
  it('has no line for a turn that changed nothing and ran no tests', () => {
    expect(statParts({ added: 0, removed: 0, files: 0, tests: null, durationMs: 4_000 })).toEqual([]);
    expect(statParts({ added: 0, removed: 0, files: 0, tests: { state: 'notRun' }, durationMs: 4_000 })).toEqual([]);
  });
  it('shows a test result without edits', () => {
    expect(texts({ added: 0, removed: 0, files: 0, tests: { state: 'passed' }, durationMs: 9_000 })).toEqual(['tests pass', '9s']);
  });
});

describe('latestTests', () => {
  const items = [prompt('p1'), text('uuid-a:0'), prompt('p2'), tool('uuid-b:1'), text('uuid-c:0')];
  const turns = buildTurns(items);
  const card = (turnId: string) => ({ turnId, signals: { tests: { state: 'passed' as const }, diff: null, outOfScope: [], scope: null, plan: null } });

  it('takes the tests when the card is about the latest turn', () => {
    expect(latestTests(card('uuid-c'), items, turns.at(-1))).toEqual({ turn: turns.at(-1), tests: { state: 'passed' } });
  });
  it('leaves them out when the card is about an earlier turn, or there is none', () => {
    expect(latestTests(card('uuid-a'), items, turns.at(-1))).toBeNull();
    expect(latestTests(null, items, turns.at(-1))).toBeNull();
  });
});
