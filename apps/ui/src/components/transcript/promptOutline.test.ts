import { describe, expect, it } from 'vitest';
import type { TranscriptMessage } from '@switchboard/protocol/client';
import { buildDisplayItems, groupActivity } from './displayItems.ts';
import {
  currentPrompt,
  isPrompt,
  layoutMarks,
  markLabel,
  MARK_GAP,
  nearestMark,
  nextPrompt,
  outlinePrompts,
  previousPrompt,
  promptKeysBlocked,
  type OutlinePrompt,
} from './promptOutline.ts';

let n = 0;
const message = (role: TranscriptMessage['role'], blocks: TranscriptMessage['blocks'], parentToolUseId: string | null = null): TranscriptMessage => ({
  uuid: `m${++n}`,
  role,
  timestamp: 1_700_000_000_000 + n * 1_000,
  parentToolUseId,
  model: null,
  blocks,
});
const user = (text: string, parent: string | null = null) => message('user', [{ type: 'text', text }], parent);
const reply = (text: string) => message('assistant', [{ type: 'text', text }]);
const tool = (id: string) => message('assistant', [{ type: 'tool_use', id, name: 'Read', input: { file_path: '/a' }, truncated: false }]);
const result = (id: string) => message('user', [{ type: 'tool_result', toolUseId: id, text: 'ok', isError: false, truncated: false, images: [] }]);

const prompt = (index: number): OutlinePrompt => ({ key: `p${index}`, index, text: `Prompt ${index}`, at: null, hasImage: false, images: 0 });
/** Rows of a fixed height: row i starts at i × size. */
const rows = (count: number, size = 100) => ({ start: (index: number) => index * size, total: count * size });

describe('which prompts get a mark', () => {
  it('keeps your own prompts, not commands, subagent prompts, replies or tool runs', () => {
    const items = buildDisplayItems([
      user('Add a dark mode toggle'),
      tool('t1'),
      result('t1'),
      reply('Done.'),
      user('<command-name>/compact</command-name><command-args></command-args>'),
      user('Look at the theme files', 'toolu_agent'),
      reply('The subagent read them.'),
      user('Now check it in light mode'),
    ]);
    const prompts = outlinePrompts(groupActivity(items));
    expect(prompts.map((p) => p.text)).toEqual(['Add a dark mode toggle', 'Now check it in light mode']);
  });

  it('points at the row in the rendered list, also with runs of activity folded', () => {
    const items = buildDisplayItems([user('One'), tool('a'), result('a'), tool('b'), result('b'), reply('Ok'), user('Two')]);
    const rendered = groupActivity(items);
    const prompts = outlinePrompts(rendered);
    expect(prompts.map((p) => rendered[p.index]!.key)).toEqual(prompts.map((p) => p.key));
    expect(prompts.map((p) => p.index)).toEqual([0, 3]);
  });

  it('counts the images of a prompt', () => {
    const image = message('user', [
      { type: 'text', text: 'Like this' },
      { type: 'image', mediaType: 'image/png', ref: { imageId: 'i1', mediaType: 'image/png', bytes: 10 } },
    ] as TranscriptMessage['blocks']);
    const [first] = outlinePrompts(buildDisplayItems([image]));
    expect(first).toMatchObject({ hasImage: true, images: 1 });
  });

  it('leaves messages in Up next out: they are not in the transcript until they are sent', () => {
    // A queued message only becomes an item once Claude Code writes it, as a prompt like any other.
    const items = buildDisplayItems([user('First'), reply('Working on it')]);
    expect(outlinePrompts(items)).toHaveLength(1);
    expect(items.filter(isPrompt)).toHaveLength(1);
  });
});

describe('where marks go', () => {
  it('places each mark where its row starts, as a share of the whole transcript', () => {
    const prompts = [prompt(0), prompt(5), prompt(9)];
    const { marks, dense } = layoutMarks(prompts, rows(10), 400);
    expect(dense).toBe(false);
    expect(marks.map((m) => m.top)).toEqual([0, 0.5, 0.9]);
  });

  it('uses the measured starts, estimates included, as the virtualizer reports them', () => {
    const starts = [16, 88, 600, 1_400];
    const { marks } = layoutMarks([prompt(0), prompt(2), prompt(3)], { start: (i) => starts[i]!, total: 2_000 }, 500);
    expect(marks.map((m) => m.top)).toEqual([0.008, 0.3, 0.7]);
  });

  it('pushes marks down in a crowded start', () => {
    // Three prompts in the first rows of a long transcript.
    const { marks } = layoutMarks([prompt(0), prompt(1), prompt(2), prompt(500)], rows(1_000), 600);
    const px = marks.map((m) => Math.round(m.top * 600));
    expect(px).toEqual([0, MARK_GAP, MARK_GAP * 2, 300]);
  });

  it('pulls a crowded end back up so it stays on the rail', () => {
    const { marks } = layoutMarks([prompt(0), prompt(997), prompt(998), prompt(999)], rows(1_000), 600);
    const px = marks.map((m) => Math.round(m.top * 600));
    expect(px.at(-1)).toBeLessThanOrEqual(600);
    expect(px).toEqual([0, 600 - MARK_GAP * 2, 600 - MARK_GAP, 600]);
  });

  it('keeps 48 prompts apart and in order', () => {
    // Most of them near the end, the way a long session goes.
    const indexes = [...Array.from({ length: 8 }, (_, i) => i * 40), ...Array.from({ length: 40 }, (_, i) => 960 + i)];
    const { marks, dense } = layoutMarks(indexes.map(prompt), rows(1_000), 400);
    expect(dense).toBe(false);
    expect(marks).toHaveLength(48);
    for (let i = 1; i < marks.length; i++) expect((marks[i]!.top - marks[i - 1]!.top) * 400).toBeGreaterThanOrEqual(MARK_GAP - 1e-9);
    expect(marks.every((m) => m.top >= 0 && m.top <= 1)).toBe(true);
  });

  it('shares the rail evenly when there are more marks than room, and says so', () => {
    const { marks, dense } = layoutMarks(Array.from({ length: 48 }, (_, i) => prompt(i)), rows(48), 200);
    expect(dense).toBe(true);
    expect(marks[0]!.top).toBe(0);
    expect(marks.at(-1)!.top).toBe(1);
  });

  it('finds the mark nearest the pointer', () => {
    const marks = [{ top: 0.1 }, { top: 0.12 }, { top: 0.5 }];
    expect(nearestMark(marks, 0)).toBe(0);
    expect(nearestMark(marks, 0.115)).toBe(1);
    expect(nearestMark(marks, 0.3)).toBe(1);
    expect(nearestMark(marks, 0.4)).toBe(2);
    expect(nearestMark(marks, 1)).toBe(2);
    expect(nearestMark([], 0.5)).toBe(-1);
  });
});

