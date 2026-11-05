import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';
import { fadeCountOf, fadesSentence, remarkSkimFade, splitSentences } from './skimFade.ts';

const render = (text: string) => renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkSkimFade] }, text));
const fadedIn = (html: string) => [...html.matchAll(/<span class="text-faint" data-skim-faded="true">(.*?)<\/span>/g)].map((m) => m[1]!.trim());

describe('fadesSentence', () => {
  it.each([
    'I went through the sidebar store and the list again to see where a row gets its position.',
    'I ran the tests next to the change and most of them pass.',
    'I added a test next to the existing grouping tests.',
    'This needed a small set of waiting rows in the store and a selector that the list reads from.',
    'It runs in about a second.',
    'Let me look at how the store works.',
    'Now I’ll read the list.',
    'Let me know how you would like to continue.',
    'Hope this helps!',
    'Done.',
  ])('fades narration and filler: %s', (sentence) => {
    expect(fadesSentence(sentence)).toBe(true);
  });

  it.each([
    // Failures
    'I ran the tests and they fail on Windows.',
    'I looked at the error and the store crashes on start.',
    'I checked it and it doesn’t work with a worktree.',
    // Skipped work
    'I did not change them, since they look like they failed before this work.',
    'I ran the suite but skipped the smoke steps.',
    // Unfinished work
    'I started on the store, but the list is still to do.',
    'I looked at the rest and it remains unfinished.',
    'I checked the docs, and you’ll need a key.',
    // Questions and numbers
    'Should I fix the two Windows tests now, or leave them for later?',
    'Let me check: do you want it on the left?',
    'I ran 42 tests.',
    'I read three files.',
    // What it did, by default
    'Rows now stay in their group until you have read them.',
    'The list reads from a new selector.',
    'Les lignes restent dans leur groupe.',
  ])('keeps: %s', (sentence) => {
    expect(fadesSentence(sentence)).toBe(false);
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

describe('the fade through the renderer', () => {
  const reply = 'I went through the store. Rows now stay in their group. It runs in about a second.';

  it('fades less important sentences and keeps every word', () => {
    const html = render(reply);
    expect(fadedIn(html)).toEqual(['I went through the store.', 'It runs in about a second.']);
    expect(html.replace(/<[^>]+>/g, '')).toBe(reply);
  });

  it('leaves a sentence with inline code or a link whole, and working', () => {
    const html = render('I looked at `store.ts` first. I read [the docs](https://example.com/a.b) too. I checked the list. Rows stay.');
    expect(fadedIn(html)).toEqual(['I checked the list.']);
    expect(html).toContain('<code>store.ts</code>');
    expect(html).toContain('<a href="https://example.com/a.b">the docs</a>');
  });

  it("doesn't end a sentence at a full stop inside code", () => {
    expect(fadedIn(render('I looked at `a. Then b` first and it is good. Rows stay.'))).toEqual([]);
  });

  it('keeps bold text as written', () => {
    const html = render('**I ran the tests** and looked. I ran the linter. Rows stay.');
    expect(html).toContain('<strong>I ran the tests</strong>');
    expect(fadedIn(html)).toEqual(['I ran the linter.']);
  });

  it('fades in list items, keeping the list', () => {
    const html = render('- I ran the linter. Rows stay.\n- Another point');
    expect(html).toContain('<li>');
    expect(fadedIn(html)).toEqual(['I ran the linter.']);
  });

  it('never fades code blocks, tables, headings or quotes', () => {
    const text = ['# I ran the tests.', '```\nI ran the tests.\n```', '| I ran the tests. |\n|---|\n| I checked it. |', '> I ran the tests.', 'Rows stay.'].join('\n\n');
    expect(fadedIn(render(text))).toEqual([]);
  });

  it('fades nothing when every sentence would fade', () => {
    expect(fadedIn(render('I went through the store. Let me know how you would like to continue.'))).toEqual([]);
    expect(fadeCountOf('Done.')).toEqual({ faded: 0, total: 1 });
  });

  it('keeps a hard line break', () => {
    expect(render('I checked the list.  \nRows stay.')).toContain('<br/>');
  });
});

describe('fadeCountOf', () => {
  it('counts what the renderer fades', () => {
    expect(fadeCountOf('I went through the store. Rows stay.\n\n- I ran the linter.\n- Another point')).toEqual({ faded: 2, total: 4 });
  });
  it('counts nothing for a reply without prose', () => {
    expect(fadeCountOf('```\ncode\n```')).toEqual({ faded: 0, total: 0 });
  });
});
