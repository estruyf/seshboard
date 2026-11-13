import { Copy, Ellipsis, ExternalLink, Pencil, Pin, PinOff, Plus, Volume2, VolumeX, X } from 'lucide-react';
import { Fragment } from 'react';
import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { shortUrl } from '@seshboard/protocol/client';
import type { BrowserFavorite } from '@seshboard/protocol/client';
import { matches } from '../../lib/shortcuts.ts';
import { useBrowserFavorites } from '../../state/browserFavoritesStore.ts';
import { askRename, copyAddress, openInSystemBrowser, toggleMute } from '../../state/browserActions.ts';
import { newBrowserTab, openFavorite } from '../../state/browserViewStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useWebPreview } from '../../state/webPreviewStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { useQueueDrag } from '../queue/useQueueDrag.ts';
import { Button } from '../ui/Button.tsx';
import { middleClose, middleDown, SoundMark, TabIcon, tabLabel, TabTitle } from '../webPreview/BrowserPane.tsx';
import { BROWSER_OWNER, ownerTabs, sameGroup, tabName, type BrowserTab } from '../webPreview/browserTabs.ts';
import { favoriteMenu, menuAt } from '../webPreview/FavoriteTiles.tsx';

/**
 * The Browser view's tabs in the sidebar, in place of the sessions, under your favourites (a click opens one in a tab):
 * pinned ones first, above a line, then the others, each with its icon and title and a ⋯ menu (Pin tab, Rename tab,
 * Copy address, Open in browser, Close tab), then Open tab. It scrolls on its own. Drag a tab (or ⌥↑ ⌥↓ on it) to move
 * it, inside its group: pinned tabs stay above the line.
 */
