import { execFile } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { promisify } from 'node:util';
import { BROWSER_EXTENSION_IDS, BROWSER_HOST_NAME } from '@seshboard/protocol/companion-client';
import { isSameOrInside } from '@seshboard/protocol/paths';
import type { BrowserExtensionHostStatus } from '@seshboard/protocol/bridge';
import type { HostConfig } from '../browserHost/host.ts';

/**
 * Installs the browser extension's native messaging host (docs/browser-extension.md): the host script and its config
 * in the app's data folder, and in each browser found here a manifest that names the host and the extension's id.
 * The paths are pure functions of the platform, so the tests cover every system on any of them.
 */

export type BrowserFamily = 'chromium' | 'firefox';

export interface BrowserTarget {
  id: string;
  name: string;
  family: BrowserFamily;
  /** macOS and Linux: the folder the manifest goes in. Its parent tells whether the browser is installed. */
  dir?: string;
  /** Windows: the key under HKEY_CURRENT_USER whose default value is the manifest's path. */
  registryKey?: string;
}

export type Platform = 'darwin' | 'win32' | 'linux';

/** The browsers the host is installed for, where each one looks for a user's native messaging hosts. */
export function browserTargets(platform: Platform, home: string): BrowserTarget[] {
  const macRoot = posix.join(home, 'Library', 'Application Support');
  const linuxRoot = posix.join(home, '.config');
  // Each Chromium browser: its folder on macOS and on Linux (null: not on that system), and its key on Windows.
  const chromium: Array<[id: string, name: string, mac: string | null, linux: string | null, windows: string | null]> = [
    ['chrome', 'Google Chrome', 'Google/Chrome', 'google-chrome', 'Google\\Chrome'],
    ['chrome-beta', 'Chrome Beta', 'Google/Chrome Beta', 'google-chrome-beta', null],
    ['chrome-canary', 'Chrome Canary', 'Google/Chrome Canary', null, null],
    ['chrome-for-testing', 'Chrome for Testing', 'Google/Chrome for Testing', null, null],
    ['chromium', 'Chromium', 'Chromium', 'chromium', 'Chromium'],
    ['edge', 'Microsoft Edge', 'Microsoft Edge', 'microsoft-edge', 'Microsoft\\Edge'],
    ['brave', 'Brave', 'BraveSoftware/Brave-Browser', 'BraveSoftware/Brave-Browser', 'BraveSoftware\\Brave-Browser'],
    ['vivaldi', 'Vivaldi', 'Vivaldi', 'vivaldi', null],
    ['arc', 'Arc', 'Arc/User Data', null, null],
  ];
  const targets: BrowserTarget[] = [];
  for (const [id, name, mac, linux, windows] of chromium) {
    if (platform === 'darwin' && mac) targets.push({ id, name, family: 'chromium', dir: posix.join(macRoot, ...mac.split('/'), 'NativeMessagingHosts') });
    if (platform === 'linux' && linux) targets.push({ id, name, family: 'chromium', dir: posix.join(linuxRoot, ...linux.split('/'), 'NativeMessagingHosts') });
    if (platform === 'win32' && windows) targets.push({ id, name, family: 'chromium', registryKey: `HKCU\\Software\\${windows}\\NativeMessagingHosts\\${BROWSER_HOST_NAME}` });
  }
  // Firefox reads one folder (or key) for every profile.
  if (platform === 'darwin') targets.push({ id: 'firefox', name: 'Firefox', family: 'firefox', dir: posix.join(macRoot, 'Mozilla', 'NativeMessagingHosts') });
  else if (platform === 'linux') targets.push({ id: 'firefox', name: 'Firefox', family: 'firefox', dir: posix.join(home, '.mozilla', 'native-messaging-hosts') });
  else targets.push({ id: 'firefox', name: 'Firefox', family: 'firefox', registryKey: `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${BROWSER_HOST_NAME}` });
  return targets;
}

/** The manifest a browser reads: the host's name, the program to start, and the extensions it lets in. */
export function hostManifest(family: BrowserFamily, hostPath: string): Record<string, unknown> {
  const base = { name: BROWSER_HOST_NAME, description: 'Seshboard browser extension', path: hostPath, type: 'stdio' };
  return family === 'firefox'
    ? { ...base, allowed_extensions: [BROWSER_EXTENSION_IDS.firefox] }
    : { ...base, allowed_origins: BROWSER_EXTENSION_IDS.chromium.map((id) => `chrome-extension://${id}/`) };
}

/**
 * The program the manifest names: a script that runs the host with Seshboard's own binary as Node (ELECTRON_RUN_AS_NODE),
 * so it needs no Node on the computer. The browser adds its own arguments after the config file's path.
 */
