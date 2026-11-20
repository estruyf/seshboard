import { ChevronDown, Globe, Plus, RotateCcw, Settings2, UserRound } from 'lucide-react';
import { useState, type MouseEvent, type ReactNode } from 'react';
import { DEFAULT_BROWSER_PROFILE_NAME, type BrowserProfile } from '@seshboard/protocol/client';
import { askResetProfile, profilesForOwner, useBrowserProfiles, useTabProfile } from '../../state/browserProfilesStore.ts';
import { openBrowserView } from '../../state/browserViewStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useWebPreview } from '../../state/webPreviewStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { ProfileDot } from '../profiles/ProfileBadge.tsx';
import { Button } from '../ui/Button.tsx';
import { BROWSER_OWNER, type BrowserTab } from './browserTabs.ts';

/*
 * Browser profiles on the tabs (docs/browser.md, Browser profiles): a tab in a profile other than Default shows the
 * profile's colour, the new tab button has a menu to open a tab in a profile, and the toolbar's switcher moves the tab
 * on screen to another profile.
 */

/** The dot of a tab's browser profile, with its name for the tooltip and screen readers; nothing for the Default one. */
export function ProfileMark({ tab, size = 7 }: { tab: Pick<BrowserTab, 'profileId'>; size?: number }) {
  const profile = useTabProfile(tab);
  if (!profile) return null;
  const label = `Profile: ${profile.name}`;
  return (
    <span role="img" aria-label={label} data-tooltip={label} className="flex shrink-0 items-center" data-browser-tab-profile={profile.id}>
      <ProfileDot color={profile.color} size={size} />
    </span>
  );
}

/** A new tab for an owner in a browser profile (null: Default), in front; the Browser view's shows that view. */
export function newTabInProfile(owner: string, profileId: string | null): void {
  useWebPreview.getState().openTab(owner, null, { profileId });
  if (owner === BROWSER_OWNER && useSessions.getState().view !== 'browser') openBrowserView();
}

/** The new tab menu: a tab in Default or in each profile the owner can use, then where to manage them. */
export function newTabMenu(owner: string, profiles: readonly BrowserProfile[]): MenuEntry[] {
  return [
    { heading: 'New tab in' },
    { label: DEFAULT_BROWSER_PROFILE_NAME, icon: <Globe size={13} aria-hidden />, onSelect: () => newTabInProfile(owner, null), data: { 'data-browser-new-tab-profile': 'default' } },
    ...profilesForOwner(owner, profiles).map(
      (profile): MenuEntry => ({ label: profile.name, icon: <ProfileDot color={profile.color} />, onSelect: () => newTabInProfile(owner, profile.id), data: { 'data-browser-new-tab-profile': profile.id } }),
    ),
    'separator',
    { label: 'Browser profiles…', icon: <Settings2 size={13} aria-hidden />, onSelect: () => useSessions.getState().openSettings('browser'), data: { 'data-browser-manage-profiles': true } },
  ];
}

/**
 * The ⌄ beside a new tab button, while the owner can use a browser profile: its menu opens a tab in one. Right-click on
 * the new tab button opens the same menu (`onContextMenu` from `useNewTabMenu`).
 */
export function useNewTabMenu(owner: string | null): { button: ReactNode; onContextMenu?(event: MouseEvent<HTMLElement>): void } {
  const profiles = useBrowserProfiles((s) => s.profiles);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const usable = owner ? profilesForOwner(owner, profiles) : [];
  if (!owner || usable.length === 0) return { button: null };
  const show = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ x: event.type === 'contextmenu' && event.clientX ? event.clientX : rect.left, y: event.type === 'contextmenu' && event.clientY ? event.clientY : rect.bottom + 4 });
  };
  return {
    onContextMenu: show,
    button: (
      <>
        <Button variant="quiet" size="sm" iconOnly icon={<ChevronDown size={12} aria-hidden />} aria-label="New tab in profile" data-tooltip="New tab in profile" aria-haspopup="menu" onClick={show} className="shrink-0" data-browser-new-tab-menu="" />
        {menu && <Menu x={menu.x} y={menu.y} entries={newTabMenu(owner, profiles)} label="New tab in profile" onClose={() => setMenu(null)} />}
      </>
    ),
  };
}

