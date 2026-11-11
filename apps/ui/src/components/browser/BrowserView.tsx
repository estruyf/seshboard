import { Globe, Plus } from 'lucide-react';
import { newBrowserTab } from '../../state/browserViewStore.ts';
import { useWebPreview } from '../../state/webPreviewStore.ts';
import { SidebarToggle } from '../sidebar/SidebarToggle.tsx';
import { Button } from '../ui/Button.tsx';
import { BrowserPane } from '../webPreview/BrowserPane.tsx';
import { BROWSER_OWNER } from '../webPreview/browserTabs.ts';

/**
 * The Browser view (the browser on): the tabs that belong to no session, listed in the sidebar, and the one in
 * front here. Its pages live with the sessions' (`webPreviewPages.ts`), so they keep running while a session is on screen.
 */
export function BrowserView() {
  const tab = useWebPreview((s) => {
    const id = s.active.get(BROWSER_OWNER);
    return id ? (s.tabs.find((t) => t.id === id) ?? null) : null;
  });
  return (
    // The main area's surface, apart from the sidebar's, as every other view.
    <div className="@container flex h-full min-h-0 flex-col bg-bg" data-browser-view="">
      <header className="drag flex h-11 shrink-0 items-center gap-2 px-4">
        <SidebarToggle />
        <h1 className="min-w-0 flex-1 truncate text-title font-semibold text-text">{tab ? tab.title : 'Browser'}</h1>
      </header>
      {/* The toolbar and address bar come with a tab: with none there is nothing to type into. */}
      <div className="no-drag relative flex min-h-0 flex-1 flex-col">{tab ? <BrowserPane tab={tab} onNewTab={newBrowserTab} /> : <NoPage />}</div>
    </div>
  );
}

/** No tab in front: what to do. */
function NoPage() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center" data-browser-empty="">
      <Globe size={26} aria-hidden className="text-faint" />
      <p className="text-body font-semibold text-text">No page selected</p>
      <p className="text-ui text-muted">Pick a page from the list, or open a new tab.</p>
      <Button size="sm" icon={<Plus size={12} aria-hidden />} shortcut="browser.new-tab" onClick={newBrowserTab} data-browser-open-tab="">
        Open tab
      </Button>
    </div>
  );
}
