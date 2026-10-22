import { describe, expect, it } from 'vitest';
import { lastPreviewableWrite } from './lastWrittenStore.ts';

const tool = (name: string, file_path: unknown) => ({ kind: 'tool', name, input: { file_path } });

describe('lastPreviewableWrite', () => {
  it('takes the newest write of a previewable file', () => {
    const items = [tool('Write', '/p/old.md'), { kind: 'text' }, tool('Edit', '/p/PLAN.md'), tool('Write', '/p/a.png')];
    expect(lastPreviewableWrite(items, '/p', null)).toBe('/p/PLAN.md');
    expect(lastPreviewableWrite([tool('Edit', '/p/PLAN.md'), tool('Write', '/p/a.ts')], '/p', null)).toBe('/p/a.ts');
    expect(lastPreviewableWrite([tool('MultiEdit', '/p/page.HTML')], '/p', null)).toBe('/p/page.HTML');
  });
  it('ignores reads and other tools', () => {
    expect(lastPreviewableWrite([tool('Read', '/p/a.md'), tool('Bash', '/p/b.md'), { kind: 'user' }], '/p', null)).toBeNull();
    expect(lastPreviewableWrite([], '/p', null)).toBeNull();
    expect(lastPreviewableWrite([{ kind: 'tool', name: 'Write', input: null }, tool('Write', 5)], '/p', null)).toBeNull();
  });
  it('resolves relative and home paths', () => {
    expect(lastPreviewableWrite([tool('Write', 'docs/a.md')], '/p', null)).toBe('/p/docs/a.md');
    expect(lastPreviewableWrite([tool('Write', 'docs/a.md')], null, null)).toBeNull();
    expect(lastPreviewableWrite([tool('Write', '~/notes.md')], '/p', '/Users/me')).toBe('/Users/me/notes.md');
    expect(lastPreviewableWrite([tool('Write', '~/notes.md')], '/p', null)).toBeNull();
  });
  it('keeps Windows paths', () => {
    expect(lastPreviewableWrite([tool('Write', 'C:\\p\\a.md')], 'C:\\p', null)).toBe('C:\\p\\a.md');
    expect(lastPreviewableWrite([tool('Write', 'docs\\a.md')], 'C:\\p', null)).toBe('C:\\p\\docs\\a.md');
  });
});
