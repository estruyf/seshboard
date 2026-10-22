import { describe, expect, it } from 'vitest';
import type { DisplayItem } from './displayItems.ts';
import { countWords, currentHeading, readableTurns, readReply, replyOutline, type ReadBlock } from './readReply.ts';
import { buildTurns } from './turns.ts';

// Prompts are an hour apart (by the number in their key), so a prompt after a tool call isn't taken for a steer.
const prompt = (key: string): DisplayItem => ({ kind: 'user', key, at: Number(key.replace(/\D/g, '') || 0) * 3_600_000, text: 'Do it', images: [], subagent: false });
const text = (key: string, body: string, subagent = false): DisplayItem => ({ kind: 'text', key, at: 1, text: body, subagent });
const thinking = (key: string): DisplayItem => ({ kind: 'thinking', key, at: 1, text: 'hmm' });
const tool = (key: string, name: string, input: unknown = {}, subagent = false): DisplayItem => ({
  kind: 'tool',
  key,
  at: 1,
  id: `toolu_${key}`,
  name,
  input,
  inputTruncated: false,
  result: { text: '', isError: false, truncated: false, images: [], at: 2 },
  subagent,
});

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const textBlock = (body: string): ReadBlock => ({ kind: 'text', key: 'b', text: body });

function read(items: DisplayItem[], turnKey: string, streaming?: string | null) {
  return readReply(items, buildTurns(items), turnKey, streaming);
}

describe('the outline of a reply', () => {
  it('lists headings of level 1 to 3 in order and ignores deeper ones', () => {
    const outline = replyOutline([textBlock('# One\n\ntext\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five')]);
    expect(outline.map((e) => [e.id, e.level, e.text, e.block])).toEqual([
      ['one', 1, 'One', 'b'],
      ['two', 2, 'Two', 'b'],
      ['three', 3, 'Three', 'b'],
    ]);
  });

  it('is empty without headings', () => {
    expect(replyOutline([textBlock('Just a paragraph.\n\n- and a list')])).toEqual([]);
  });

  it('does not count a # inside a code block', () => {
    const body = ['## Real', '', '```md', '# not a heading', '## nor this', '```', '', '    # indented code', '', '> # in a quote'].join('\n');
    expect(replyOutline([textBlock(body)]).map((e) => e.text)).toEqual(['Real']);
  });

  it('makes ids from the text, numbers repeats across blocks, and falls back to section', () => {
    const blocks: ReadBlock[] = [
      { kind: 'text', key: 'a', text: '## Why it works!\n\n## **Bold** `code`' },
      { kind: 'tools', key: 't', items: [] },
      { kind: 'text', key: 'b', text: '## Why it works!\n\n## Why it works!\n\n## !!!' },
    ];
    const outline = replyOutline(blocks);
    expect(outline.map((e) => e.id)).toEqual(['why-it-works', 'bold-code', 'why-it-works-2', 'why-it-works-3', 'section']);
    expect(outline.map((e) => e.block)).toEqual(['a', 'a', 'b', 'b', 'b']);
    expect(outline[1]!.text).toBe('Bold code');
    // The same text gives the same ids again.
    expect(replyOutline(blocks)).toEqual(outline);
  });
});

describe('words and reading time', () => {
  it('counts prose words and skips code', () => {
    expect(countWords('Hello there, world.\n\n```ts\nconst a = 1; const b = 2;\n```\n\nSee [the docs](https://example.com/a/b) now.')).toBe(7);
    expect(countWords('')).toBe(0);
  });

  it('rounds minutes up at 230 words a minute, with a minimum of one', () => {
    const at = (n: number) => read([prompt('p'), text('r', words(n))], 'p')!.minutes;
    expect(at(0)).toBe(0);
    expect(at(1)).toBe(1);
    expect(at(230)).toBe(1);
    expect(at(231)).toBe(2);
    expect(at(690)).toBe(3);
    expect(read([prompt('p'), text('r', words(300))], 'p')!.words).toBe(300);
  });
});

describe('which replies can be read', () => {
  const items = [prompt('p1'), text('r1', 'First.'), prompt('p2'), tool('t1', 'Bash'), prompt('p3'), text('r3', 'Third.'), prompt('p4'), text('r4', 'Fourth.')];

  it('leaves out a turn with only tool calls', () => {
    const turns = buildTurns(items);
    expect(readableTurns(items, turns).map((t) => t.key)).toEqual(['p1', 'p3', 'p4']);
    expect(readReply(items, turns, 'p2')).toBeNull();
    expect(readReply(items, turns, 'missing')).toBeNull();
  });

  it('counts a subagent text as no reply', () => {
    const only = [prompt('p1'), tool('a', 'Agent'), text('s', 'Inside.', true)];
    expect(readableTurns(only, buildTurns(only))).toEqual([]);
  });

  it('knows its place and its neighbours, null at both ends', () => {
    const turns = buildTurns(items);
    const first = readReply(items, turns, 'p1')!;
    expect([first.index, first.total, first.previous, first.next]).toEqual([0, 3, null, 'p3']);
    const middle = readReply(items, turns, 'p3')!;
    expect([middle.index, middle.previous, middle.next]).toEqual([1, 'p1', 'p4']);
    const last = readReply(items, turns, 'p4')!;
    expect([last.index, last.previous, last.next]).toEqual([2, 'p3', null]);
  });
});

