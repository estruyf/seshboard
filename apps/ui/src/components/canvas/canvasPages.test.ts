import { describe, expect, it } from 'vitest';
import { canvasPageKey, pagesToDrop } from './canvasPages.ts';
import { viewedCanvases } from '../../state/canvasPanelStore.ts';

describe('pagesToDrop', () => {
  const page = (key: string, shownAt: number, shown = false) => ({ key, shown, shownAt });
  it('drops nothing while there is room', () => {
    expect(pagesToDrop([page('a', 1), page('b', 2)], 2)).toEqual([]);
  });
  it('drops the parked pages shown longest ago, never one on show', () => {
    expect(pagesToDrop([page('a', 1, true), page('b', 2), page('c', 3), page('d', 4)], 2)).toEqual(['b', 'c']);
    expect(pagesToDrop([page('a', 1, true), page('b', 2, true), page('c', 3, true)], 2)).toEqual([]);
  });
});

describe('what a window has open', () => {
  it('keys a page by its session and canvas', () => {
    expect(canvasPageKey('s1', 'notes')).not.toBe(canvasPageKey('s2', 'notes'));
  });
  it('tells the engine each folder and canvas once', () => {
    const open = new Map([['s1', ['notes', 'board']], ['s2', ['notes']], ['s3', ['notes']], ['s4', []]]);
    const folders = new Map([['s1', '/repo'], ['s2', '/repo'], ['s3', '/repo/.claude/worktrees/w1']]);
    expect([...viewedCanvases(open, folders)].sort()).toEqual(['/repo\nboard', '/repo\nnotes', '/repo/.claude/worktrees/w1\nnotes']);
  });
});
