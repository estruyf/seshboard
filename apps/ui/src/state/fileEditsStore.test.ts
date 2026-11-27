import { beforeEach, describe, expect, it } from 'vitest';
import { editedPaths, editKey, useFileEdits } from './fileEditsStore.ts';

describe('fileEditsStore', () => {
  beforeEach(() => useFileEdits.setState({ edits: new Map() }));

  it('keeps each file of each session on its own', () => {
    const { start, update } = useFileEdits.getState();
    start('a', '/p/one.ts', 'one', 1);
    start('a', '/p/two.ts', 'two', 2);
    start('b', '/p/one.ts', 'other', 3);
    update('a', '/p/one.ts', { dirty: true });
    const edits = useFileEdits.getState().edits;
    expect(edits.get(editKey('a', '/p/one.ts'))).toMatchObject({ saved: 'one', dirty: true });
    expect(edits.get(editKey('b', '/p/one.ts'))).toMatchObject({ saved: 'other', dirty: false });
    expect(editedPaths(edits, 'a').sort()).toEqual(['/p/one.ts', '/p/two.ts']);
  });

  it('ignores an update for a file no longer in edit mode', () => {
    const { start, stop, update } = useFileEdits.getState();
    start('a', '/p/one.ts', 'one', 1);
    stop('a', '/p/one.ts');
    const before = useFileEdits.getState().edits;
    update('a', '/p/one.ts', { dirty: true });
    expect(useFileEdits.getState().edits).toBe(before);
    expect(editedPaths(before, 'a')).toEqual([]);
  });
});