describe('the current prompt', () => {
  const starts = [16, 800, 1_600, 2_400];

  it('is the prompt nearest the top of the view, at or above it', () => {
    expect(currentPrompt(starts, 0)).toBe(0);
    expect(currentPrompt(starts, 700)).toBe(0);
    expect(currentPrompt(starts, 1_000)).toBe(1);
    expect(currentPrompt(starts, 5_000)).toBe(3);
  });

  it('is the prompt a jump just landed, 24px below the top', () => {
    expect(currentPrompt(starts, 800 - 24)).toBe(1);
  });

  it('is the first prompt before the first prompt', () => {
    expect(currentPrompt([500, 900], 0)).toBe(0);
    expect(currentPrompt([], 0)).toBe(-1);
  });
});

describe('previous and next', () => {
  const starts = [16, 800, 1_600, 2_400];

  it('goes to the next prompt, and to the end from the last one', () => {
    expect(nextPrompt(starts, 800 - 24, 1)).toBe(2);
    expect(nextPrompt(starts, 2_400 - 24, 3)).toBe('end');
  });

  it('goes to the first prompt while the view is still above it', () => {
    expect(nextPrompt([500, 900], 0, 0)).toBe(0);
  });

  it('goes to the prompt before, from a prompt at the top', () => {
    expect(previousPrompt(starts, 1_600 - 24, 2)).toBe(1);
  });

  it('goes back to the current prompt first when its top has scrolled off', () => {
    expect(previousPrompt(starts, 1_000, 1)).toBe(1);
  });

  it('stays at the first prompt', () => {
    expect(previousPrompt(starts, 0, 0)).toBeNull();
  });

  it('does nothing without prompts', () => {
    expect(nextPrompt([], 0, -1)).toBeNull();
    expect(previousPrompt([], 0, -1)).toBeNull();
  });
});

describe('the keys in a text field', () => {
  it('stay out of a field with text, where they select to the start or end', () => {
    expect(promptKeysBlocked({ tagName: 'TEXTAREA', value: 'Half a message' })).toBe(true);
    expect(promptKeysBlocked({ tagName: 'INPUT', type: 'text', value: 'auth' })).toBe(true);
    expect(promptKeysBlocked({ tagName: 'INPUT', type: 'search', value: 'auth' })).toBe(true);
    expect(promptKeysBlocked({ tagName: 'DIV', isContentEditable: true, textContent: 'Notes' })).toBe(true);
  });

  it('work in an empty message box', () => {
    expect(promptKeysBlocked({ tagName: 'TEXTAREA', value: '' })).toBe(false);
    expect(promptKeysBlocked({ tagName: 'INPUT', type: 'text', value: '' })).toBe(false);
    expect(promptKeysBlocked({ tagName: 'DIV', isContentEditable: true, textContent: '  ' })).toBe(false);
  });

  it('work everywhere else', () => {
    expect(promptKeysBlocked(null)).toBe(false);
    expect(promptKeysBlocked({ tagName: 'BODY' })).toBe(false);
    expect(promptKeysBlocked({ tagName: 'BUTTON' })).toBe(false);
    expect(promptKeysBlocked({ tagName: 'INPUT', type: 'checkbox', value: 'on' })).toBe(false);
  });
});

describe('labels', () => {
  it('names a mark by its place and the start of the prompt', () => {
    expect(markLabel(5, 9, 'Can the banner variant use the same Reset?')).toBe('Prompt 6 of 9: Can the banner variant use the same Reset?');
    const long = markLabel(0, 3, 'word '.repeat(40));
    expect(long.length).toBeLessThanOrEqual('Prompt 1 of 3: '.length + 81);
    expect(long.endsWith('…')).toBe(true);
    expect(markLabel(1, 3, '', 2)).toBe('Prompt 2 of 3: 2 images');
  });
});
