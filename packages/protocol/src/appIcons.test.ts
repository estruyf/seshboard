import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_ICONS,
  APP_ICON_KEYS,
  appIconKey,
  appIconLabel,
  appIconManifest,
  DEFAULT_APP_ICON,
  desktopIconFiles,
  REMOTE_ICON_FILES,
  remoteIconDir,
  remoteIconUrl,
  remoteManifestUrl,
  settingsTileFile,
  type WebManifest,
} from './appIcons.ts';
import { macIconSvg, maskableIconSvg } from './appIconForms.ts';

const repo = join(import.meta.dirname, '..', '..', '..');

describe('app icon colourways', () => {
  it('lists the nine, Graphite first', () => {
    expect(APP_ICON_KEYS).toEqual(['graphite', 'midnight', 'paper', 'signal', 'forest', 'plum', 'aluminium', 'ocean', 'neon']);
    expect(DEFAULT_APP_ICON).toBe('graphite');
    expect(APP_ICONS.map((icon) => icon.label)).toEqual(['Graphite', 'Midnight', 'Paper', 'Signal yellow', 'Forest', 'Plum', 'Aluminium', 'Ocean', 'Neon']);
    expect(appIconLabel('signal')).toBe('Signal yellow');
  });

  it('has every file for every key', () => {
    for (const key of APP_ICON_KEYS) {
      const desktop = desktopIconFiles(key);
      const files = [
        join(repo, 'assets', 'app-icons', `${key}.svg`),
        ...[desktop.dock, desktop.window, desktop.ico].map((name) => join(repo, 'apps', 'desktop', 'resources', 'app-icons', name)),
        join(repo, 'apps', 'ui', 'src', 'assets', 'app-icons', settingsTileFile(key)),
        ...REMOTE_ICON_FILES.map((name) => join(repo, 'apps', 'remote', 'public', remoteIconDir(key), name)),
      ];
      expect(files.filter((file) => !existsSync(file))).toEqual([]);
    }
  });

  it('takes an unknown or missing key as Graphite', () => {
    expect(appIconKey('ocean')).toBe('ocean');
    expect(appIconKey('sunset')).toBe('graphite');
    expect(appIconKey(undefined)).toBe('graphite');
    expect(appIconKey(42)).toBe('graphite');
  });

  it('keeps Graphite where the remote app always had it, the others in their own folder', () => {
    expect(remoteIconUrl('graphite', 'apple-touch-icon.png')).toBe('apple-touch-icon.png?v=graphite');
    expect(remoteIconUrl('signal', 'favicon.svg')).toBe('app-icons/signal/favicon.svg?v=signal');
    expect(remoteManifestUrl('graphite')).toBe('manifest.webmanifest');
    expect(remoteManifestUrl('plum')).toBe('app-icons/plum/manifest.webmanifest');
  });
});

describe('appIconManifest', () => {
  const base: WebManifest = {
    name: 'Switchboard Remote',
    start_url: '/remote/',
    scope: '/remote/',
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };

  it('points every icon at the colourway’s file, with a version query', () => {
    const manifest = appIconManifest(base, 'signal');
    expect(manifest.icons).toEqual([
      { src: 'icon-192.png?v=signal', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icon-maskable-512.png?v=signal', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
    // The same app to the browser: only the icons differ.
    expect({ ...manifest, icons: base.icons }).toEqual(base);
  });

  it('replaces a query or folder that was there', () => {
    expect(appIconManifest({ icons: [{ src: 'app-icons/neon/icon-512.png?v=neon' }] }, 'ocean').icons).toEqual([{ src: 'icon-512.png?v=ocean' }]);
  });

  it('works on the remote app’s own manifest', () => {
    const own = JSON.parse(readFileSync(join(repo, 'apps', 'remote', 'public', 'manifest.webmanifest'), 'utf8')) as WebManifest;
    const manifest = appIconManifest(own, 'forest');
    expect(manifest.icons?.length).toBe(own.icons?.length);
    for (const icon of manifest.icons ?? []) expect(REMOTE_ICON_FILES).toContain(icon.src.replace('?v=forest', ''));
  });
});

describe('app icon shapes', () => {
  const source = (key: string) => readFileSync(join(repo, 'assets', 'app-icons', `${key}.svg`), 'utf8');

  it('draws Graphite in the macOS grid exactly as the app’s icon', () => {
    expect(macIconSvg(source('graphite'))).toBe(readFileSync(join(repo, 'apps', 'desktop', 'build', 'icon.svg'), 'utf8'));
    expect(readFileSync(join(repo, 'apps', 'remote', 'public', 'favicon.svg'), 'utf8')).toBe(macIconSvg(source('graphite')));
  });

  it('makes every colourway’s shapes, with its own colours', () => {
    for (const key of APP_ICON_KEYS) {
      const mac = macIconSvg(source(key));
      const maskable = maskableIconSvg(source(key));
      expect(mac).toContain('viewBox="0 0 1024 1024"');
      expect(mac).toContain('rx="185"');
      expect(maskable).toContain('viewBox="40 40 944 944"');
      for (const stop of source(key).match(/stop-color="#[0-9a-f]{6}"/gi) ?? []) {
        expect(mac).toContain(stop);
        expect(maskable).toContain(stop);
      }
    }
  });

  it('refuses a source drawn another way', () => {
    expect(() => macIconSvg('<svg viewBox="0 0 10 10"></svg>')).toThrow(/Not an app icon source/);
  });
});
