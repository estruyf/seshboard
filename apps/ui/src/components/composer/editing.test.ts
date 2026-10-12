import { describe, expect, it } from 'vitest';
import { appendQuote, asQuote, continueList, wrapInCode, type TextEdit } from './editing.ts';

/** Presses ⇧↵ with the caret at `|` and returns the text with the caret after the edit. */
function press(withCaret: string): string | null {
  const caret = withCaret.indexOf('|');
  const text = withCaret.replace('|', '');
  const edit: TextEdit | null = continueList(text, caret, caret);
  if (!edit) return null;
  const next = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  const at = edit.from + edit.insert.length;
  return `${next.slice(0, at)}|${next.slice(at)}`;
}

describe('continueList', () => {
  it('starts the next bullet', () => {
    expect(press('- fix the tests|')).toBe('- fix the tests\n- |');
    expect(press('* one|')).toBe('* one\n* |');
    expect(press('+ one|')).toBe('+ one\n+ |');
  });

  it('numbers the next item one up', () => {
    expect(press('1. fix the tests|')).toBe('1. fix the tests\n2. |');
    expect(press('9) nine|')).toBe('9) nine\n10) |');
  });

  it('keeps the indent and the spacing', () => {
    expect(press('- top\n  - nested|')).toBe('- top\n  - nested\n  - |');
    expect(press('1.  wide|')).toBe('1.  wide\n2.  |');
  });

  it('adds an unchecked box after a task', () => {
    expect(press('- [x] done|')).toBe('- [x] done\n- [ ] |');
  });

  it('moves what follows the caret to the new item', () => {
    expect(press('- fix |the tests')).toBe('- fix \n- |the tests');
  });

  it('ends the list on an empty item', () => {
    expect(press('- one\n- |')).toBe('- one\n|');
    expect(press('1. one\n2. |')).toBe('1. one\n|');
    expect(press('- one\n  - [ ] |')).toBe('- one\n|');
  });

  it('leaves text that is not a list alone', () => {
    expect(press('fix the tests|')).toBeNull();
    expect(press('-|')).toBeNull();
    expect(press('-not a list|')).toBeNull();
    expect(press('|- one')).toBeNull();
  });

  it('only looks at the line with the caret', () => {
    expect(press('- one\nplain|')).toBeNull();
    expect(press('intro\n- one|')).toBe('intro\n- one\n- |');
  });
});

/** Types ` with `[…]` selected and returns the text with the selection after the edit. */
function backtick(withSelection: string): string | null {
  const start = withSelection.indexOf('[');
  const end = withSelection.indexOf(']') - 1;
  const text = withSelection.replace('[', '').replace(']', '');
  const edit = wrapInCode(text, start, end);
  if (!edit) return null;
  const next = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  const [from, to] = edit.select!;
  return `${next.slice(0, from)}[${next.slice(from, to)}]${next.slice(to)}`;
}

describe('wrapInCode', () => {
  it('wraps one line as inline code and keeps it selected', () => {
    expect(backtick('rename [useDrafts] please')).toBe('rename `[useDrafts]` please');
  });

  it('uses a longer fence around backticks', () => {
    expect(backtick('[a`b]')).toBe('``[a`b]``');
    expect(backtick('[`a`]')).toBe('`` [`a`] ``');
  });

  it('puts several lines in a fenced block on lines of their own', () => {
    expect(backtick('fix this: [const a = 1;\nconst b = 2;] thanks')).toBe('fix this: \n```\n[const a = 1;\nconst b = 2;]\n```\n thanks');
    expect(backtick('[one\ntwo\n]')).toBe('```\n[one\ntwo]\n```');
    expect(backtick('[```\ncode\n```]')).toBe('````\n[```\ncode\n```]\n````');
  });

  it('does nothing without a selection', () => {
    expect(backtick('caret here[]')).toBeNull();
  });
});

/** Quotes `quoted` at the end of `text` and returns the result with the caret after the edit. */
function quote(text: string, quoted: string): string | null {
  const edit = appendQuote(text, quoted);
  if (!edit) return null;
  return `${text.slice(0, edit.from)}${edit.insert}|${text.slice(edit.to)}`;
}

describe('asQuote', () => {
  it('puts > before every line and keeps one empty quote line between paragraphs', () => {
    expect(asQuote('Which port?')).toBe('> Which port?');
    expect(asQuote('One.\nTwo.')).toBe('> One.\n> Two.');
    expect(asQuote('\n\nOne.\r\n\r\n\r\n  \nTwo.  \n\n')).toBe('> One.\n>\n> Two.');
  });
});

describe('appendQuote', () => {
  it('quotes into an empty box with the caret on a new line under it', () => {
    expect(quote('', 'Should I keep the old API?')).toBe('> Should I keep the old API?\n\n|');
  });

  it('adds the quote after a blank line under what is there', () => {
    expect(quote('> First?\n\nYes.', 'Second?')).toBe('> First?\n\nYes.\n\n> Second?\n\n|');
    expect(quote('Yes.\n', 'Second?')).toBe('Yes.\n\n> Second?\n\n|');
    expect(quote('Yes.\n\n', 'Second?')).toBe('Yes.\n\n> Second?\n\n|');
  });

  it('does nothing with only white space', () => {
    expect(quote('Hi', ' \n\n ')).toBeNull();
  });
});
