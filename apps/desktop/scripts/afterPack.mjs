// electron-builder afterPack hook: runs after the app is assembled and before it is signed.
// electron-builder renames the helper apps (folder, executable, display name, bundle id) but leaves
// CFBundleName at Electron's "Electron Helper …". macOS privacy prompts, such as Local Network access,
// name the engine's utility process (and the Claude Code processes it starts) by that key, so they
// said "Electron". Rename it to match the helper's display name.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** @param {import('electron-builder').AfterPackContext} context */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const frameworks = join(context.appOutDir, `${appName}.app`, 'Contents', 'Frameworks');
  for (const entry of readdirSync(frameworks)) {
    if (!entry.endsWith('.app')) continue;
    const plist = join(frameworks, entry, 'Contents', 'Info.plist');
    if (!existsSync(plist)) continue;
    // "Seshboard Helper (GPU).app" → "Seshboard Helper (GPU)"
    execFileSync('plutil', ['-replace', 'CFBundleName', '-string', entry.slice(0, -'.app'.length), plist]);
  }
}