export function hostLauncher(platform: Platform, executable: string, script: string, config: string): { file: string; text: string } {
  if (platform === 'win32') {
    return { file: 'seshboard-host.bat', text: ['@echo off', 'set ELECTRON_RUN_AS_NODE=1', `"${executable}" "${script}" "${config}" %*`, ''].join('\r\n') };
  }
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
  return { file: 'seshboard-host.sh', text: ['#!/bin/sh', `ELECTRON_RUN_AS_NODE=1 exec ${quote(executable)} ${quote(script)} ${quote(config)} "$@"`, ''].join('\n') };
}

/** Where the host's own files go, inside the app's data folder. */
export const HOST_FOLDER = 'browser-extension';

export interface HostInstall {
  platform: Platform;
  home: string;
  /** The app's data folder (`Seshboard`, or `Seshboard Dev` for `npm run dev`). */
  appData: string;
  /** The binary that runs the host as Node: the app's own, or an AppImage's. */
  executable: string;
  /** The built host (`out/main/browser-host.js`): copied next to the config, so it outlives an AppImage's mount. */
  hostScript: string;
  config: HostConfig;
}

export type BrowserHostStatus = BrowserExtensionHostStatus;

const run = promisify(execFile);

/** Writes the host, its config and launcher, and a manifest for each browser found here. */
export async function installBrowserHost(install: HostInstall): Promise<BrowserHostStatus> {
  const folder = join(install.appData, HOST_FOLDER);
  mkdirSync(folder, { recursive: true });
  const script = join(folder, 'host.mjs');
  copyFileSync(install.hostScript, script);
  const config = join(folder, 'host.json');
  writeFileSync(config, `${JSON.stringify(install.config, null, 2)}\n`);
  const launcher = hostLauncher(install.platform, install.executable, script, config);
  const launcherPath = join(folder, launcher.file);
  writeFileSync(launcherPath, launcher.text);
  if (install.platform !== 'win32') chmodSync(launcherPath, 0o755);
  for (const family of ['chromium', 'firefox'] as const) writeFileSync(join(folder, `${family}.json`), `${JSON.stringify(hostManifest(family, launcherPath), null, 2)}\n`);

  for (const target of browserTargets(install.platform, install.home)) {
    const manifest = join(folder, `${target.family}.json`);
    if (target.dir) {
      // Only for a browser that is here: its own folder exists.
      if (!existsSync(join(target.dir, '..'))) continue;
      mkdirSync(target.dir, { recursive: true });
      copyFileSync(manifest, join(target.dir, `${BROWSER_HOST_NAME}.json`));
    } else if (target.registryKey) {
      await run('reg', ['add', target.registryKey, '/ve', '/t', 'REG_SZ', '/d', manifest, '/f'], { windowsHide: true });
    }
  }
  return browserHostStatus(install);
}

/** Removes the manifests that point at this app's host, then the host's files. */
export async function removeBrowserHost(install: Omit<HostInstall, 'config' | 'hostScript' | 'executable'>): Promise<BrowserHostStatus> {
  const folder = join(install.appData, HOST_FOLDER);
  for (const target of browserTargets(install.platform, install.home)) {
    if (target.dir) {
      const file = join(target.dir, `${BROWSER_HOST_NAME}.json`);
      if (pointsInto(file, folder)) rmSync(file, { force: true });
    } else if (target.registryKey) {
      await run('reg', ['delete', target.registryKey, '/f'], { windowsHide: true }).catch(() => {});
    }
  }
  rmSync(folder, { recursive: true, force: true });
  return browserHostStatus(install);
}

/** Whether a browser's manifest is there and starts this app's host. */
function pointsInto(manifestFile: string, folder: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as { path?: unknown };
    return typeof manifest.path === 'string' && isSameOrInside(manifest.path, folder);
  } catch {
    return false;
  }
}

export function browserHostStatus(install: Pick<HostInstall, 'platform' | 'home' | 'appData'>): BrowserHostStatus {
  const folder = join(install.appData, HOST_FOLDER);
  const installed = existsSync(join(folder, 'host.json'));
  const browsers = browserTargets(install.platform, install.home).flatMap((target) => {
    // On Windows the registry isn't read back: the browsers are listed as registered once the files are there.
    if (target.registryKey) return [{ id: target.id, name: target.name, family: target.family, found: true, registered: installed }];
    const found = !!target.dir && existsSync(join(target.dir, '..'));
    if (!found) return [];
    return [{ id: target.id, name: target.name, family: target.family, found, registered: pointsInto(join(target.dir!, `${BROWSER_HOST_NAME}.json`), folder) }];
  });
  return { installed, browsers };
}
