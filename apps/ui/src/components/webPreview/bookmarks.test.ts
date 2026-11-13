import { describe, expect, it } from 'vitest';
import type { BrowserBookmark } from '@seshboard/protocol/client';
import { bookmarkFolders, bookmarkOf, bookmarksFor, byFolder, cleanFolder, newBookmark } from './bookmarks.ts';

const bm = (id: string, url: string, position: number, projectRoot: string | null = null, folder = ''): BrowserBookmark => ({ id, url, title: id, favicon: null, folder, projectRoot, position, createdAt: position });
const ROOT = '/work/intranet';

describe('bookmarks', () => {
  const list = [
    bm('repo', 'https://github.com/involv-intranet/intranet', 0, ROOT),
    bm('staging', 'https://staging.test/', 1, ROOT, 'Sites'),
    bm('devops', 'https://dev.azure.com/', 2, null, 'Docs'),
    bm('sdk', 'https://github.com/anthropics/sdk', 3),
    bm('other', 'https://staging.test/', 4, '/work/other'),
  ];

  it("finds a page's bookmark: this project's first, then everywhere's, then another project's", () => {
    expect(bookmarkOf(list, 'https://staging.test/#top', ROOT)?.id).toBe('staging');
    expect(bookmarkOf(list, 'https://staging.test/', '/work/other')?.id).toBe('other');
    expect(bookmarkOf(list, 'https://staging.test/', null)?.id).toBe('staging');
    expect(bookmarkOf(list, 'https://dev.azure.com/', ROOT)?.id).toBe('devops');
    expect(bookmarkOf(list, 'https://nowhere.test/', ROOT)).toBeUndefined();
    expect(bookmarkOf(list, null)).toBeUndefined();
  });

  it('lists the project first, then everywhere, each by folder with no folder first', () => {
    const { project, everywhere } = bookmarksFor(list, ROOT);
    expect(project.map((g) => [g.folder, g.bookmarks.map((b) => b.id)])).toEqual([['', ['repo']], ['Sites', ['staging']]]);
    expect(everywhere.map((g) => [g.folder, g.bookmarks.map((b) => b.id)])).toEqual([['', ['sdk']], ['Docs', ['devops']]]);
    expect(bookmarksFor(list, null).project).toEqual([]);
  });

  it('adds a page at the end under its short title, for a project or everywhere', () => {
    const added = newBookmark(list, { url: 'https://seshboard.app/', title: 'Seshboard | Seshboard', favicon: null }, ROOT, 'n', 9);
    expect(added).toMatchObject({ id: 'n', title: 'Seshboard', folder: '', projectRoot: ROOT, position: 5, createdAt: 9 });
    expect(newBookmark([], { url: 'https://a.test/', title: '', favicon: null }, null, 'a', 1)).toMatchObject({ title: 'https://a.test/', position: 0, projectRoot: null });
  });

  it('names folders cleanly and lists the ones in use', () => {
    expect(cleanFolder('  Read   later ')).toBe('Read later');
    expect(cleanFolder('   ')).toBe('');
    expect(bookmarkFolders(list)).toEqual(['Docs', 'Sites']);
    expect(byFolder([])).toEqual([]);
  });
});
