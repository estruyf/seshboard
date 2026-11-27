import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BROWSER_EXTENSION_IDS, BROWSER_HOST_NAME } from '@seshboard/protocol/companion-client';
import { browserHostStatus, browserTargets, hostLauncher, hostManifest, installBrowserHost, removeBrowserHost, type HostInstall } from './browserExtensionHost.ts';

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('browser targets', () => {
  it('knows where each system keeps the manifests', () => {
    const mac = browserTargets('darwin', '/Users/me');
    expect(mac.find((t) => t.id === 'chrome')?.dir).toBe('/Users/me/Library/Application Support/Google/Chrome/NativeMessagingHosts');
    expect(mac.find((t) => t.id === 'firefox')?.dir).toBe('/Users/me/Library/Application Support/Mozilla/NativeMessagingHosts');
    const linux = browserTargets('linux', '/home/me');
    expect(linux.find((t) => t.id === 'brave')?.dir).toBe('/home/me/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts');
    expect(linux.find((t) => t.id === 'firefox')?.dir).toBe('/home/me/.mozilla/native-messaging-hosts');
    expect(linux.some((t) => t.id === 'arc')).toBe(false);
    const windows = browserTargets('win32', 'C:\\Users\\me');
    expect(windows.find((t) => t.id === 'edge')?.registryKey).toBe(`HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${BROWSER_HOST_NAME}`);
    expect(windows.find((t) => t.id === 'firefox')?.registryKey).toBe(`HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${BROWSER_HOST_NAME}`);
    expect(windows.every((t) => !t.dir)).toBe(true);
  });

  it('lets only the extension in', () => {
    expect(hostManifest('chromium', '/x/seshboard-host.sh')).toEqual({ name: BROWSER_HOST_NAME, description: 'Seshboard browser extension', path: '/x/seshboard-host.sh', type: 'stdio', allowed_origins: BROWSER_EXTENSION_IDS.chromium.map((id) => `chrome-extension://${id}/`) });
    expect(hostManifest('firefox', '/x/seshboard-host.sh')).toMatchObject({ allowed_extensions: [BROWSER_EXTENSION_IDS.firefox] });
  });

  it('runs the host with the app binary as Node', () => {
    const sh = hostLauncher('darwin', "/Applications/Sesh'board.app/Contents/MacOS/Seshboard", '/d/host.js', '/d/host.json');
    expect(sh.file).toBe('seshboard-host.sh');
    expect(sh.text).toBe(`#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec '/Applications/Sesh'\\''board.app/Contents/MacOS/Seshboard' '/d/host.js' '/d/host.json' "$@"\n`);
    const bat = hostLauncher('win32', 'C:\\Seshboard\\Seshboard.exe', 'C:\\d\\host.js', 'C:\\d\\host.json');
    expect(bat).toEqual({ file: 'seshboard-host.bat', text: '@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"C:\\Seshboard\\Seshboard.exe" "C:\\d\\host.js" "C:\\d\\host.json" %*\r\n' });
  });
});

describe.skipIf(process.platform === 'win32')('installing the host', () => {
  it('writes the host and a manifest for each browser that is here, and removes only its own', async () => {
    const home = mkdtempSync(join(tmpdir(), 'seshboard-home-'));
    folders.push(home);
    const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
    const appData = join(home, 'data');
    const hostScript = join(home, 'browser-host.js');
    writeFileSync(hostScript, '// host');
    // Chrome and Firefox are here, Edge isn't.
    const chrome = browserTargets(platform, home).find((t) => t.id === 'chrome')!.dir!;
    const firefox = browserTargets(platform, home).find((t) => t.id === 'firefox')!.dir!;
    mkdirSync(join(chrome, '..'), { recursive: true });
    mkdirSync(join(firefox, '..'), { recursive: true });

    const install: HostInstall = { platform, home, appData, executable: '/bin/seshboard', hostScript, config: { infoFiles: ['/x/engine.json'], launch: null, version: '1.0.0' } };
    const status = await installBrowserHost(install);
    expect(status.installed).toBe(true);
    expect(status.browsers.map((b) => [b.id, b.registered])).toEqual([
      ['chrome', true],
      ['firefox', true],
    ]);
    const manifest = JSON.parse(readFileSync(join(chrome, `${BROWSER_HOST_NAME}.json`), 'utf8')) as { path: string };
    expect(statSync(manifest.path).mode & 0o111).not.toBe(0);
    expect(readFileSync(join(appData, 'browser-extension', 'host.mjs'), 'utf8')).toBe('// host');
    expect(JSON.parse(readFileSync(join(appData, 'browser-extension', 'host.json'), 'utf8'))).toEqual(install.config);

    // Another app's manifest for Firefox stays.
    writeFileSync(join(firefox, `${BROWSER_HOST_NAME}.json`), JSON.stringify({ path: '/elsewhere/host.sh' }));
    const removed = await removeBrowserHost(install);
    expect(removed.installed).toBe(false);
    expect(browserHostStatus(install).browsers.every((b) => !b.registered)).toBe(true);
    expect(readFileSync(join(firefox, `${BROWSER_HOST_NAME}.json`), 'utf8')).toContain('/elsewhere/');
  });
});
