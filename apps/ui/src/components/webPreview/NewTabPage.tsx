import { Copy, ExternalLink, Folder, History, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { BrowserBookmark } from '@seshboard/protocol/client';
import { shortUrl } from '@seshboard/protocol/client';
import { basename } from '../../lib/format.ts';
import { removeBookmark, useBrowserBookmarks } from '../../state/browserBookmarksStore.ts';
import { copyAddress, openInSystemBrowser } from '../../state/browserActions.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useWebPreview } from '../../state/webPreviewStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { bookmarksFor, type BookmarkGroup } from './bookmarks.ts';
import { TabIcon } from './BrowserPane.tsx';
import { BROWSER_OWNER, tabName } from './browserTabs.ts';
import { FavoriteTiles, menuAt } from './FavoriteTiles.tsx';

/** How many closed tabs a new tab lists. */
const RECENT = 5;

/**
 * What a new tab offers under its address bar: your favourites as tiles, then bookmarks (this session's project
 * first, then everywhere's, each by folder), then the tabs closed lately. `onOpen` loads a page; `onFavorite` opens a
 * favourite (its own tab in the Browser view). Nothing to offer, nothing.
 */
export function NewTabSections({ owner, onOpen, onFavorite }: { owner: string; onOpen(url: string): void; onFavorite(url: string): void }) {
  const project = useSessions((s) => (owner === BROWSER_OWNER ? null : (s.sessions.get(owner)?.projectRoot ?? null)));
  const projectName = useProjects((s) => (project ? (s.projects.get(project)?.name ?? basename(project)) : null));
  const bookmarks = useBrowserBookmarks((s) => s.bookmarks);
  const closed = useWebPreview((s) => s.closed);
  const recent = closed.filter((t) => t.owner === owner && t.url).slice(-RECENT).reverse();
  const { project: own, everywhere } = bookmarksFor(bookmarks, project);
  const [menu, setMenu] = useState<{ x: number; y: number; bookmark: BrowserBookmark } | null>(null);
  const entries = (bookmark: BrowserBookmark): MenuEntry[] => [
    { label: 'Copy address', icon: <Copy size={13} aria-hidden />, onSelect: () => copyAddress(bookmark) },
    { label: 'Open in browser', icon: <ExternalLink size={13} aria-hidden />, onSelect: () => openInSystemBrowser(bookmark) },
    'separator',
    { label: 'Remove bookmark', icon: <Trash2 size={13} aria-hidden />, onSelect: () => removeBookmark(bookmark.id), data: { 'data-bookmark-menu-remove': true } },
  ];
  const groups = (title: string, list: BookmarkGroup[], data: string) =>
    list.length > 0 && (
      <section aria-label={title} className="w-full" data-new-tab-bookmarks={data}>
        <h2 className="mb-1 text-meta font-semibold text-muted">{title}</h2>
        <div className="grid gap-2">
          {list.map((group) => (
            <div key={group.folder || '-'}>
              {group.folder && (
                <p className="flex items-center gap-1.5 px-2 pt-1 pb-0.5 text-meta text-faint">
                  <Folder size={12} aria-hidden />
                  {group.folder}
                </p>
              )}
              <ul className="grid grid-cols-[minmax(0,1fr)]">
                {group.bookmarks.map((bookmark) => (
                  <li key={bookmark.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onOpen(bookmark.url)}
                      onContextMenu={(e) => setMenu({ ...menuAt(e), bookmark })}
                      className="flex h-8 w-full min-w-0 items-center gap-2.5 rounded-lg px-2 text-left text-ui text-text hover:bg-border/45"
                      data-bookmark={bookmark.url}
                    >
                      <TabIcon tab={bookmark} size={14} />
                      <span className="min-w-0 flex-1 truncate">{bookmark.title}</span>
                      <span className="max-w-[45%] shrink-0 truncate text-meta text-faint">{shortUrl(bookmark.url)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    );
  return (
    <div className="flex w-full max-w-xl flex-col gap-5 text-left" data-new-tab-sections="">
      <FavoriteTiles onOpen={onFavorite} />
      {groups(projectName ? `For ${projectName}` : 'Bookmarks', own, 'project')}
      {groups(own.length ? 'Everywhere' : 'Bookmarks', everywhere, 'everywhere')}
      {recent.length > 0 && (
        <section aria-label="Recently closed" className="w-full" data-new-tab-recent="">
          <h2 className="mb-1 text-meta font-semibold text-muted">Recently closed</h2>
          <ul className="grid grid-cols-[minmax(0,1fr)]">
            {recent.map((tab) => (
              <li key={tab.id} className="min-w-0">
                <button type="button" onClick={() => tab.url && onOpen(tab.url)} className="flex h-8 w-full min-w-0 items-center gap-2.5 rounded-lg px-2 text-left text-ui text-text hover:bg-border/45">
                  <History size={14} aria-hidden className="shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate">{tabName(tab)}</span>
                  <span className="max-w-[45%] shrink-0 truncate text-meta text-faint">{tab.url ? shortUrl(tab.url) : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {menu && <Menu x={menu.x} y={menu.y} entries={entries(menu.bookmark)} label={`${menu.bookmark.title} menu`} onClose={() => setMenu(null)} />}
    </div>
  );
}
