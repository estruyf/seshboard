import { useEffect } from 'react';
import type { BrowserTab } from '../components/webPreview/browserTabs.ts';
import { keptFavicon } from '../components/webPreview/favorites.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { popoutSession } from './popoutsStore.ts';
import { usePreferences } from './preferencesStore.ts';
import { useWebPreview } from './webPreviewStore.ts';

/** A pinned tab's address and title change as you browse: saved at most this often per tab. */
const SAVE_MS = 1_000;

/** What the engine keeps of a pinned tab. */
const kept = (tab: BrowserTab) => ({ id: tab.id, owner: tab.owner, url: tab.url ?? '', title: tab.title.slice(0, 500), name: tab.name, favicon: keptFavicon(tab.favicon), position: tab.position });
// The title alone is no reason to write: a page whose title ticks (a timer, an unread count) would write every second.
// It is saved with the next change of address, name or place; the page says it again when it loads.
const same = (a: ReturnType<typeof kept>, b: ReturnType<typeof kept>) => a.url === b.url && a.name === b.name && a.favicon === b.favicon && a.position === b.position && a.owner === b.owner;

/**
 * Pinned browser tabs that last (the browser on): once per connection the engine's list is restored (their pages
 * load when first shown), then every pin, unpin, move, rename and close is saved, and a pinned tab's address and title
 * as you browse, at most once a second. Tabs that aren't pinned live only in the window. The main window only: a pop-out's
 * tabs are the same session's, kept there.
 */
export function useBrowserTabsSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const on = usePreferences((s) => s.prefs.browserEnabled);
  useEffect(() => {
    if (!client || !on || popoutSession) return;
    let saved = new Map<string, ReturnType<typeof kept>>();
    let ready = false;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const fail = () => {};
    const save = (tab: ReturnType<typeof kept>) => {
      clearTimeout(timers.get(tab.id));
      timers.set(
        tab.id,
        setTimeout(() => {
          timers.delete(tab.id);
          void client.call('browser.pinned.save', { tab }).catch(fail);
        }, SAVE_MS),
      );
    };
    const sync = () => {
      if (!ready) return;
      const now = new Map(useWebPreview.getState().tabs.filter((t) => t.pinned && t.url).map((t) => [t.id, kept(t)]));
      for (const [id, tab] of now) {
        const before = saved.get(id);
        // A new pin or a name you gave is saved at once; browsing on waits a moment.
        if (!before || before.name !== tab.name) {
          clearTimeout(timers.get(id));
          timers.delete(id);
          void client.call('browser.pinned.save', { tab }).catch(fail);
        } else if (!same(before, tab)) save(tab);
      }
      for (const id of saved.keys()) {
        if (now.has(id)) continue;
        clearTimeout(timers.get(id));
        timers.delete(id);
        void client.call('browser.pinned.remove', { id }).catch(fail);
      }
      saved = now;
    };
    const off = useWebPreview.subscribe((state, previous) => state.tabs !== previous.tabs && sync());
    void client.call('browser.pinned.list', {}).then(
      ({ tabs }) => {
        useWebPreview.getState().restorePinned(tabs);
        // What the engine has is what is saved; anything pinned meanwhile is saved by the first sync.
        saved = new Map(tabs.map((t) => [t.id, { id: t.id, owner: t.owner, url: t.url, title: t.title, name: t.name ?? null, favicon: t.favicon ?? null, position: t.position }]));
        ready = true;
        sync();
      },
      () => {
        ready = true;
        sync();
      },
    );
    return () => {
      off();
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, [client, on]);
}
