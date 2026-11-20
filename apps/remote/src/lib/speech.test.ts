import { describe, expect, it } from 'vitest';
import { speakableParts } from './speech.ts';

describe('read aloud', () => {
  it('says the words without Markdown, code blocks or tables', () => {
    const reply = ['## Result', '', 'The **tests** pass, see `npm run check`.', '', '```ts', 'const a = 1;', '```', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '- one', '- two'].join('\n');
    expect(speakableParts(reply)).toEqual(['Result. The tests pass, see npm run check. one. two.']);
  });

  it('says a link as its text and a path as its file name', () => {
    expect(speakableParts('Read [the docs](https://example.com) and /Users/me/project/README.md now.')).toEqual(['Read the docs and README.md now.']);
  });

  it('says the text in raw HTML, not its tags', () => {
    expect(speakableParts('The <b>tests</b> pass.')).toEqual(['The tests pass.']);
  });

  it('leaves out the keep line Skim reads', () => {
    expect(speakableParts('Done.\n\n<!-- keep: "Done" -->')).toEqual(['Done.']);
  });

  it('cuts a long reply at sentence ends, no part longer than the limit', () => {
    const sentence = 'This sentence has a few words in it.';
    const parts = speakableParts(Array.from({ length: 12 }, () => sentence).join(' '), 80);
    expect(parts.every((part) => part.length <= 80)).toBe(true);
    expect(parts[0]).toBe(`${sentence} ${sentence}`);
    expect(parts.join(' ')).toBe(Array.from({ length: 12 }, () => sentence).join(' '));
  });

  it('cuts a line without sentence ends at a space', () => {
    const parts = speakableParts(Array.from({ length: 40 }, () => 'word').join(' '), 50);
    expect(parts.every((part) => part.length <= 50 && !part.startsWith(' '))).toBe(true);
    expect(parts.join(' ').split(' ')).toHaveLength(40);
  });

  it('has nothing to say for a reply that is only code', () => {
    expect(speakableParts('```\nls\n```')).toEqual([]);
  });
});
