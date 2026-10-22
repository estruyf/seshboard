import { describe, expect, it } from 'vitest';
import { APP_ICON_STORAGE, iconLinks, storedAppIcon } from './appIcon.ts';

describe('the remote app icon', () => {
  it('links Graphite where the app always had it', () => {
    expect(iconLinks('graphite', '/remote/')).toEqual({
      manifest: '/remote/manifest.webmanifest',
      appleTouchIcon: '/remote/apple-touch-icon.png?v=graphite',
      favicon: '/remote/favicon.svg?v=graphite',
    });
  });

  it('links another colourway to its own folder, with a version query for caches', () => {
    expect(iconLinks('signal', '/remote/')).toEqual({
      manifest: '/remote/app-icons/signal/manifest.webmanifest',
      appleTouchIcon: '/remote/app-icons/signal/apple-touch-icon.png?v=signal',
      favicon: '/remote/app-icons/signal/favicon.svg?v=signal',
    });
  });

  it('starts with the kept colourway, or Graphite', () => {
    const storage = (value: string | null) => () => ({ getItem: (key: string) => (key === APP_ICON_STORAGE ? value : null) });
    expect(storedAppIcon(storage('ocean'))).toBe('ocean');
    expect(storedAppIcon(storage('sunset'))).toBe('graphite');
    expect(storedAppIcon(storage(null))).toBe('graphite');
    expect(storedAppIcon(() => undefined)).toBe('graphite');
    expect(
      storedAppIcon(() => {
        throw new Error('blocked');
      }),
    ).toBe('graphite');
  });
});
