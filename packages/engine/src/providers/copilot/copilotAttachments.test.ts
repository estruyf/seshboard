import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mentionAttachments } from './copilotAttachments.ts';

describe('mentionAttachments', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-copilot-files-')));
    mkdirSync(join(cwd, 'src'));
    writeFileSync(join(cwd, 'src', 'a.ts'), 'one\ntwo\nthree\nfour\n');
    writeFileSync(join(cwd, 'my notes.md'), '# Notes\n');
  });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("turns the message box's line of mentions into files, folders and lines", () => {
    const text = 'Fix the bug\n\n@src/a.ts#L2-3 @src/ @"my notes.md" @gone.ts';
    expect(mentionAttachments(text, cwd)).toEqual([
      { type: 'selection', filePath: join(cwd, 'src', 'a.ts'), displayName: 'a.ts#L2-3', selection: { start: { line: 1, character: 0 }, end: { line: 2, character: 5 } }, text: 'two\nthree' },
      { type: 'directory', path: join(cwd, 'src'), displayName: 'src' },
      { type: 'file', path: join(cwd, 'my notes.md'), displayName: 'my notes.md' },
    ]);
  });

  it('leaves an @ in what you typed as words', () => {
    expect(mentionAttachments('Ask @src/a.ts about it', cwd)).toEqual([]);
    expect(mentionAttachments('@src/a.ts', cwd)).toEqual([{ type: 'file', path: join(cwd, 'src', 'a.ts'), displayName: 'a.ts' }]);
  });
});
