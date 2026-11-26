// Builds Seshboard's Dock tile plug-in (native/dock-tile) into a packaged app, before electron-builder signs it: the
// plug-in keeps the chosen app icon in the Dock after the app quits (see DockTilePlugIn.swift). Needs Swift (Xcode or
// its Command Line Tools), which the macOS release runners have. It is built for the architectures of the app.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The plug-in's folder name in Contents/PlugIns, which Info.plist's NSDockTilePlugIn names. */
export const DOCK_TILE_PLUGIN = 'SeshboardDockTile.docktileplugin';
const NAME = 'SeshboardDockTile';
/** Electron 44 runs on macOS 12 and later. */
const MIN_MACOS = '12.0';
const SOURCE = join(import.meta.dirname, '..', 'native', 'dock-tile', 'DockTilePlugIn.swift');

/** electron-builder's `Arch` (x64 = 1, arm64 = 3, universal = 4) as Swift's architectures. */
export function swiftArchs(arch) {
  if (arch === 1) return ['x86_64'];
  if (arch === 3) return ['arm64'];
  if (arch === 4) return ['arm64', 'x86_64'];
  throw new Error(`The Dock tile plug-in has no build for electron-builder's arch ${arch}.`);
}

/**
 * Compiles the plug-in into `<app>/Contents/PlugIns` and names it in the app's Info.plist.
 * @param {string} app The path to Seshboard.app.
 * @param {{ version: string; appId: string; archs: string[] }} info
 */
export function buildDockTilePlugin(app, { version, appId, archs }) {
  const bundle = join(app, 'Contents', 'PlugIns', DOCK_TILE_PLUGIN);
  rmSync(bundle, { recursive: true, force: true });
  mkdirSync(join(bundle, 'Contents', 'MacOS'), { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'seshboard-docktile-'));
  try {
    const slices = archs.map((arch) => {
      const out = join(work, arch);
      execFileSync('xcrun', ['swiftc', '-O', '-emit-library', '-module-name', NAME, '-target', `${arch}-apple-macos${MIN_MACOS}`, SOURCE, '-o', out], { stdio: 'inherit' });
      return out;
    });
    execFileSync('xcrun', ['lipo', '-create', ...slices, '-output', join(bundle, 'Contents', 'MacOS', NAME)], { stdio: 'inherit' });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  writeFileSync(join(bundle, 'Contents', 'Info.plist'), infoPlist({ version, appId }));
  execFileSync('plutil', ['-replace', 'NSDockTilePlugIn', '-string', DOCK_TILE_PLUGIN, join(app, 'Contents', 'Info.plist')]);
  // Signed as a bundle (the linker signs only the binary), so an unsigned build still verifies. A signed build signs it
  // again with the app's identity (macSign.mjs).
  execFileSync('codesign', ['--sign', '-', '--force', bundle], { stdio: 'inherit' });
}

/** The plug-in's Info.plist: a loadable bundle whose principal class is the Swift class's Objective-C name. */
function infoPlist({ version, appId }) {
  const entries = {
    CFBundleDevelopmentRegion: 'en',
    CFBundleExecutable: NAME,
    CFBundleIdentifier: `${appId}.docktile`,
    CFBundleInfoDictionaryVersion: '6.0',
    CFBundleName: NAME,
    CFBundlePackageType: 'BNDL',
    CFBundleShortVersionString: version,
    CFBundleVersion: version,
    LSMinimumSystemVersion: MIN_MACOS,
    NSPrincipalClass: 'SeshboardDockTilePlugIn',
  };
  const body = Object.entries(entries).map(([key, value]) => `  <key>${key}</key>\n  <string>${value}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}
</dict>
</plist>
`;
}
