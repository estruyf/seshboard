import { describe, expect, it } from 'vitest';
import type { ProviderUpdateState } from '@seshboard/protocol';
import { appStateFake } from '../../system/testing.ts';
import { agyManifestPlatform, agyUpdater, agyUpdatesOff, detectAgyInstall, type AgyUpdaterOptions } from './agyUpdate.ts';

describe('detectAgyInstall', () => {
  it("updates Antigravity's own install with agy update, through the same binary", () => {
    expect(detectAgyInstall('/Users/me/.local/bin/agy', '/Users/me/.local/bin/agy', 'darwin')).toEqual({ method: 'native', cask: null, command: 'agy update', run: { file: '/Users/me/.local/bin/agy', args: ['update'] } });
    const exe = 'C:\\Users\\me\\AppData\\Local\\agy\\bin\\agy.exe';
    expect(detectAgyInstall(exe, exe, 'win32')).toMatchObject({ method: 'native', run: { file: exe, args: ['update'] } });
  });

  it("updates Homebrew's cask with brew, whose wrapper turns agy's own updates off", () => {
    expect(detectAgyInstall('/opt/homebrew/bin/agy', '/opt/homebrew/Caskroom/antigravity-cli/1.5.15,5514532022517760/.homebrew-command-wrappers/agy', 'darwin')).toEqual({
      method: 'homebrew',
      cask: 'antigravity-cli',
      command: 'brew upgrade --cask antigravity-cli',
      run: { file: '/opt/homebrew/bin/brew', args: ['upgrade', '--cask', 'antigravity-cli'] },
    });
  });
});

describe('agyManifestPlatform', () => {
  it("names the platform as Antigravity's installers do", () => {
    expect(agyManifestPlatform('darwin', 'arm64')).toBe('darwin_arm64');
    expect(agyManifestPlatform('darwin', 'x64')).toBe('darwin_amd64');
    expect(agyManifestPlatform('linux', 'x64')).toBe('linux_amd64');
    expect(agyManifestPlatform('win32', 'arm64')).toBe('windows_arm64');
  });
});

describe('agyUpdatesOff', () => {
  it("follows Antigravity's own setting, and CI", () => {
    expect(agyUpdatesOff({ AGY_CLI_DISABLE_AUTO_UPDATE: 'true' })).toBe(true);
    expect(agyUpdatesOff({ AGY_CLI_DISABLE_AUTO_UPDATE: '0' })).toBe(false);
    expect(agyUpdatesOff({})).toBe(false);
    expect(agyUpdatesOff({ CI: 'true' })).toBe(true);
  });
});

describe('agyUpdater', () => {
  /** An `agy` at `installed` (Antigravity's installer) when `latest` is the newest, whose update installs it. */
  function setup(installed: string, latest: string, extra: Partial<AgyUpdaterOptions> = {}) {
    let version = installed;
    const states: ProviderUpdateState[] = [];
    const ran: string[] = [];
    const asked: string[] = [];
    const updater = agyUpdater({
      store: appStateFake(),
      binary: async () => ({ path: '/Users/me/.local/bin/agy', version }),
      env: async () => ({ PATH: '/usr/bin' }),
      ready: Promise.resolve(),
      onChange: (state) => states.push(state),
      log: () => {},
      latest: async (method) => (asked.push(method), latest),
      run: async (file, args, _env, onOutput) => {
        ran.push([file, ...args].join(' '));
        onOutput('Updating to 1.5.16\n');
        version = latest;
        return { exitCode: 0 };
      },
      ...extra,
    });
    return { updater, states, ran, asked };
  }

  it('finds a newer version and updates with agy update', async () => {
    const { updater, ran, asked } = setup('1.5.12', '1.5.16');
    await updater.check();
    expect(updater.state).toMatchObject({ provider: 'antigravity', name: 'Antigravity CLI', status: 'available', method: 'native', command: 'agy update', canUpdate: true, installedVersion: '1.5.12', latestVersion: '1.5.16', quiet: false });
    expect(asked).toEqual(['native']);
    await updater.update();
    expect(ran).toEqual(['/Users/me/.local/bin/agy update']);
    expect(updater.state).toMatchObject({ status: 'updated', installedVersion: '1.5.16', updatedTo: '1.5.16' });
  });

  it('is up to date when nothing is newer, missing without agy, an error offline, and quiet with its updates off', async () => {
    const current = setup('1.5.16', '1.5.16');
    await current.updater.check();
    expect(current.updater.state).toMatchObject({ status: 'up-to-date', latestVersion: '1.5.16' });

    const missing = setup('1.5.12', '1.5.16', { binary: async () => null });
    await missing.updater.check();
    expect(missing.updater.state.status).toBe('missing');

    const offline = setup('1.5.12', '1.5.16', { latest: async () => Promise.reject(new Error('getaddrinfo ENOTFOUND')) });
    await offline.updater.check();
    expect(offline.updater.state).toMatchObject({ status: 'error', installedVersion: '1.5.12' });
    expect(offline.updater.state.error).toBe('Couldn’t check for Antigravity CLI updates: getaddrinfo ENOTFOUND');

    const off = setup('1.5.12', '1.5.16', { env: async () => ({ AGY_CLI_DISABLE_AUTO_UPDATE: 'true' }) });
    await off.updater.check();
    expect(off.updater.state).toMatchObject({ status: 'available', quiet: true });
  });
});
