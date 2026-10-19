// Builds every file of the app icon colourways (Settings › Theme › App icon) from assets/app-icons/<key>.svg:
//   resources/app-icons/<key>.png        1024×1024 in the macOS grid, for the Dock
//   resources/app-icons/<key>-256.png    the tile at 256×256, for windows on Linux
//   resources/app-icons/<key>.ico        the tile at every Windows size, for windows and the taskbar
//   ../ui/src/assets/app-icons/<key>.png the tile at 128×128, for Settings
//   ../remote/public/<dir>               icon-192/512, the maskable 192/512 and apple-touch-icon (180) full bleed, and
//                                        favicon.svg in the macOS grid; <dir> is the app's own folder for Graphite,
//                                        app-icons/<key>/ for the others (remoteIconDir in the protocol). Graphite's
//                                        PNGs there are the ones the remote app always had, kept as they are.
// Renders with Electron (app-icons.cjs), so it runs on any OS. The output is committed: builds don't run this.
// Usage: npm run icon:variants -w @switchboard/desktop
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_ICONS, DEFAULT_APP_ICON, desktopIconFiles, remoteIconDir, settingsTileFile } from '../../../../packages/protocol/src/appIcons.ts';
import { macIconSvg, maskableIconSvg } from '../../../../packages/protocol/src/appIconForms.ts';

const desktop = join(import.meta.dirname, '..', '..');
const repo = join(desktop, '..', '..');
const sources = join(repo, 'assets', 'app-icons');
const resources = join(desktop, 'resources', 'app-icons');
const tiles = join(repo, 'apps', 'ui', 'src', 'assets', 'app-icons');
const remote = join(repo, 'apps', 'remote', 'public');

const jobs = [];
for (const { key } of APP_ICONS) {
  const source = readFileSync(join(sources, `${key}.svg`), 'utf8');
  const mac = macIconSvg(source);
  const files = desktopIconFiles(key);
  const remoteDir = join(remote, remoteIconDir(key));
  mkdirSync(resources, { recursive: true });
  mkdirSync(tiles, { recursive: true });
  mkdirSync(remoteDir, { recursive: true });
  writeFileSync(join(remoteDir, 'favicon.svg'), mac);
  jobs.push({
    svg: mac,
    outputs: [
      { file: join(resources, files.dock), size: 1024 },
      { file: join(resources, files.window), size: 256, tile: true },
      { file: join(resources, files.ico), tile: true, ico: true },
      { file: join(tiles, settingsTileFile(key)), size: 128, tile: true },
    ],
  });
  if (key === DEFAULT_APP_ICON) continue;
  jobs.push(
    {
      svg: source,
      outputs: [
        { file: join(remoteDir, 'icon-192.png'), size: 192 },
        { file: join(remoteDir, 'icon-512.png'), size: 512 },
        { file: join(remoteDir, 'apple-touch-icon.png'), size: 180 },
      ],
    },
    {
      svg: maskableIconSvg(source),
      outputs: [
        { file: join(remoteDir, 'icon-maskable-192.png'), size: 192 },
        { file: join(remoteDir, 'icon-maskable-512.png'), size: 512 },
      ],
    },
  );
}

const scratch = mkdtempSync(join(tmpdir(), 'switchboard-app-icons-'));
try {
  const list = join(scratch, 'jobs.json');
  writeFileSync(list, JSON.stringify(jobs));
  const electron = createRequire(import.meta.url)('electron');
  execFileSync(electron, [join(import.meta.dirname, 'app-icons.cjs'), list], { stdio: 'ignore' });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(`Wrote ${APP_ICONS.length} app icons to resources/app-icons, ui/src/assets/app-icons and remote/public`);
