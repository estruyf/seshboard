import { appIconKey, remoteIconUrl, remoteManifestUrl, type AppIconKey } from '@seshboard/protocol/remote-client';

/** The colourway the app showed last, so a reload starts with it before the computer answers. Not secret: localStorage. */
export const APP_ICON_STORAGE = 'switchboard.appIcon';

/** The page's links for a colourway (the computer's Settings › Theme › App icon), from the app's base (`/remote/`). */
export function iconLinks(key: AppIconKey, base: string): { manifest: string; appleTouchIcon: string; favicon: string } {
  return { manifest: `${base}${remoteManifestUrl(key)}`, appleTouchIcon: `${base}${remoteIconUrl(key, 'apple-touch-icon.png')}`, favicon: `${base}${remoteIconUrl(key, 'favicon.svg')}` };
}

/**
 * The colourway kept from last time: Graphite when there is none, or one this version doesn't know. `storage` is a
 * getter, since only reading `localStorage` can throw where storage is blocked.
 */
export function storedAppIcon(storage: () => Pick<Storage, 'getItem'> | undefined): AppIconKey {
  try {
    return appIconKey(storage()?.getItem(APP_ICON_STORAGE));
  } catch {
    return appIconKey(null);
  }
}
