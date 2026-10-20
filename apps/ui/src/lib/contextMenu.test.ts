import { describe, expect, it } from 'vitest';
import { contextMenuPoint, isContextMenuKey } from './contextMenu.ts';

const key = (key: string, shiftKey: boolean) => ({ key, shiftKey, metaKey: false, ctrlKey: false, altKey: false });

describe('isContextMenuKey', () => {
  it('takes Shift+F10 and the context-menu key', () => {
    expect(isContextMenuKey(key('F10', true))).toBe(true);
    expect(isContextMenuKey(key('ContextMenu', false))).toBe(true);
  });

  it('ignores F10 alone and other keys', () => {
    expect(isContextMenuKey(key('F10', false))).toBe(false);
    expect(isContextMenuKey(key('Enter', true))).toBe(false);
  });
});

describe('contextMenuPoint', () => {
  const rect = { left: 40, top: 700, bottom: 724 };

  it('opens at the pointer, below it unless there is no room', () => {
    expect(contextMenuPoint({ x: 50, y: 710 }, rect, 800)).toEqual({ x: 50, y: 710, above: true });
    expect(contextMenuPoint({ x: 50, y: 500 }, rect, 800)).toEqual({ x: 50, y: 500, above: false });
    expect(contextMenuPoint({ x: 50, y: 100 }, rect, 800)).toEqual({ x: 50, y: 100, above: false });
  });

  it('opens from the keyboard just above an element low in the window', () => {
    expect(contextMenuPoint(null, rect, 800)).toEqual({ x: 40, y: 696, above: true });
  });

  it('opens from the keyboard just below an element high in the window', () => {
    expect(contextMenuPoint(null, { left: 10, top: 20, bottom: 44 }, 800)).toEqual({ x: 10, y: 48, above: false });
  });
});
