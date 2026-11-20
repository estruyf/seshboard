import { ViewHeader } from '../ViewHeader.tsx';
import { Globe, Plus } from 'lucide-react';
import { newBrowserTab, openFavorite } from '../../state/browserViewStore.ts';
import { useWebPreview } from '../../state/webPreviewStore.ts';
import { Button } from '../ui/Button.tsx';
import { BrowserPane } from '../webPreview/BrowserPane.tsx';
import { NewTabSections } from '../webPreview/NewTabPage.tsx';
import { BROWSER_OWNER } from '../webPreview/browserTabs.ts';
import { SidebarToggle } from '../sidebar/SidebarToggle.tsx';

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
      {/* With a tab, its toolbar is the header: the page's name is on its tab in the sidebar, so no title row. With none,
          the view's header and nothing to type into. */}
      {!tab && <ViewHeader title="Browser" />}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {tab ? (
          <BrowserPane
            tab={tab}
            onNewTab={newBrowserTab}
            asHeader
            lead={
              <span className="mr-2 flex">
                <SidebarToggle />
              </span>
            }
          />
        ) : (
          <NoPage />
        )}
      </div>
    </div>
  );
}

/** No tab in front: what to do, then favourites, bookmarks and closed tabs. */
function NoPage() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center-safe gap-3 overflow-y-auto px-6 py-8 text-center" data-browser-empty="">
      <Globe size={26} aria-hidden className="text-faint" />
      <p className="text-body font-semibold text-text">No page selected</p>
      <p className="text-ui text-muted">Pick a page from the list, or open a new tab.</p>
      <Button variant="primary" size="sm" icon={<Plus size={12} aria-hidden />} shortcut="browser.new-tab" onClick={newBrowserTab} data-browser-open-tab="">
        Open tab
      </Button>
      <div className="mt-3 flex w-full justify-center">
        <NewTabSections owner={BROWSER_OWNER} onOpen={(url) => useWebPreview.getState().openTab(BROWSER_OWNER, url)} onFavorite={openFavorite} />
      </div>
    </div>
  );
}
