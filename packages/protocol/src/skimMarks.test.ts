import { describe, expect, it } from 'vitest';
import { skimMarks, withoutSkimMarks } from './skimMarks.ts';

describe('skimMarks', () => {
  it('takes the line off and reads its quotes', () => {
    expect(skimMarks('It works. Delete is not committed.\n\n<!-- keep: "It works" | "Delete is not" -->\n')).toEqual({ text: 'It works. Delete is not committed.', quotes: ['It works', 'Delete is not'] });
  });
  it('reads curly quotes and a line without a pipe', () => {
    expect(skimMarks('Done.\n<!-- keep: “Done” -->').quotes).toEqual(['Done']);
  });
  it('leaves a reply without the line as it is', () => {
    expect(skimMarks('No line here.')).toEqual({ text: 'No line here.', quotes: null });
  });
  it('only takes the line at the very end', () => {
    const text = 'A.\n<!-- keep: "A" -->\nMore text.';
    expect(skimMarks(text)).toEqual({ text, quotes: null });
  });
  it('keeps an empty quote list for a line that quotes nothing', () => {
    expect(skimMarks('A.\n<!-- keep: -->')).toEqual({ text: 'A.', quotes: [] });
  });
});

describe('withoutSkimMarks', () => {
  it.each(['<', '<!-', '<!-- ke', '<!-- keep: "It wo', '<!-- keep: "It works" -->'])('hides the line while it is written: %s', (tail) => {
    expect(withoutSkimMarks(`It works.\n\n${tail}`)).toBe('It works.');
  });
  it('leaves the reply\'s own markup', () => {
    expect(withoutSkimMarks('Use this:\n<div>')).toBe('Use this:\n<div>');
    expect(withoutSkimMarks('It works.')).toBe('It works.');
  });
});
