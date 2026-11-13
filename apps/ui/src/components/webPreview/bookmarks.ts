import type { BrowserBookmark } from '@seshboard/protocol/client';
import { keptFavicon, shortTitle } from './favorites.ts';

/*
 * Browser bookmarks as plain data: links to find again, in folders, for one project or everywhere. Pure, so the rules
 * (which bookmark a page is, what a new tab lists for a project, the folders) are tested on their own;
 * `browserBookmarksStore.ts` holds the list and saves it in the engine.
 */

/** How long a folder's name may be. */
export const FOLDER_MAX = 200;

/** The same page for a bookmark: the same address, whatever its `#`. */
function samePage(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    x.hash = '';
    y.hash = '';
    return x.href === y.href;
  } catch {
    return a === b;
  }
}

/**
 * The bookmark for a page's address, if it has one: the one for `projectRoot` first, then one for everywhere, then
 * another project's (a page is one bookmark wherever you look, so the star shows it).
 */
export function bookmarkOf(bookmarks: readonly BrowserBookmark[], url: string | null, projectRoot: string | null = null): BrowserBookmark | undefined {
  if (!url) return undefined;
  const same = bookmarks.filter((b) => samePage(b.url, url));
  return same.find((b) => b.projectRoot === projectRoot) ?? same.find((b) => b.projectRoot === null) ?? same[0];
}

/** A folder's name as kept: spaces folded, cut to `FOLDER_MAX`; empty is no folder. */
export function cleanFolder(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, FOLDER_MAX);
}

/** A page bookmarked at the end, under its short title (or the name you gave its tab), for `projectRoot` or everywhere. */
export function newBookmark(
  bookmarks: readonly BrowserBookmark[],
  page: { url: string; title: string; name?: string | null; favicon: string | null },
  projectRoot: string | null,
  id: string,
  now: number,
): BrowserBookmark {
  const position = bookmarks.reduce((max, b) => Math.max(max, b.position + 1), 0);
  const title = (page.name || shortTitle(page.title, page.url)).slice(0, 500) || page.url;
  return { id, url: page.url, title, favicon: keptFavicon(page.favicon), folder: '', projectRoot, position, createdAt: now };
}

/** The folders in use, by name; no folder is left out. */
export function bookmarkFolders(bookmarks: readonly BrowserBookmark[]): string[] {
  return [...new Set(bookmarks.map((b) => b.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** Bookmarks in a folder: '' for those in none, which come first. */
export interface BookmarkGroup {
  folder: string;
  bookmarks: BrowserBookmark[];
}

/** Bookmarks by folder, in their order: no folder first, then the folders by name. */
export function byFolder(bookmarks: readonly BrowserBookmark[]): BookmarkGroup[] {
  const groups = new Map<string, BrowserBookmark[]>();
  for (const b of [...bookmarks].sort((x, y) => x.position - y.position)) groups.set(b.folder, [...(groups.get(b.folder) ?? []), b]);
  return [...groups.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b))).map(([folder, list]) => ({ folder, bookmarks: list }));
}

/** What a new tab lists: the project's bookmarks (for a session's tab), then the ones for everywhere, each by folder. */
export function bookmarksFor(bookmarks: readonly BrowserBookmark[], projectRoot: string | null): { project: BookmarkGroup[]; everywhere: BookmarkGroup[] } {
  return {
    project: projectRoot ? byFolder(bookmarks.filter((b) => b.projectRoot === projectRoot)) : [],
    everywhere: byFolder(bookmarks.filter((b) => b.projectRoot === null)),
  };
}