describe('the blocks of a reply', () => {
  it('puts tool calls between the texts where they happened, without the prompt or thinking', () => {
    const items = [prompt('p'), thinking('th'), text('a', 'Before.'), tool('t1', 'Read'), tool('t2', 'Bash'), text('b', 'Middle.'), tool('t3', 'Edit'), text('c', 'After.')];
    const reply = read(items, 'p')!;
    expect(reply.blocks.map((b) => [b.kind, b.key])).toEqual([
      ['text', 'a'],
      ['tools', 'tools-t1'],
      ['text', 'b'],
      ['tools', 'tools-t3'],
      ['text', 'c'],
    ]);
    expect((reply.blocks[1] as { items: DisplayItem[] }).items.map((i) => i.key)).toEqual(['t1', 't2']);
    expect(reply.tools.map((t) => t.key)).toEqual(['t1', 't2', 't3']);
  });

  it("keeps a subagent's output in the turn it ran in", () => {
    const items = [prompt('p'), tool('agent', 'Agent'), tool('sub', 'Grep', {}, true), text('subtext', 'Found it.', true), text('r', 'Done.')];
    const reply = read(items, 'p')!;
    const run = reply.blocks[0] as { kind: 'tools'; items: DisplayItem[] };
    expect(run.items.map((i) => i.key)).toEqual(['agent', 'sub', 'subtext']);
    expect(reply.tools.map((t) => t.key)).toEqual(['agent', 'sub']);
    expect(reply.blocks.filter((b) => b.kind === 'text').map((b) => b.key)).toEqual(['r']);
    expect(reply.words).toBe(1);
  });

  it('summarises mixed tools with files counted once', () => {
    const items = [
      prompt('p'),
      tool('t1', 'Read', { file_path: '/a.ts' }),
      tool('t2', 'Read', { file_path: '/b.ts' }),
      tool('t3', 'Bash', { command: 'ls' }),
      tool('t4', 'Bash', { command: 'pwd' }),
      tool('t5', 'Edit', { file_path: '/a.ts' }),
      text('r', 'Done.'),
    ];
    expect(read(items, 'p')!.toolSummary).toBe('Ran 2 commands, edited a file and read 2 files');
  });

  it('has an empty summary without tools', () => {
    expect(read([prompt('p'), text('r', 'Hi')], 'p')!.toolSummary).toBe('');
  });
});

describe('a reply that is still streaming', () => {
  const items = [prompt('p1'), text('r1', '## Done part'), prompt('p2'), tool('t', 'Bash')];

  it('adds the streaming text to the last turn, so headings and words follow it', () => {
    const reply = read(items, 'p2', 'Intro words.\n\n## Coming up\n\nMore words here.')!;
    expect(reply.blocks.at(-1)).toEqual({ kind: 'text', key: 'streaming', text: 'Intro words.\n\n## Coming up\n\nMore words here.' });
    expect(reply.outline.map((e) => [e.text, e.block])).toEqual([['Coming up', 'streaming']]);
    expect(reply.words).toBe(7);
    // It is not in the readable list yet, so it comes after the others.
    expect([reply.index, reply.total, reply.previous, reply.next]).toEqual([1, 2, 'p1', null]);
  });

  it('adds the text to a last turn that already has a reply', () => {
    const more = [prompt('p'), text('a', '# Title'), tool('t', 'Bash')];
    const reply = read(more, 'p', '## Next')!;
    expect(reply.outline.map((e) => e.id)).toEqual(['title', 'next']);
    expect(reply.total).toBe(1);
  });

  it('ignores the streaming text for an earlier turn, and an empty one', () => {
    expect(read(items, 'p1', 'Not mine')!.blocks).toHaveLength(1);
    expect(read(items, 'p2', '')).toBeNull();
    expect(read(items, 'p2', null)).toBeNull();
  });
});

describe('the heading at a scroll position', () => {
  const tops = [100, 600, 1400];

  it('is -1 before the first heading', () => {
    expect(currentHeading(tops, 0)).toBe(-1);
    expect(currentHeading([], 500)).toBe(-1);
  });

  it('switches a little before a heading reaches the top', () => {
    expect(currentHeading(tops, 20)).toBe(0);
    expect(currentHeading(tops, 519)).toBe(0);
    expect(currentHeading(tops, 520)).toBe(1);
    expect(currentHeading(tops, 5000)).toBe(2);
  });

  it('takes its own offset', () => {
    expect(currentHeading(tops, 600, 0)).toBe(1);
    expect(currentHeading(tops, 599, 0)).toBe(0);
  });
});
