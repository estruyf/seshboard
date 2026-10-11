import { describe, expect, it } from 'vitest';
import { insertMentions, mentionFor } from './mentions.ts';

describe('mentionFor', () => {
  it('is relative inside the session folder and absolute outside it', () => {
    expect(mentionFor('/repo/src/app.ts', '/repo', false)).toBe('@src/app.ts');
    expect(mentionFor('/repo/src/app.ts', '/repo/', false)).toBe('@src/app.ts');
    expect(mentionFor('/repository/x.ts', '/repo', false)).toBe('@/repository/x.ts');
    expect(mentionFor('/elsewhere/x.ts', null, false)).toBe('@/elsewhere/x.ts');
  });

  it('marks folders with a slash and quotes paths with spaces', () => {
    expect(mentionFor('/repo/src', '/repo', true)).toBe('@src/');
    expect(mentionFor('/repo/My Docs/a b.md', '/repo', false)).toBe('@"My Docs/a b.md"');
  });

  it('writes Windows paths inside the folder with /, as the @ picker does, and keeps others as they are', () => {
    expect(mentionFor('C:\\repo\\src\\app.ts', 'C:\\repo', false)).toBe('@src/app.ts');
    expect(mentionFor('c:\\Repo\\src', 'C:\\repo\\', true)).toBe('@src/');
    expect(mentionFor('D:\\data\\x.ts', 'C:\\repo', false)).toBe('@D:\\data\\x.ts');
    expect(mentionFor('D:\\data', 'C:\\repo', true)).toBe('@D:\\data\\');
  });
});

describe('insertMentions', () => {
  it('inserts at the caret with spaces where needed', () => {
    expect(insertMentions('look at', 7, ['@a.ts', '@b/'])).toEqual({ text: 'look at @a.ts @b/ ', caret: 18 });
    expect(insertMentions('fix  please', 4, ['@a.ts'])).toEqual({ text: 'fix @a.ts please', caret: 9 });
    expect(insertMentions('', 0, ['@a.ts'])).toEqual({ text: '@a.ts ', caret: 6 });
  });

  it('leaves the text alone without mentions', () => {
    expect(insertMentions('hi', 2, [])).toEqual({ text: 'hi', caret: 2 });
  });
});
