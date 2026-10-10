// Packages Switchboard for the OS this runs on, with that platform's flags in one place; any other arguments
// (--config, --publish, -c.publish.channel=nightly) are passed on to electron-builder. Afterwards it checks
// that the app's archive holds only the app.
// Usage: node scripts/dist.mjs [electron-builder arguments]   (npm run dist runs electron-vite build first)
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const PLATFORM_ARGS = {
  // The .dmg, .zip and folder are Apple Silicon only (electron-builder.yml).
  darwin: ['--mac', '--arm64'],
  // The per-user installer names its folder after the package (%LOCALAPPDATA%\Programs\<name>), which would be
  // "@switchboarddesktop". Only the installer sees this name: the data folder comes from productName. It's set
  // here rather than in electron-builder.yml because on macOS it would also move the updater's download cache.
  win32: ['--win', '-c.extraMetadata.name=switchboard'],
};

/**
 * Signing on Windows with Azure Trusted Signing, when the release workflow sets these (docs/building-and-signing.md).
 * The account's credentials come from AZURE_TENANT_ID, AZURE_CLIENT_ID and AZURE_CLIENT_SECRET, which electron-builder
 * reads itself. A certificate file (WIN_CSC_LINK) needs nothing here either.
 */
const AZURE_SIGNING = {
  endpoint: 'AZURE_SIGNING_ENDPOINT',
  codeSigningAccountName: 'AZURE_SIGNING_ACCOUNT',
  certificateProfileName: 'AZURE_SIGNING_PROFILE',
  // Also written to the app's update feed settings: an update must be signed by the same publisher to install.
  publisherName: 'AZURE_SIGNING_PUBLISHER',
};

function azureSigningArgs() {
  const set = Object.entries(AZURE_SIGNING).filter(([, name]) => process.env[name]);
  if (set.length === 0) return [];
  const missing = Object.values(AZURE_SIGNING).filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`Azure Trusted Signing needs ${missing.join(', ')} too.`);
    process.exit(1);
  }
  return set.map(([option, name]) => `-c.win.azureSignOptions.${option}=${process.env[name]}`);
}

const platformArgs = PLATFORM_ARGS[process.platform];
if (!platformArgs) {
  console.error(`Switchboard is packaged on macOS and Windows, not on ${process.platform}.`);
  process.exit(1);
}
/** The app's archive in each build this OS makes. */
const ARCHIVES = {
  darwin: ['mac-arm64/Switchboard.app/Contents/Resources/app.asar'],
  win32: ['win-unpacked/resources/app.asar', 'win-arm64-unpacked/resources/app.asar'],
};
/** What may be at the top of app.asar. Anything else (src, scripts, .smoke with screenshots of real sessions) got in through a `files` pattern. */
const PACKAGED = new Set(['out', 'node_modules', 'package.json']);

/** Fails the build when an archive holds more than the app: electron-builder doesn't warn about it. */
function checkArchives(require) {
  // electron-builder's own copy, rather than a dependency of this package.
  const asar = createRequire(require.resolve('app-builder-lib/package.json'))('@electron/asar');
  const archives = ARCHIVES[process.platform].map((path) => join(import.meta.dirname, '..', 'dist', path)).filter((path) => existsSync(path));
  if (archives.length === 0) return 'found no app.asar to check';
  for (const archive of archives) {
    const extra = [...new Set(asar.listPackage(archive).map((entry) => entry.split(/[\\/]/)[1]))].filter((top) => !PACKAGED.has(top));
    if (extra.length) return `${archive} holds more than the app: ${extra.join(', ')}. Check the \`files\` patterns in electron-builder.yml.`;
  }
  return null;
}

const signingArgs = process.platform === 'win32' ? azureSigningArgs() : [];
const builderRequire = createRequire(createRequire(import.meta.url).resolve('electron-builder/package.json'));
const cli = builderRequire.resolve('./cli.js');
const result = spawnSync(process.execPath, [cli, ...platformArgs, ...signingArgs, ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
const problem = checkArchives(builderRequire);
if (problem) {
  console.error(`✗ ${problem}`);
  process.exit(1);
}
