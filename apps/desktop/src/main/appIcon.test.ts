import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppIcon, type AppIconHost } from './appIcon.ts';

const DIR = join('/', 'app', 'resources', 'app-icons');

function host(platform: NodeJS.Platform, options: { bundled?: boolean; windows?: number; missing?: string[] } = {}) {
  const dock: string[] = [];
  const windows = Array.from({ length: options.windows ?? 2 }, () => ({ icons: [] as string[], closed: false }));
  const fake: AppIconHost = {
    platform,
    dir: DIR,
    bundled: options.bundled ?? true,
    dock: platform === 'darwin' ? { setIcon: (image) => void dock.push(image) } : undefined,
    windows: () => windows.map((win) => ({ setIcon: (icon: string) => void win.icons.push(icon), isDestroyed: () => win.closed })),
    exists: (path) => !(options.missing ?? []).some((name) => path.endsWith(name)),
  };
  return { fake, dock, windows };
}

describe('AppIcon', () => {
  it('sets the Dock icon on macOS, at launch and on every change', () => {
    const { fake, dock, windows } = host('darwin');
    const icon = new AppIcon(fake);
    icon.apply('signal');
    icon.apply('ocean');
    expect(dock).toEqual([join(DIR, 'signal.png'), join(DIR, 'ocean.png')]);
    // The Dock has it; macOS windows have no icon of their own.
    expect(windows.every((win) => win.icons.length === 0)).toBe(true);
    expect(icon.windowIcon()).toBeUndefined();
  });

  it('sets every open window on Windows (.ico) and Linux (the 256px tile)', () => {
    const windows = host('win32');
    new AppIcon(windows.fake).apply('plum');
    expect(windows.windows.map((win) => win.icons)).toEqual([[join(DIR, 'plum.ico')], [join(DIR, 'plum.ico')]]);

    const linux = host('linux');
    const icon = new AppIcon(linux.fake);
    icon.apply('forest');
    expect(linux.windows[0]!.icons).toEqual([join(DIR, 'forest-256.png')]);
    // A window opened later (a session's pop-out) and notifications get it too.
    expect(icon.windowIcon()).toBe(join(DIR, 'forest-256.png'));
  });

  it('leaves the bundle icon alone for Graphite until something else was shown', () => {
    const { fake, dock } = host('darwin');
    const icon = new AppIcon(fake);
    icon.apply('graphite');
    expect(dock).toEqual([]);
    icon.apply('neon');
    icon.apply('graphite');
    expect(dock).toEqual([join(DIR, 'neon.png'), join(DIR, 'graphite.png')]);

    const windows = host('win32');
    const onWindows = new AppIcon(windows.fake);
    onWindows.apply('graphite');
    expect(onWindows.windowIcon()).toBeUndefined();
    expect(windows.windows[0]!.icons).toEqual([]);
  });

  it('sets Graphite in development, where the bundle is Electron’s', () => {
    const { fake, dock } = host('darwin', { bundled: false });
    new AppIcon(fake).apply('graphite');
    expect(dock).toEqual([join(DIR, 'graphite.png')]);
  });

  it('puts the colourway back in the Dock after the working animation, Graphite included', () => {
    const { fake, dock } = host('darwin');
    const icon = new AppIcon(fake);
    icon.apply('graphite');
    expect(icon.dockFile()).toBe(join(DIR, 'graphite.png'));
    icon.restore();
    expect(dock).toEqual([join(DIR, 'graphite.png')]);
    // Once the Dock was drawn on, going back to Graphite has to set it.
    icon.apply('plum');
    icon.apply('graphite');
    expect(dock.at(-1)).toBe(join(DIR, 'graphite.png'));

    const windows = host('win32');
    const onWindows = new AppIcon(windows.fake);
    onWindows.restore();
    expect(onWindows.dockFile()).toBeUndefined();
    expect(windows.windows[0]!.icons).toEqual([]);
  });

  it('takes an unknown key as Graphite', () => {
    const { fake, dock } = host('darwin');
    const icon = new AppIcon(fake);
    icon.apply('signal');
    icon.apply('sunset');
    expect(icon.key).toBe('graphite');
    expect(dock.at(-1)).toBe(join(DIR, 'graphite.png'));
  });

  it('skips closed windows and a file the build lacks', () => {
    const { fake, windows } = host('win32', { missing: ['midnight.ico'] });
    windows[1]!.closed = true;
    const icon = new AppIcon(fake);
    icon.apply('midnight');
    expect(windows[0]!.icons).toEqual([]);
    icon.apply('paper');
    expect(windows.map((win) => win.icons)).toEqual([[join(DIR, 'paper.ico')], []]);
  });
});
