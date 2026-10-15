import { isMacPlatform, keyLabel } from './keys.ts';

/** This reader's platform, read once: ⌘ on macOS, Ctrl elsewhere. */
export const MAC = isMacPlatform(navigator.platform, navigator.userAgent);

/** A stored key (`mod+k`, `enter`, `a`) as this reader's keyboard shows it. */
export const keys = (stored: string) => keyLabel(stored, MAC);
