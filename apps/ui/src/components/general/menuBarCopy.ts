import { currentPlatform } from '../../lib/platform.ts';

/**
 * Settings › General › Menu bar, in each platform's words: the menu bar on macOS, the notification area on Windows,
 * the tray on Linux (a menu only, as a tray there can't open a panel). Settings shows these and its search finds them.
 */
export const menuBarTitle = (platform = currentPlatform()) => (platform === 'win32' ? 'Notification area' : 'Menu bar');

export const menuBarLabel = (platform = currentPlatform()) => (platform === 'win32' ? 'Show in the notification area' : 'Show in the menu bar');

export const menuBarDetail = (platform = currentPlatform()) =>
  platform === 'linux' ? 'The working light, and a menu to open Seshboard, start a session or pause notifications.' : 'The working light, what needs you, and new work from anywhere.';

export const KEEP_RUNNING_LABEL = 'Keep running when the window closes';
export const keepRunningDetail = (platform = currentPlatform()) =>
  platform === 'win32' ? 'Sessions keep going, and the icon stays in the notification area.' : 'Sessions keep going, and the menu bar stays.';

export const HIDE_DOCK_LABEL = 'Hide from the Dock while no window is open';
export const HIDE_DOCK_DETAIL = 'Seshboard lives in the menu bar only until you open it.';

/** What Settings search also finds these by. */
export const MENU_BAR_KEYWORDS = 'menu bar tray notification area system tray status icon dock panel background working light needs you new work';
