import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexInput, codexMentions } from './codexInput.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function folder(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'codex-input-')));
  dirs.push(dir);
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'app.ts'), 'one\ntwo\n');
  writeFileSync(join(dir, 'my notes.md'), '');
  return dir;
}

describe('codexMentions', () => {
  it('reads a paragraph of mentions as files and folders, by the name typed', () => {
    const cwd = folder();
    const text = `Fix the bug\n\n@src/app.ts#L1-2 @src/ @"my notes.md" @gone.ts`;
    expect(codexMentions(text, cwd)).toEqual([
      { type: 'mention', name: 'src/app.ts#L1-2', path: join(cwd, 'src', 'app.ts') },
      { type: 'mention', name: 'src/', path: join(cwd, 'src') },
      { type: 'mention', name: 'my notes.md', path: join(cwd, 'my notes.md') },
    ]);
  });

  it('leaves an @ in what you typed as words', () => {
    expect(codexMentions('Ask @src/app.ts about it', folder())).toEqual([]);
  });
});

describe('codexInput', () => {
  it('sends the text as typed, the mentions, and pasted images as data URLs', () => {
    const cwd = folder();
    expect(codexInput('Look\n\n@src/app.ts', [{ type: 'image', mediaType: 'image/png', data: 'AAAA' }], cwd)).toEqual([
      { type: 'text', text: 'Look\n\n@src/app.ts', text_elements: [] },
      { type: 'mention', name: 'src/app.ts', path: join(cwd, 'src', 'app.ts') },
      { type: 'image', url: 'data:image/png;base64,AAAA' },
    ]);
  });
});
