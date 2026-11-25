import { describe, expect, it } from 'vitest';
import { buildTree, parentFolders, treeKey, visibleRows } from './fileTree.ts';

const FILES = ['src/cart/CartButton.tsx', 'README.md', 'src/cart/useCart.ts', 'package.json', 'src/i18n/en.json', 'src/App.tsx', 'tests/cart.test.ts'];

describe('the file tree', () => {
  it('puts folders first, then files, by name', () => {
    const root = buildTree(FILES);
    expect(root.children.map((c) => c.name)).toEqual(['src', 'tests', 'package.json', 'README.md']);
    expect(root.children[0]!.children.map((c) => c.name)).toEqual(['cart', 'i18n', 'App.tsx']);
  });

  it('shows what is in the open folders only', () => {
    const root = buildTree(FILES);
    expect(visibleRows(root, new Set()).map((r) => r.path)).toEqual(['src', 'tests', 'package.json', 'README.md']);
    const rows = visibleRows(root, new Set(['src', 'src/cart']));
    expect(rows.map((r) => `${'  '.repeat(r.depth)}${r.name}`)).toEqual(['src', '  cart', '    CartButton.tsx', '    useCart.ts', '  i18n', '  App.tsx', 'tests', 'package.json', 'README.md']);
    expect(rows[0]!.open).toBe(true);
    expect(rows[4]!.open).toBe(false);
  });

  it('filters by path and opens the folders of what matches', () => {
    const rows = visibleRows(buildTree(FILES), new Set(), 'cartbu');
    expect(rows.map((r) => r.path)).toEqual(['src', 'src/cart', 'src/cart/CartButton.tsx']);
    expect(rows.every((r) => !r.dir || r.open)).toBe(true);
    expect(visibleRows(buildTree(FILES), new Set(), 'nothing-like-this')).toEqual([]);
  });

  it('closes a folder by hand while filtering', () => {
    const rows = visibleRows(buildTree(FILES), new Set(), 'cartbu', undefined, new Set(['src/cart']));
    expect(rows.map((r) => [r.path, r.open])).toEqual([['src', true], ['src/cart', false]]);
  });

  it('names the folders a path is in', () => {
    expect(parentFolders('a/b/c.ts')).toEqual(['a', 'a/b']);
    expect(parentFolders('c.ts')).toEqual([]);
  });

  it('moves, opens and closes with the keys of the tree pattern', () => {
    const rows = visibleRows(buildTree(FILES), new Set(['src']));
    expect(treeKey('ArrowDown', rows, 0)).toEqual({ kind: 'move', index: 1 });
    expect(treeKey('ArrowRight', rows, 1)).toEqual({ kind: 'toggle', path: 'src/cart', open: true });
    expect(treeKey('ArrowRight', rows, 0)).toEqual({ kind: 'move', index: 1 });
    expect(treeKey('ArrowLeft', rows, 0)).toEqual({ kind: 'toggle', path: 'src', open: false });
    expect(treeKey('ArrowLeft', rows, 3)).toEqual({ kind: 'move', index: 0 });
    expect(treeKey('Enter', rows, 3)).toEqual({ kind: 'open', path: 'src/App.tsx' });
  });
});
