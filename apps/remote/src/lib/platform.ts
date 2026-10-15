import { isMacPlatform, keyLabel } from './keys.ts';

/** This reader's platform, read once: ⌘ on macOS, Ctrl elsewhere. */
export const MAC = isMacPlatform(navigator.platform, navigator.userAgent);

/** A stored key (`mod+k`, `enter`, `a`) as this reader's keyboard shows it. */
export const keys = (stored: string) => keyLabel(stored, MAC);

/** Opened from the Home Screen (or as an installed app), not in a browser tab. */
export const STANDALONE = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
