import { currentPlatform } from '../../lib/platform.ts';

/**
 * Settings › Theme › App icon's words, shared by the page and Settings search. macOS shows the bundle's icon on
 * notifications whatever is chosen, so only the other systems mention them.
 */
export const appIconDetail = (platform = currentPlatform()) =>
  platform === 'darwin' ? 'The icon in the Dock and the app switcher. It changes right away.' : 'The icon on the window and in the taskbar. It changes right away.';

/** Where the chosen icon doesn't show: what the system takes from the app bundle or the shortcut. */
export const appIconNote = (platform = currentPlatform()) =>
  platform === 'darwin'
    ? 'macOS shows it while Seshboard runs. In Finder and Launchpad, the original icon stays.'
    : platform === 'win32'
      ? 'Pinned shortcuts and the Start menu keep the original icon.'
      : 'The app menu keeps the original icon.';
