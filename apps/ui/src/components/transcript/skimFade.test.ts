import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';
import { fadeCountOf, mustStay, remarkSkimFade, skimOutline, splitSentences } from './skimFade.ts';

const render = (text: string, keep: number[]) => renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, [remarkSkimFade, { keep }]] }, text));
const fadedIn = (html: string) => [...html.matchAll(/<span class="text-faint" data-skim-faded="true">(.*?)<\/span>/g)].map((m) => m[1]!.trim());

describe('mustStay', () => {
  it.each([
    // Failures
    'The tests fail on Windows.',
    'The store crashes on start.',
    'It doesn’t work with a worktree.',
    // Skipped work
    'I did not change them, since they look like they failed before this work.',
    'I skipped the smoke steps.',
    // Limits of the work
    'Sizes are my estimates, and I ran nothing.',
    'I read only part of the controller.',
    'I read none of the implementation code.',
    // Unfinished work
    'The list is still to do.',
    'You’ll need a key.',
    // Questions
    'Should I fix the two Windows tests now?',
  ])('keeps: %s', (sentence) => {
    expect(mustStay(sentence)).toBe(true);
  });

  it.each(['Rows now stay in their group.', 'I ran 42 tests.', 'The list reads from a new selector.', 'Les lignes restent dans leur groupe.'])('leaves it to Haiku: %s', (sentence) => {
    expect(mustStay(sentence)).toBe(false);
  });
});

describe('splitSentences', () => {
  it('gives the text back whole', () => {
    const text = 'One sentence here. Another one! A third?\nAnd a last one';
    const parts = splitSentences(text);
    expect(parts).toHaveLength(4);
    expect(parts.join('')).toBe(text);
  });
  it("doesn't split inside a number or a file name", () => {
    expect(splitSentences('It takes 1.5 seconds in store.ts today.')).toHaveLength(1);
  });
});

describe('skimOutline', () => {
  it('numbers sentences in paragraphs and lists, and keeps headings for context', () => {
    expect(skimOutline('# Title\n\nOne here. Two here.\n\n- Three here.\n  - Four here.')).toEqual({
      text: '# Title\n[1] One here.\n[2] Two here.\n- [3] Three here.\n- - [4] Four here.',
      total: 4,
    });
  });
  it('puts inline code and link text in the sentence, without ending it there', () => {
    expect(skimOutline('Look at `a.b` and [the docs](https://example.com/a.b) now. Done.')).toEqual({ text: '[1] Look at a.b and the docs now.\n[2] Done.', total: 2 });
  });
  it('gives no numbers to code, tables and quotes', () => {
    expect(skimOutline('```\ncode.\n```\n\n| A. |\n|---|\n| B. |\n\n> Quote.\n\nRows stay.')).toEqual({ text: '(code)\n(table)\n(blockquote)\n[1] Rows stay.', total: 1 });
  });
  it('numbers the same sentences the fade does', () => {
    const reply = 'One here. `two.ts` here.\n\n- Three here.\n\n```\nnot this.\n```\n\nFour here. Five here.';
    expect(skimOutline(reply).total).toBe(5);
    expect(fadedIn(render(reply, [1, 3, 5]))).toEqual(['<code>two.ts</code> here.', 'Four here.']);
  });
});

describe('the fade through the renderer', () => {
  const reply = 'Rows stay in their group. The list reads a selector. It opens in about a second.';

  it('fades what Haiku did not keep, and keeps every word', () => {
    const html = render(reply, [2]);
    expect(fadedIn(html)).toEqual(['Rows stay in their group.', 'It opens in about a second.']);
    expect(html.replace(/<[^>]+>/g, '')).toBe(`${reply}\n`.trim());
  });

  it('never fades a sentence that must stay, whatever Haiku picked', () => {
    expect(fadedIn(render('The tests fail on Windows. Rows stay. Do you want it on the left? The list reads a selector.', [4]))).toEqual(['Rows stay.']);
  });

  it('fades a sentence with inline code or a link, which stays working', () => {
    const html = render('Look at `store.ts` first. Read [the docs](https://example.com/a.b) too. Rows stay.', [3]);
    expect(fadedIn(html)).toHaveLength(2);
    expect(html).toContain('<code>store.ts</code>');
    expect(html).toContain('<a href="https://example.com/a.b">the docs</a>');
  });

  it('keeps bold text as written', () => {
    expect(render('**Rows** stay here. The list reads a selector.', [2])).toContain('<strong>Rows</strong>');
  });

  it('fades in list items, keeping the list', () => {
    const html = render('- Rows stay. The list reads.\n- Another point', [2, 3]);
    expect(html).toContain('<li>');
    expect(fadedIn(html)).toEqual(['Rows stay.']);
  });

  it('never fades code blocks, tables, headings or quotes', () => {
    const text = ['# The heading here.', '```\nThe code here.\n```', '| The table here. |\n|---|\n| A cell. |', '> The quote here.', 'Rows stay. The list reads.'].join('\n\n');
    expect(fadedIn(render(text, [1]))).toEqual(['The list reads.']);
  });

  it('fades nothing when every sentence would fade', () => {
    expect(fadedIn(render('Rows stay. The list reads.', []))).toEqual([]);
    expect(fadeCountOf('Rows stay. The list reads.', [])).toEqual({ faded: 0, total: 2 });
  });

  it('fades nothing when too little would fade to see', () => {
    const reply = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} here.`).join(' ');
    expect(fadeCountOf(reply, Array.from({ length: 11 }, (_, i) => i + 1))).toEqual({ faded: 0, total: 12 });
    expect(fadeCountOf(reply, Array.from({ length: 10 }, (_, i) => i + 1))).toEqual({ faded: 2, total: 12 });
  });

  it('keeps a hard line break', () => {
    expect(render('The list reads.  \nRows stay.', [2])).toContain('<br/>');
  });
});

describe('fadeCountOf', () => {
  it('counts what the renderer fades', () => {
    expect(fadeCountOf('Rows stay. The list reads.\n\n- It opens.\n- Another point', [2, 4])).toEqual({ faded: 2, total: 4 });
  });
  it('counts nothing for a reply without prose', () => {
    expect(fadeCountOf('```\ncode\n```', [])).toEqual({ faded: 0, total: 0 });
  });
});
