// electron-builder's sign hook (mac.sign): signs the Dock tile plug-in, then the app as electron-builder would.
// electron-builder leaves everything in Contents/PlugIns unsigned (it expects those to come signed), so the plug-in
// that afterPack builds (dockTile.mjs) gets the app's identity here, with the hardened runtime and a timestamp that
// notarisation asks for. The app's own signature then seals it.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { DOCK_TILE_PLUGIN } from './dockTile.mjs';

/** electron-builder's own signing (@electron/osx-sign, with its retries), from the copy it runs with. */
const builderRequire = createRequire(createRequire(import.meta.url).resolve('electron-builder/package.json'));
const { sign: signApp } = builderRequire('app-builder-lib/out/codeSign/macCodeSign.js');

/** @param {import('@electron/osx-sign').SignOptions} opts */
export default async function sign(opts) {
  const plugin = join(opts.app, 'Contents', 'PlugIns', DOCK_TILE_PLUGIN);
  if (existsSync(plugin)) {
    const keychain = opts.keychain ? ['--keychain', opts.keychain] : [];
    execFileSync('codesign', ['--sign', opts.identity, '--force', '--timestamp', '--options', 'runtime', ...keychain, plugin], { stdio: 'inherit' });
  }
  await signApp(opts);
}
