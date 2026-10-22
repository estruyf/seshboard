/**
 * The `⋯` menu on a phone's Home: quick settings, with everything else on the Settings page. Pure, with tests;
 * `Connected.tsx` turns the items into menu rows.
 */

/** Notifications on this device: on, off, or off with nothing a tap can change here (blocked, not on the Home Screen). */
export type NotifyState = 'on' | 'off' | 'unavailable';

export type MoreItem = { id: 'theme' } | { id: 'notifications'; state: 'On' | 'Off' } | { id: 'refresh' } | { id: 'archived' } | { id: 'settings' } | { id: 'separator' };

/**
 * Theme (inline Auto, Dark and Light), Notifications with its state, then Refresh and Show archived (only when the
 * list can show archived sessions), then All settings. The same with one computer or several: the computers are in
 * the drawer's computer row and on the Settings page.
 */
export function moreItems({ notifications, archived }: { notifications: NotifyState; archived: boolean }): MoreItem[] {
  return [
    { id: 'theme' },
    { id: 'notifications', state: notifications === 'on' ? 'On' : 'Off' },
    { id: 'separator' },
    { id: 'refresh' },
    ...(archived ? [{ id: 'archived' } as const] : []),
    { id: 'separator' },
    { id: 'settings' },
  ];
}
