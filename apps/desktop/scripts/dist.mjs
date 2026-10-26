// Packages Switchboard for the OS this runs on, with that platform's flags in one place; any other arguments
// (--config, --publish, -c.publish.channel=beta) are passed on to electron-builder, on Windows through a config
// file (windowsBuildConfig.mjs). Afterwards it checks that the app's archive holds only the app, and that the Windows
// and Linux builds kept Chromium's English locale.
// Usage: node scripts/dist.mjs [electron-builder arguments]   (npm run dist runs electron-vite build first)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { windowsBuildConfig } from './windowsBuildConfig.mjs';

const appDir = join(import.meta.dirname, '..');

const PLATFORM_ARGS = {
  // The .dmg, .zip and folder are Apple Silicon only (electron-builder.yml).
  darwin: ['--mac', '--arm64'],
  win32: ['--win'],
  // The AppImage, .deb and .rpm for this machine's architecture (node-pty is compiled for it).
  linux: ['--linux'],
};

let platformArgs = PLATFORM_ARGS[process.platform];
if (!platformArgs) {
  console.error(`Switchboard is packaged on macOS, Windows and Linux, not on ${process.platform}.`);
  process.exit(1);
}
// The .rpm needs rpmbuild (the rpm package on Debian and Ubuntu, rpm-tools on Arch). Without it a local build
// makes the other two; the release workflow installs it.
if (process.platform === 'linux' && spawnSync('rpmbuild', ['--version']).error) {
  console.warn('rpmbuild is not installed: building the AppImage and .deb only.');
  platformArgs = ['--linux', 'AppImage', 'deb'];
}
/** The app's archive in each build this OS makes. */
const ARCHIVES = {
  darwin: ['mac-arm64/Switchboard.app/Contents/Resources/app.asar'],
  win32: ['win-unpacked/resources/app.asar', 'win-arm64-unpacked/resources/app.asar'],
  linux: ['linux-unpacked/resources/app.asar', 'linux-arm64-unpacked/resources/app.asar'],
};
/** What may be at the top of app.asar. Anything else (src, scripts, .smoke with screenshots of real sessions) got in through a `files` pattern. */
const PACKAGED = new Set(['out', 'node_modules', 'package.json']);

/** Fails the build when an archive holds more than the app: electron-builder doesn't warn about it. */
function checkArchives(require) {
  // electron-builder's own copy, rather than a dependency of this package.
  const asar = createRequire(require.resolve('app-builder-lib/package.json'))('@electron/asar');
  const archives = ARCHIVES[process.platform].map((path) => join(appDir, 'dist', path)).filter((path) => existsSync(path));
  if (archives.length === 0) return 'found no app.asar to check';
  for (const archive of archives) {
    const extra = [...new Set(asar.listPackage(archive).map((entry) => entry.split(/[\\/]/)[1]))].filter((top) => !PACKAGED.has(top));
    if (extra.length) return `${archive} holds more than the app: ${extra.join(', ')}. Check the \`files\` patterns in electron-builder.yml.`;
  }
  return null;
}

/**
 * Fails the build when a Windows or Linux build has no en-US.pak: without a locale file Chromium falls back to none,
 * app.getLocale() returns '' and Intl throws on it. electronLanguages keeps whole file names (electron-builder.yml).
 */
function checkLocales() {
  if (process.platform === 'darwin') return null;
  for (const archive of ARCHIVES[process.platform]) {
    if (!existsSync(join(appDir, 'dist', archive))) continue;
    const locales = join(appDir, 'dist', dirname(dirname(archive)), 'locales');
    if (!existsSync(join(locales, 'en-US.pak'))) return `${locales} has no en-US.pak. Check electronLanguages in electron-builder.yml.`;
  }
  return null;
}

/** On Windows the arguments go through a config file that extends the one asked for; elsewhere they pass as they are. */
function builderArgs(passed) {
  if (process.platform !== 'win32') return { args: passed, cleanup: () => {} };
  let built;
  try {
    built = windowsBuildConfig(passed, process.env);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  const dir = mkdtempSync(join(tmpdir(), 'switchboard-dist-'));
  const file = join(dir, 'electron-builder.windows.json');
  writeFileSync(file, JSON.stringify({ extends: resolve(appDir, built.base), ...built.config }, null, 2));
  return { args: ['--config', file, ...built.rest], cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const { args, cleanup } = builderArgs(process.argv.slice(2));
const builderRequire = createRequire(createRequire(import.meta.url).resolve('electron-builder/package.json'));
const cli = builderRequire.resolve('./cli.js');
const result = spawnSync(process.execPath, [cli, ...platformArgs, ...args], { stdio: 'inherit' });
cleanup();
if (result.status !== 0) process.exit(result.status ?? 1);
const problem = checkArchives(builderRequire) ?? checkLocales();
if (problem) {
  console.error(`✗ ${problem}`);
  process.exit(1);
}
