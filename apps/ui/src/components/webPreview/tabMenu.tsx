import { Bookmark, Copy, ExternalLink, Globe, Layers, Pencil, Pin, PinOff, RotateCcw, Star, Volume2, VolumeX, X } from 'lucide-react';
import { DEFAULT_BROWSER_PROFILE_NAME } from '@seshboard/protocol/client';
import { askRename, copyAddress, openInSystemBrowser, toggleMute } from '../../state/browserActions.ts';
import { bookmarkPage, projectOfTab, useBrowserBookmarks } from '../../state/browserBookmarksStore.ts';
import { addFavorite } from '../../state/browserFavoritesStore.ts';
import { askResetProfile, openInProfile, profilesForOwner, useBrowserProfiles } from '../../state/browserProfilesStore.ts';
import { ProfileDot } from '../profiles/ProfileBadge.tsx';
import { useWebPreview } from '../../state/webPreviewStore.ts';
import type { MenuEntry } from '../Menu.tsx';
import { bookmarkOf } from './bookmarks.ts';
import type { BrowserTab } from './browserTabs.ts';

/**
 * With browser profiles: Open in other profile (the same address in a new tab of another profile) and Reset profile…
 * for the tab's own. Nothing while there are none, so the menu stays as it was.
 */
function profileEntries(tab: BrowserTab): MenuEntry[] {
  const profiles = useBrowserProfiles.getState().profiles;
  if (!profiles.length) return [];
  const others = [
    ...(tab.profileId ? [{ id: null, name: DEFAULT_BROWSER_PROFILE_NAME, icon: <Globe size={13} aria-hidden /> }] : []),
    ...profilesForOwner(tab.owner, profiles)
      .filter((p) => p.id !== tab.profileId)
      .map((p) => ({ id: p.id as string | null, name: p.name, icon: <ProfileDot color={p.color} /> })),
  ];
  return [
    {
      label: 'Open in other profile',
      icon: <Layers size={13} aria-hidden />,
      disabled: !tab.url || others.length === 0,
      data: { 'data-browser-tab-other-profile': true },
      submenu: others.map((other) => ({ label: other.name, icon: other.icon, onSelect: () => openInProfile(tab, other.id), data: { 'data-browser-tab-open-in': other.id ?? 'default' } })),
    },
    { label: 'Reset profile…', icon: <RotateCcw size={13} aria-hidden />, onSelect: () => askResetProfile(tab.profileId), data: { 'data-browser-tab-reset-profile': true } },
  ];
}

/**
 * A browser tab's menu, the same on the Browser view's list (right click or ⋯) and a session's tab strip (right click):
 * Add to favourites, Bookmark tab…, Pin or Unpin tab, Rename tab…, Mute, Copy address, Open in browser, with browser
 * profiles Open in other profile and Reset profile…, then Close tab.
 */
export function tabMenu(tab: BrowserTab): MenuEntry[] {
  const profiles = profileEntries(tab);
  return [
    // A Browser tab moves to its tile; a session's tab stays where it is, and the favourite shows in the Browser view.
    { label: 'Add to favourites', icon: <Star size={13} aria-hidden />, disabled: !tab.url, onSelect: () => addFavorite(tab), data: { 'data-browser-tab-favorite': true } },
    // A bookmark keeps the page to find again, with a name and folder in its dialog; the tab stays open.
    {
      label: bookmarkOf(useBrowserBookmarks.getState().bookmarks, tab.url, projectOfTab(tab)) ? 'Edit bookmark…' : 'Bookmark tab…',
      icon: <Bookmark size={13} aria-hidden />,
      disabled: !tab.url,
      onSelect: () => bookmarkPage(tab),
      data: { 'data-browser-tab-bookmark': true },
    },
    tab.pinned
      ? { label: 'Unpin tab', icon: <PinOff size={13} aria-hidden />, onSelect: () => useWebPreview.getState().unpin(tab.id), data: { 'data-browser-tab-unpin': true } }
      : { label: 'Pin tab', icon: <Pin size={13} aria-hidden />, disabled: !tab.url, onSelect: () => useWebPreview.getState().pin(tab.id), data: { 'data-browser-tab-pin': true } },
    { label: 'Rename tab…', icon: <Pencil size={13} aria-hidden />, onSelect: () => askRename(tab), data: { 'data-browser-tab-rename': true } },
    tab.muted
      ? { label: 'Unmute tab', icon: <Volume2 size={13} aria-hidden />, onSelect: () => toggleMute(tab) }
      : { label: 'Mute tab', icon: <VolumeX size={13} aria-hidden />, disabled: !tab.url, onSelect: () => toggleMute(tab) },
    { label: 'Copy address', icon: <Copy size={13} aria-hidden />, disabled: !tab.url, onSelect: () => copyAddress(tab) },
    { label: 'Open in browser', icon: <ExternalLink size={13} aria-hidden />, disabled: !tab.url, onSelect: () => openInSystemBrowser(tab) },
    ...(profiles.length ? (['separator', ...profiles] as MenuEntry[]) : []),
    'separator',
    { label: 'Close tab', icon: <X size={13} aria-hidden />, onSelect: () => useWebPreview.getState().askClose(tab.id), data: { 'data-browser-tab-close': true } },
  ];
}
