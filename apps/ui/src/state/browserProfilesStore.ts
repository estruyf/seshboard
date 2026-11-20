import { useEffect } from 'react';
import { create } from 'zustand';
import { browserProfilePartition, browserProfilesFor, DEFAULT_BROWSER_PROFILE_NAME, type BrowserProfile, type BrowserProfileReset, type ProfileColor } from '@seshboard/protocol/client';
import { BROWSER_OWNER, tabsOfProfile, type BrowserTab } from '../components/webPreview/browserTabs.ts';
import { previewPage } from '../components/webPreview/webPreviewPages.ts';
import type { EngineClient } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { projectOfTab } from './browserBookmarksStore.ts';
import { usePaletteBus } from './paletteBus.ts';
import { usePreferences } from './preferencesStore.ts';
import { toast } from './toastStore.ts';
import { useWebPreview } from './webPreviewStore.ts';

/*
 * Browser profiles (docs/browser.md, Browser profiles): separate stores for browser pages, so one web app can be tried
 * under several accounts side by side. The engine keeps the list (`browser.profiles.*`) and each profile's history;
 * main keeps what its pages store, in the partition `persist:browser-<id>`. The built-in Default profile has no row:
 * it is `null` everywhere here. Not Claude profiles (`profilesStore.ts`).
 */

/** Your browser profiles, in order, as the engine keeps them; every window gets each change (`browser.profiles.changed`). */
export const useBrowserProfiles = create<{ profiles: readonly BrowserProfile[] }>()(() => ({ profiles: [] }));

let client: EngineClient | null = null;

async function load(): Promise<void> {
  if (!client) return;
  try {
    const { profiles } = await client.call('browser.profiles.list', {});
    useBrowserProfiles.setState({ profiles });
  } catch {
    // The list stays as it was; the next connection tries again.
  }
}

/** Loads the browser profiles once the engine is connected with the browser on, and follows every change. */
export function useBrowserProfilesSync(): void {
  const connection = useEngineConnection();
  const connected = connection.status === 'connected' ? connection.client : null;
  const on = usePreferences((s) => s.prefs.browserEnabled);
  useEffect(() => {
    client = on ? connected : null;
    if (!client) return;
    void load();
    return client.on('browser.profiles.changed', ({ profiles }) => {
      // A profile deleted in another window: its tabs here close too.
      const gone = new Set(useBrowserProfiles.getState().profiles.filter((p) => !profiles.some((q) => q.id === p.id)).map((p) => p.id));
      useBrowserProfiles.setState({ profiles });
      if (!gone.size) return;
      for (const tab of useWebPreview.getState().tabs) if (tab.profileId && gone.has(tab.profileId)) useWebPreview.getState().closeTab(tab.id);
      useWebPreview.setState((s) => ({ closed: s.closed.filter((t) => !t.profileId || !gone.has(t.profileId)) }));
    });
  }, [connected, on]);
}

/** A browser profile's name: its own, or Default for null (and for one deleted meanwhile). */
export function browserProfileName(profileId: string | null | undefined): string {
  return (profileId && useBrowserProfiles.getState().profiles.find((p) => p.id === profileId)?.name) || DEFAULT_BROWSER_PROFILE_NAME;
}

/** A tab's browser profile, or undefined for the Default one (no colour, no mark). */
export function useTabProfile(tab: Pick<BrowserTab, 'profileId'> | null): BrowserProfile | undefined {
  const id = tab?.profileId ?? null;
  return useBrowserProfiles((s) => (id ? s.profiles.find((p) => p.id === id) : undefined));
}

/**
 * The browser profiles an owner's new tab can use: a session's project's and the ones for everywhere; every one in the
 * Browser view, which belongs to no project.
 */
export function profilesForOwner(owner: string, profiles: readonly BrowserProfile[] = useBrowserProfiles.getState().profiles): BrowserProfile[] {
  return browserProfilesFor(profiles, owner === BROWSER_OWNER ? undefined : projectOfTab({ owner }));
}

/** A refused change (a name that clashes) as its message, for the form that made it. */
const failure = (error: unknown): string => (error instanceof Error && error.message ? error.message : "Couldn't save the browser profile.");

