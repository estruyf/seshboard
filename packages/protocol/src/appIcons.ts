/**
 * The app icon's colourways (Settings › Theme › App icon): the same patch panel in other colours. Each one's source
 * is `assets/app-icons/<key>.svg`; `npm run icon:variants -w @switchboard/desktop` makes every file below from it,
 * and they are committed, so builds don't need it.
 */
export const APP_ICONS = [
  { key: 'graphite', label: 'Graphite' },
  { key: 'midnight', label: 'Midnight' },
  { key: 'paper', label: 'Paper' },
  { key: 'signal', label: 'Signal yellow' },
  { key: 'forest', label: 'Forest' },
  { key: 'plum', label: 'Plum' },
  { key: 'aluminium', label: 'Aluminium' },
  { key: 'ocean', label: 'Ocean' },
  { key: 'neon', label: 'Neon' },
] as const;

export type AppIconKey = (typeof APP_ICONS)[number]['key'];
export type AppIcon = (typeof APP_ICONS)[number];

/** Today's icon, the one in the app bundle. */
export const DEFAULT_APP_ICON: AppIconKey = 'graphite';

export const APP_ICON_KEYS: readonly AppIconKey[] = APP_ICONS.map((icon) => icon.key);

export const isAppIconKey = (value: unknown): value is AppIconKey => APP_ICON_KEYS.includes(value as AppIconKey);

/** A saved or sent key as a colourway: one this version doesn't know (a newer one's) is Graphite. */
export const appIconKey = (value: unknown): AppIconKey => (isAppIconKey(value) ? value : DEFAULT_APP_ICON);

export const appIconLabel = (key: AppIconKey): string => APP_ICONS.find((icon) => icon.key === key)!.label;

/**
 * The desktop's files, in main's `app-icons` folder (`apps/desktop/resources/app-icons`, packaged as extraResources):
 * the 1024px icon in the macOS grid for the Dock, and the tile without its margin for windows and the taskbar, as a
 * 256px PNG (Linux) and an `.ico` with every size (Windows).
 */
export function desktopIconFiles(key: AppIconKey): { dock: string; window: string; ico: string } {
  return { dock: `${key}.png`, window: `${key}-256.png`, ico: `${key}.ico` };
}

/** The tile Settings shows (128px, for 64px on a Retina screen), in `apps/ui/src/assets/app-icons`. */
export const settingsTileFile = (key: AppIconKey): string => `${key}.png`;

/** The remote app's icons, full bleed except the favicon (the tab's icon has the macOS corners, as the app's own). */
export const REMOTE_ICON_FILES = ['icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon.svg'] as const;
export type RemoteIconFile = (typeof REMOTE_ICON_FILES)[number];

/**
 * A colourway's folder in the remote app, relative to its base (`/remote/`): Graphite's files are the app's own, where
 * they always were, so the page and Home Screen apps from before keep them; the others are in `app-icons/<key>/`.
 */
export const remoteIconDir = (key: AppIconKey): string => (key === DEFAULT_APP_ICON ? '' : `app-icons/${key}/`);

/**
 * A remote icon's address, relative to the app's base, with `?v=<key>` so a browser that kept another colourway's
 * file under a name it has seen asks for this one.
 */
export const remoteIconUrl = (key: AppIconKey, file: RemoteIconFile): string => `${remoteIconDir(key)}${file}?v=${key}`;

/** The manifest for a colourway, relative to the remote app's base: the app's own for Graphite. */
export const remoteManifestUrl = (key: AppIconKey): string => (key === DEFAULT_APP_ICON ? 'manifest.webmanifest' : `${remoteIconDir(key)}manifest.webmanifest`);

/** What `appIconManifest` reads of a web app manifest; the rest is copied as it is. */
export interface WebManifest {
  icons?: { src: string; [field: string]: unknown }[];
  [field: string]: unknown;
}

/**
 * The remote app's manifest for a colourway, made from the app's own at build time and served from the colourway's
 * folder (`remoteManifestUrl`): every icon names the colourway's file there, with `?v=<key>`. `start_url`, `scope` and
 * the rest stay, so Android sees the same app with other icons.
 */
export function appIconManifest(base: WebManifest, key: AppIconKey): WebManifest {
  return {
    ...base,
    ...(base.icons ? { icons: base.icons.map((icon) => ({ ...icon, src: `${icon.src.split('?')[0]!.split('/').pop()}?v=${key}` })) } : {}),
  };
}
