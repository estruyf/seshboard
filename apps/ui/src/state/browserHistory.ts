import { useEffect } from 'react';
import type { BrowserHistoryEntry } from '@seshboard/protocol/client';
import type { EngineClient } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { usePreferences } from './preferencesStore.ts';

/*
 * The browser's history, kept in the engine (`browser.history.*`): the pages each tab opens, for the address bar's
 * suggestions, per browser profile. Only web pages: not an empty tab, a `data:` page or the app's own.
 */

let client: EngineClient | null = null;

const isWebPage = (url: string): boolean => /^https?:\/\//i.test(url);

/**
 * A tab opened `url` (`counted`), or its title changed, in its browser profile's history (null: Default's). A failed
 * save is let go: the next visit tries again.
 */
export function noteVisit(url: string | null | undefined, title: string, counted: boolean, profileId: string | null = null): void {
  if (!client || !url || !isWebPage(url) || url.length > 8000) return;
  client.call('browser.history.visit', { url, title: title.slice(0, 500), counted, profileId }).catch(() => {});
}

/** The pages in a browser profile's history that match what was typed; none while the engine is away. */
export async function searchHistory(query: string, limit = 50, profileId: string | null = null): Promise<BrowserHistoryEntry[]> {
  if (!client || !query.trim()) return [];
  try {
    return (await client.call('browser.history.search', { query: query.trim().slice(0, 500), limit, profileId })).entries;
  } catch {
    return [];
  }
}

/** Keeps the history while the engine is connected with the browser on. */
export function useBrowserHistorySync(): void {
  const connection = useEngineConnection();
  const connected = connection.status === 'connected' ? connection.client : null;
  const on = usePreferences((s) => s.prefs.browserEnabled);
  useEffect(() => {
    client = on ? connected : null;
  }, [connected, on]);
}