/** A new browser profile; its message when the engine refused it (a name that is taken), else null. */
export async function createBrowserProfile(input: { name: string; color: ProfileColor; projectRoot: string | null }): Promise<{ profile: BrowserProfile } | { error: string }> {
  if (!client) return { error: 'Seshboard is still starting.' };
  try {
    const { profile } = await client.call('browser.profiles.create', input);
    useBrowserProfiles.setState((s) => ({ profiles: s.profiles.some((p) => p.id === profile.id) ? s.profiles : [...s.profiles, profile] }));
    return { profile };
  } catch (error) {
    return { error: failure(error) };
  }
}

/** Renames a browser profile, or gives it another colour or place; its message when refused, else null. */
export async function updateBrowserProfile(id: string, change: { name?: string; color?: ProfileColor; projectRoot?: string | null }): Promise<string | null> {
  if (!client) return 'Seshboard is still starting.';
  try {
    await client.call('browser.profiles.update', { id, ...change });
    return null;
  } catch (error) {
    return failure(error);
  }
}

/** Waits until none of these tabs has a page any more (held off by `suspend`), so nothing writes back while main clears. */
async function pagesGone(tabIds: readonly string[]): Promise<void> {
  const until = Date.now() + 2_000;
  while (tabIds.some((id) => previewPage(id)) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 30));
  // A removed page's process ends a moment after its element.
  await new Promise((resolve) => setTimeout(resolve, 100));
}

/**
 * Reset: forgets what is ticked of a browser profile (null: the Default one). Its pages are held off first so none
 * writes back, and load again once it is done. Throws when main or the engine couldn't.
 */
export async function resetBrowserProfile(profileId: string | null, parts: BrowserProfileReset): Promise<void> {
  const web = useWebPreview.getState();
  const tabs = tabsOfProfile(web, profileId).map((t) => t.id);
  web.suspend(profileId, true);
  try {
    await pagesGone(tabs);
    if (parts.cookies || parts.siteData || parts.cache) await window.seshboard?.resetBrowserPartition(browserProfilePartition(profileId), parts);
    if (parts.history) await client?.call('browser.profiles.reset', { id: profileId, history: true });
  } finally {
    useWebPreview.getState().suspend(profileId, false);
  }
  toast(`${browserProfileName(profileId)} is reset`, { icon: 'browser' });
}

/**
 * Delete: closes the profile's tabs, clears everything its pages kept, then removes it with its pinned tabs and history.
 * Its partition's folder stays on disk, empty (deleting is only ever to the Trash, for session files). Throws when it couldn't.
 */
export async function deleteBrowserProfile(profileId: string): Promise<void> {
  const name = browserProfileName(profileId);
  const web = useWebPreview.getState();
  const tabs = tabsOfProfile(web, profileId);
  web.suspend(profileId, true);
  try {
    for (const tab of tabs) useWebPreview.getState().closeTab(tab.id);
    // A closed tab of this profile can't come back: its profile is gone.
    useWebPreview.setState((s) => ({ closed: s.closed.filter((t) => t.profileId !== profileId) }));
    await pagesGone(tabs.map((t) => t.id));
    await window.seshboard?.resetBrowserPartition(browserProfilePartition(profileId), { cookies: true, siteData: true, cache: true });
    if (!client) throw new Error('Seshboard is still starting.');
    await client.call('browser.profiles.delete', { id: profileId });
    useBrowserProfiles.setState((s) => ({ profiles: s.profiles.filter((p) => p.id !== profileId) }));
  } finally {
    useWebPreview.getState().suspend(profileId, false);
  }
  toast(`${name} is deleted`, { icon: 'browser' });
}

/** Reset profile…: its dialog, with what to forget (`PaletteDialogs`). */
export function askResetProfile(profileId: string | null): void {
  usePaletteBus.getState().showDialog({ kind: 'reset-browser-profile', profileId });
}

/** Delete profile…: asks first (`PaletteDialogs`). */
export function askDeleteProfile(profileId: string): void {
  usePaletteBus.getState().showDialog({ kind: 'delete-browser-profile', profileId });
}

/** Open in other profile: the same address in a new tab of `profileId`, beside it, in front. */
export function openInProfile(tab: Pick<BrowserTab, 'owner' | 'url'>, profileId: string | null): void {
  if (!tab.url) return;
  const web = useWebPreview.getState();
  web.openTab(tab.owner, tab.url, { profileId });
  if (tab.owner !== BROWSER_OWNER) web.open(tab.owner);
}
