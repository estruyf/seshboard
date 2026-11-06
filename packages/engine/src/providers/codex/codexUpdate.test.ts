import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderUpdateState } from '@seshboard/protocol';
import { appStateFake } from '../../system/testing.ts';
import { codexUpdater, codexUpdatesOff, detectCodexInstall, versionFromTag, type CodexUpdaterOptions } from './codexUpdate.ts';

describe('detectCodexInstall', () => {
  it("updates Codex's own installer with codex update, through the same binary", () => {
    expect(detectCodexInstall('/Users/me/.local/bin/codex', '/Users/me/.codex/packages/standalone/releases/0.167.0-aarch64-apple-darwin/codex', 'darwin')).toEqual({
      method: 'native',
      cask: null,
      command: 'codex update',
      run: { file: '/Users/me/.local/bin/codex', args: ['update'] },
    });
    expect(detectCodexInstall('C:\\Users\\me\\.local\\bin\\codex.exe', 'C:\\Users\\me\\.local\\bin\\codex.exe', 'win32')).toMatchObject({ method: 'native', command: 'codex update' });
  });

  it('updates Homebrew and npm installs with their own command', () => {
    expect(detectCodexInstall('/opt/homebrew/bin/codex', '/opt/homebrew/Caskroom/codex/0.167.0/codex-aarch64-apple-darwin', 'darwin')).toMatchObject({
      method: 'homebrew',
      cask: 'codex',
      command: 'brew upgrade --cask codex',
      run: { file: '/opt/homebrew/bin/brew', args: ['upgrade', '--cask', 'codex'] },
    });
    expect(detectCodexInstall('/home/linuxbrew/.linuxbrew/bin/codex', '/home/linuxbrew/.linuxbrew/Cellar/codex/0.167.0/bin/codex', 'linux')).toMatchObject({ method: 'homebrew', cask: null, command: 'brew upgrade codex' });
    // npm's link runs its script, which execs the native binary.
    expect(detectCodexInstall('/Users/me/.nvm/versions/node/v24.21.0/bin/codex', '/Users/me/.nvm/versions/node/v24.21.0/lib/node_modules/@openai/codex/bin/codex.js', 'darwin')).toMatchObject({
      method: 'npm',
      command: 'npm install -g @openai/codex@latest',
      run: { file: '/Users/me/.nvm/versions/node/v24.21.0/bin/npm', args: ['install', '-g', '@openai/codex@latest'] },
    });
    // On Windows Seshboard runs npm's native codex.exe, in the platform package nested in Codex's or next to it.
    const npm = 'C:\\Users\\me\\AppData\\Roaming\\npm';
    for (const exe of [
      `${npm}\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`,
      `${npm}\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`,
    ]) {
      expect(detectCodexInstall(exe, exe, 'win32')).toMatchObject({ method: 'npm', run: { file: 'npm', args: ['install', '-g', '--prefix', npm, '@openai/codex@latest'] } });
    }
  });
});

describe('versionFromTag', () => {
  it("reads Codex's release tags", () => {
    expect(versionFromTag('rust-v0.167.0')).toBe('0.167.0');
    expect(versionFromTag('rust-v0.168.0-alpha.3')).toBe('0.168.0-alpha.3');
    expect(versionFromTag('v1.2.3')).toBe('1.2.3');
    expect(versionFromTag('nightly')).toBeNull();
  });
});

describe('codexUpdatesOff', () => {
  it("follows Codex's own setting, and CI", () => {
    expect(codexUpdatesOff('model = "x"\ncheck_for_update_on_startup = false\n', {})).toBe(true);
    expect(codexUpdatesOff('check_for_update_on_startup = true\n', {})).toBe(false);
    expect(codexUpdatesOff(null, {})).toBe(false);
    expect(codexUpdatesOff(null, { CI: 'true' })).toBe(true);
  });
});

describe('codexUpdater', () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  });

  /** A Codex CLI at `installed` (Codex's own installer) when `latest` is the newest, whose update installs it. */
  function setup(installed: string, latest: string, extra: Partial<CodexUpdaterOptions> = {}) {
    let version = installed;
    const codexHome = mkdtempSync(join(tmpdir(), 'seshboard-codex-update-'));
    homes.push(codexHome);
    const states: ProviderUpdateState[] = [];
    const ran: string[] = [];
    const asked: Array<[string, string | null]> = [];
    const updater = codexUpdater({
      store: appStateFake(),
      binary: async () => ({ path: '/Users/me/.local/bin/codex', version }),
      codexHome,
      env: async () => ({ PATH: '/usr/bin' }),
      ready: Promise.resolve(),
      onChange: (state) => states.push(state),
      log: () => {},
      latest: async (method, cask) => (asked.push([method, cask]), latest),
      run: async (file, args, _env, onOutput) => {
        ran.push([file, ...args].join(' '));
        onOutput('Installing Codex\r\nDone\n');
        version = latest;
        return { exitCode: 0 };
      },
      ...extra,
    });
    return { updater, states, ran, asked, codexHome };
  }

  it('finds a newer version and updates with codex update', async () => {
    const { updater, ran, asked } = setup('0.167.0', '0.168.0');
    await updater.check();
    expect(updater.state).toMatchObject({ provider: 'codex', name: 'Codex CLI', status: 'available', method: 'native', command: 'codex update', canUpdate: true, installedVersion: '0.167.0', latestVersion: '0.168.0' });
    expect(asked).toEqual([['native', null]]);
    await updater.update();
    expect(ran).toEqual(['/Users/me/.local/bin/codex update']);
    expect(updater.state).toMatchObject({ status: 'updated', installedVersion: '0.168.0', updatedTo: '0.168.0' });
  });

  it('is up to date when nothing is newer, missing without codex, and an error offline', async () => {
    const current = setup('0.167.0', '0.167.0');
    await current.updater.check();
    expect(current.updater.state).toMatchObject({ status: 'up-to-date', latestVersion: '0.167.0' });

    const missing = setup('0.167.0', '0.168.0', { binary: async () => null });
    await missing.updater.check();
    expect(missing.updater.state.status).toBe('missing');

    const offline = setup('0.167.0', '0.168.0', { latest: async () => Promise.reject(new Error('getaddrinfo ENOTFOUND')) });
    await offline.updater.check();
    expect(offline.updater.state).toMatchObject({ status: 'error', installedVersion: '0.167.0' });
    expect(offline.updater.state.error).toBe('Couldn’t check for Codex CLI updates: getaddrinfo ENOTFOUND');
  });

  it("is quiet when Codex's own update check is off", async () => {
    const off = setup('0.167.0', '0.168.0');
    writeFileSync(join(off.codexHome, 'config.toml'), 'check_for_update_on_startup = false\n');
    await off.updater.check();
    expect(off.updater.state).toMatchObject({ status: 'available', latestVersion: '0.168.0' });
    const on = setup('0.167.0', '0.168.0');
    await on.updater.check();
    expect(off.updater.state.quiet).toBe(true);
    expect(on.updater.state.quiet).toBe(false);
  });
});
