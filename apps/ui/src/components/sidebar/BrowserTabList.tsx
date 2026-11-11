import { Copy, Ellipsis, ExternalLink, Pin, PinOff, Plus, X } from 'lucide-react';
import { useState, type MouseEvent } from 'react';
import { shortUrl } from '@seshboard/protocol/client';
import { newBrowserTab } from '../../state/browserViewStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { toast } from '../../state/toastStore.ts';
import { useWebPreview } from '../../state/webPreviewStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { Button } from '../ui/Button.tsx';
import { middleClose, middleDown, TabIcon } from '../webPreview/BrowserPane.tsx';
import { BROWSER_OWNER, ownerTabs, type BrowserTab } from '../webPreview/browserTabs.ts';

/**
 * The Browser view's tabs in the sidebar, in place of the sessions: pinned ones first, then the others, each with its
 * icon and title and a ⋯ menu (Pin tab, Copy address, Open in browser, Close tab), then Open tab. It scrolls on its own.
 */
export function BrowserTabList() {
  const all = useWebPreview((s) => s.tabs);
  const activeId = useWebPreview((s) => s.active.get(BROWSER_OWNER) ?? null);
  const atBrowser = useSessions((s) => s.view === 'browser');
  const tabs = ownerTabs({ tabs: all, active: new Map() }, BROWSER_OWNER);
  const [menu, setMenu] = useState<{ x: number; y: number; tab: BrowserTab } | null>(null);

  const show = (tab: BrowserTab) => {
    useWebPreview.getState().selectTab(tab.id);
    if (useSessions.getState().view !== 'browser') useSessions.getState().setView('browser');
  };
  const openMenu = (event: MouseEvent<HTMLElement>, tab: BrowserTab) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ x: event.clientX || rect.left, y: event.clientY || rect.bottom, tab });
  };
  const entries = (tab: BrowserTab): MenuEntry[] => [
    tab.pinned
      ? { label: 'Unpin tab', icon: <PinOff size={13} aria-hidden />, onSelect: () => useWebPreview.getState().unpin(tab.id), data: { 'data-browser-tab-unpin': true } }
      : { label: 'Pin tab', icon: <Pin size={13} aria-hidden />, disabled: !tab.url, onSelect: () => useWebPreview.getState().pin(tab.id), data: { 'data-browser-tab-pin': true } },
    {
      label: 'Copy address',
      icon: <Copy size={13} aria-hidden />,
      disabled: !tab.url,
      onSelect: () => void navigator.clipboard.writeText(tab.url ?? '').then(() => toast('Address copied'), () => toast("Couldn't copy the address", { tone: 'error' })),
    },
    { label: 'Open in browser', icon: <ExternalLink size={13} aria-hidden />, disabled: !tab.url, onSelect: () => tab.url && window.open(tab.url, '_blank') },
    'separator',
    { label: 'Close tab', icon: <X size={13} aria-hidden />, onSelect: () => useWebPreview.getState().closeTab(tab.id), data: { 'data-browser-tab-close': true } },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-browser-tab-list>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <ul aria-label="Browser tabs" className="grid gap-0.5">
          {tabs.map((tab, index) => {
            const selected = atBrowser && tab.id === activeId;
            return (
              <li key={tab.id} className={`group relative ${index > 0 && tabs[index - 1]!.pinned && !tab.pinned ? 'mt-2' : ''}`}>
                <button
                  type="button"
                  onClick={() => show(tab)}
                  onContextMenu={(e) => openMenu(e, tab)}
                  onMouseDown={middleDown}
                  onAuxClick={(e) => middleClose(e, tab.id)}
                  aria-current={selected ? 'page' : undefined}
                  aria-label={tab.pinned ? `${tab.title}, pinned` : tab.title}
                  data-tooltip={tab.url ? `${tab.title}\n${shortUrl(tab.url)}` : tab.title}
                  className={`flex h-8 w-full min-w-0 items-center gap-2 rounded-lg pr-8 pl-2.5 text-left text-ui ${selected ? 'bg-selected font-medium text-text' : 'text-text/90 hover:bg-border/45'}`}
                  data-browser-tab={tab.id}
                  data-browser-pinned={tab.pinned ? '' : undefined}
                >
                  <TabIcon tab={tab} size={14} />
                  <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                  {tab.pinned && <Pin size={11} aria-hidden className="shrink-0 text-faint" />}
                </button>
                <Button
                  variant="quiet"
                  size="sm"
                  iconOnly
                  icon={<Ellipsis size={13} aria-hidden />}
                  aria-label={`More for ${tab.title}`}
                  aria-haspopup="menu"
                  onClick={(e) => openMenu(e, tab)}
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  data-browser-tab-menu={tab.id}
                />
              </li>
            );
          })}
        </ul>
        <button type="button" onClick={newBrowserTab} className="mt-1 flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-ui text-muted hover:bg-border/45 hover:text-text" data-browser-open-tab>
          <Plus size={14} aria-hidden />
          Open tab
        </button>
      </div>
      {menu && <Menu x={menu.x} y={menu.y} entries={entries(menu.tab)} label={`${menu.tab.title} menu`} onClose={() => setMenu(null)} />}
    </div>
  );
}