export function BrowserTabList() {
  const all = useWebPreview((s) => s.tabs);
  const activeId = useWebPreview((s) => s.active.get(BROWSER_OWNER) ?? null);
  const confirming = useWebPreview((s) => s.confirming);
  const atBrowser = useSessions((s) => s.view === 'browser');
  const tabs = ownerTabs({ tabs: all, active: new Map() }, BROWSER_OWNER);
  const [menu, setMenu] = useState<{ x: number; y: number; tab: BrowserTab } | null>(null);
  const favorites = useBrowserFavorites((s) => s.favorites);
  const [favoriteMenuAt, setFavoriteMenuAt] = useState<{ x: number; y: number; favorite: BrowserFavorite } | null>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const drag = useQueueDrag({
    ids: () => tabsRef.current.map((t) => t.id),
    move: (id, to) => useWebPreview.getState().move(id, to),
    mime: 'application/x-seshboard-browser-tab',
    canDrop: (dragged, target) => sameGroup(tabsRef.current.find((t) => t.id === dragged), tabsRef.current.find((t) => t.id === target)),
  });

  const show = (tab: BrowserTab) => {
    useWebPreview.getState().selectTab(tab.id);
    if (useSessions.getState().view !== 'browser') useSessions.getState().setView('browser');
  };
  const openMenu = (event: MouseEvent<HTMLElement>, tab: BrowserTab) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ x: event.clientX || rect.left, y: event.clientY || rect.bottom, tab });
  };
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, tab: BrowserTab) => {
    if (!matches(event.nativeEvent, 'browser.move-tab') || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    useWebPreview.getState().step(tab.id, event.key === 'ArrowUp' ? -1 : 1);
    // React moves the row in the DOM, which can drop focus: keep it on the tab.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-browser-tab-list] [data-browser-tab="${CSS.escape(tab.id)}"]`)?.focus());
  };
  const entries = (tab: BrowserTab): MenuEntry[] => [
    tab.pinned
      ? { label: 'Unpin tab', icon: <PinOff size={13} aria-hidden />, onSelect: () => useWebPreview.getState().unpin(tab.id), data: { 'data-browser-tab-unpin': true } }
      : { label: 'Pin tab', icon: <Pin size={13} aria-hidden />, disabled: !tab.url, onSelect: () => useWebPreview.getState().pin(tab.id), data: { 'data-browser-tab-pin': true } },
    { label: 'Rename tab…', icon: <Pencil size={13} aria-hidden />, onSelect: () => askRename(tab), data: { 'data-browser-tab-rename': true } },
    tab.muted
      ? { label: 'Unmute tab', icon: <Volume2 size={13} aria-hidden />, onSelect: () => toggleMute(tab) }
      : { label: 'Mute tab', icon: <VolumeX size={13} aria-hidden />, disabled: !tab.url, onSelect: () => toggleMute(tab) },
    { label: 'Copy address', icon: <Copy size={13} aria-hidden />, disabled: !tab.url, onSelect: () => copyAddress(tab) },
    { label: 'Open in browser', icon: <ExternalLink size={13} aria-hidden />, disabled: !tab.url, onSelect: () => openInSystemBrowser(tab) },
    'separator',
    { label: 'Close tab', icon: <X size={13} aria-hidden />, onSelect: () => useWebPreview.getState().askClose(tab.id), data: { 'data-browser-tab-close': true } },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-browser-tab-list>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {favorites.length > 0 && (
          <>
            <h2 className="px-2.5 pt-1 pb-1 text-meta font-semibold text-muted">Favourites</h2>
            <ul aria-label="Favourites" className="mb-3 grid grid-cols-[minmax(0,1fr)] gap-0.5" data-browser-favorites-list="">
              {favorites.map((favorite) => (
                <li key={favorite.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => openFavorite(favorite.url)}
                    onContextMenu={(e) => setFavoriteMenuAt({ ...menuAt(e), favorite })}
                    data-tooltip={`${favorite.title}\n${shortUrl(favorite.url)}`}
                    className="flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 text-left text-ui text-text/90 hover:bg-border/45"
                    data-browser-favorite={favorite.url}
                  >
                    <TabIcon tab={favorite} size={14} />
                    <span className="min-w-0 flex-1 truncate">{favorite.title}</span>
                  </button>
                </li>
              ))}
            </ul>
            <h2 className="px-2.5 pb-1 text-meta font-semibold text-muted">Tabs</h2>
          </>
        )}
        {/* One column no wider than the sidebar: a long title is cut, instead of widening every row past the edge. */}
        <ul aria-label="Browser tabs" className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
          {tabs.map((tab, index) => {
            const selected = atBrowser && tab.id === activeId;
            // A line under the pinned tabs sets them apart, in place of a pin on each.
            const lastPinned = tab.pinned && !tabs[index + 1]?.pinned;
            const mark = drag.markFor(tab.id);
            return (
              <Fragment key={tab.id}>
              <li className={`group relative min-w-0 ${drag.dragging === tab.id ? 'opacity-50' : ''}`} {...drag.props(tab.id)}>
                {mark && <span aria-hidden className={`pointer-events-none absolute inset-x-2 h-0.5 rounded-full bg-accent-ink ${mark === 'before' ? '-top-px' : '-bottom-px'}`} data-browser-tab-drop={mark} />}
                <button
                  type="button"
                  onClick={() => show(tab)}
                  onContextMenu={(e) => openMenu(e, tab)}
                  onMouseDown={middleDown}
                  onAuxClick={(e) => middleClose(e, tab.id)}
                  aria-current={selected ? 'page' : undefined}
                  aria-label={tabLabel(tab, confirming === tab.id)}
                  onDoubleClick={() => askRename(tab)}
                  onKeyDown={(e) => onKey(e, tab)}
                  data-tooltip={tab.url ? `${tabName(tab)}\n${shortUrl(tab.url)}` : tabName(tab)}
                  className={`flex h-8 w-full min-w-0 items-center gap-2 rounded-lg pr-8 pl-2.5 text-left text-ui ${selected ? 'bg-selected font-medium text-text' : 'text-text/90 hover:bg-border/45'}`}
                  data-browser-tab={tab.id}
                  data-browser-pinned={tab.pinned ? '' : undefined}
                  data-browser-confirm-close={confirming === tab.id ? '' : undefined}
                >
                  <TabIcon tab={tab} size={14} />
                  <TabTitle tab={tab} confirming={confirming === tab.id} />
                  <SoundMark tab={tab} />
                </button>
                <Button
                  variant="quiet"
                  size="sm"
                  iconOnly
                  icon={<Ellipsis size={13} aria-hidden />}
                  aria-label={`More for ${tabName(tab)}`}
                  aria-haspopup="menu"
                  onClick={(e) => openMenu(e, tab)}
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  data-browser-tab-menu={tab.id}
                />
              </li>
              {lastPinned && <li role="separator" className="mx-2.5 my-1.5 border-t border-border" data-browser-pinned-line="" />}
              </Fragment>
            );
          })}
        </ul>
        <button type="button" onClick={newBrowserTab} className="mt-1 flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-ui text-muted hover:bg-border/45 hover:text-text" data-browser-open-tab>
          <Plus size={14} aria-hidden />
          Open tab
        </button>
      </div>
      {menu && <Menu x={menu.x} y={menu.y} entries={entries(menu.tab)} label={`${tabName(menu.tab)} menu`} onClose={() => setMenu(null)} />}
      {favoriteMenuAt && <Menu x={favoriteMenuAt.x} y={favoriteMenuAt.y} entries={favoriteMenu(favoriteMenuAt.favorite)} label={`${favoriteMenuAt.favorite.title} menu`} onClose={() => setFavoriteMenuAt(null)} />}
    </div>
  );
}