/**
 * The switcher's menu: Default and the profiles the tab's owner can use, the tab's own checked; picking another puts
 * the tab in it (`switchProfile`). Then Reset profile… and where to manage them (New browser profile… while there are none).
 */
export function profileSwitchMenu(tab: Pick<BrowserTab, 'id' | 'owner' | 'profileId'>, profiles: readonly BrowserProfile[]): MenuEntry[] {
  const usable = profilesForOwner(tab.owner, profiles);
  const pick = (profileId: string | null) => {
    if (profileId !== tab.profileId) useWebPreview.getState().switchProfile(tab.id, profileId);
  };
  return [
    { heading: 'Browser profile' },
    { label: DEFAULT_BROWSER_PROFILE_NAME, icon: <UserRound size={13} aria-hidden />, checked: tab.profileId === null, onSelect: () => pick(null), data: { 'data-browser-profile-switch-to': 'default' } },
    ...usable.map((profile): MenuEntry => ({ label: profile.name, icon: <ProfileDot color={profile.color} />, checked: tab.profileId === profile.id, onSelect: () => pick(profile.id), data: { 'data-browser-profile-switch-to': profile.id } })),
    'separator',
    { label: 'Reset profile…', icon: <RotateCcw size={13} aria-hidden />, onSelect: () => askResetProfile(tab.profileId), data: { 'data-browser-profile-switch-reset': true } },
    usable.length
      ? { label: 'Browser profiles…', icon: <Settings2 size={13} aria-hidden />, onSelect: () => useSessions.getState().openSettings('browser'), data: { 'data-browser-manage-profiles': true } }
      : { label: 'New browser profile…', icon: <Plus size={13} aria-hidden />, onSelect: () => useSessions.getState().openSettings('browser'), data: { 'data-browser-manage-profiles': true } },
  ];
}

/**
 * The toolbar's browser profile switcher, after the address bar: the tab's profile as its dot and name (a quiet person
 * icon for Default, so the bar stays calm without profiles). In a narrow toolbar only the dot stays, and in the
 * narrowest it goes to ⋯ (Browser profile there), so the address bar and × keep their room. Its menu is
 * `profileSwitchMenu`.
 */
export function ProfileSwitch({ tab }: { tab: Pick<BrowserTab, 'id' | 'owner' | 'profileId'> }) {
  const profiles = useBrowserProfiles((s) => s.profiles);
  const profile = useTabProfile(tab);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const label = `Browser profile: ${profile?.name ?? DEFAULT_BROWSER_PROFILE_NAME}`;
  const show = (event: MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({ x: rect.left, y: rect.bottom + 4 });
  };
  return (
    <>
      <Button
        variant="quiet"
        size="sm"
        iconOnly={!profile}
        icon={profile ? <ProfileDot color={profile.color} /> : <UserRound size={13} aria-hidden />}
        aria-label={label}
        data-tooltip={label}
        aria-haspopup="menu"
        aria-expanded={menu ? true : undefined}
        onClick={show}
        className={`@max-[360px]/toolbar:hidden ${profile ? 'max-w-32 @max-[520px]/toolbar:px-1.5' : ''}`}
        data-browser-profile-switch={profile?.id ?? 'default'}
      >
        {profile && <span className="min-w-0 truncate @max-[520px]/toolbar:hidden">{profile.name}</span>}
      </Button>
      {menu && <Menu x={menu.x} y={menu.y} entries={profileSwitchMenu(tab, profiles)} label="Browser profile" onClose={() => setMenu(null)} />}
    </>
  );
}
