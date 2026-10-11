// Builds the app icon from build/icon.svg:
//   build/icon.png   1024×1024 (Dock icon in development, Linux)
//   build/icon.icns  every macOS size, for packaging
//   build/icon.ico   every Windows size, for packaging
//   ../ui/src/assets/app-icon.png  64×64 for the sidebar header
// Uses Electron to render the SVG and macOS's own sips + iconutil. Elsewhere only build/icon.ico is
// made, from the build/icon.png in the repository: the rest needs a Mac.
// Usage: npm run icon -w @switchboard/desktop
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const build = join(root, 'build');
const png = join(build, 'icon.png');
const iconset = join(build, 'icon.iconset');

const electron = createRequire(import.meta.url)('electron');
const ico = () => execFileSync(electron, [join(import.meta.dirname, 'ico.cjs'), png, join(build, 'icon.ico')], { stdio: 'ignore' });
if (process.platform !== 'darwin') {
  ico();
  console.log('Wrote build/icon.ico (the other icons are made on a Mac)');
  process.exit(0);
}
execFileSync(electron, [join(import.meta.dirname, 'render.cjs'), join(build, 'icon.svg'), png], { stdio: 'ignore' });
ico();

rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset);
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const px = size * scale;
    const name = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
    execFileSync('sips', ['-z', String(px), String(px), png, '--out', join(iconset, name)], { stdio: 'ignore' });
  }
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(build, 'icon.icns')]);
rmSync(iconset, { recursive: true, force: true });

const uiAssets = join(root, '..', 'ui', 'src', 'assets');
mkdirSync(uiAssets, { recursive: true });
// In the app the icon sits on its own; drop the macOS margin and shadow so the tile fills the space.
const tight = join(build, 'icon-tight.png');
execFileSync('sips', ['-c', '836', '836', png, '--out', tight], { stdio: 'ignore' });
execFileSync('sips', ['-z', '64', '64', tight, '--out', join(uiAssets, 'app-icon.png')], { stdio: 'ignore' });
rmSync(tight);
console.log('Wrote build/icon.png, build/icon.icns, build/icon.ico and ui/src/assets/app-icon.png');
