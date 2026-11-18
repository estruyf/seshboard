import { describe, expect, it } from 'vitest';
import { touchedFiles } from './touchedFiles.ts';

const tool = (name: string, file_path: string) => ({ kind: 'tool', name, input: { file_path } });

describe('touchedFiles', () => {
  it('marks edited and written files changed, read ones read', () => {
    const items = [tool('Read', '/repo/src/a.ts'), tool('Read', '/repo/src/b.ts'), tool('Edit', '/repo/src/b.ts'), tool('Write', 'src/c.ts'), { kind: 'text' }];
    const { changed, read } = touchedFiles(items, '/repo', null);
    expect([...changed].sort()).toEqual(['src/b.ts', 'src/c.ts']);
    expect([...read]).toEqual(['src/a.ts']);
  });

  it('adds the files in Changes, relative to the session folder', () => {
    const changes = { root: '/repo', files: [{ path: 'app/x.ts', status: 'modified' }, { path: 'other/y.ts', status: 'added' }, { path: 'app/gone.ts', status: 'deleted' }] };
    expect([...touchedFiles([], '/repo/app', changes).changed]).toEqual(['x.ts']);
  });

  it('leaves out files outside the folder', () => {
    const { changed, read } = touchedFiles([tool('Edit', '/elsewhere/a.ts'), tool('Read', '~/notes.md')], '/repo', null, '/home/me');
    expect(changed.size + read.size).toBe(0);
  });
});
