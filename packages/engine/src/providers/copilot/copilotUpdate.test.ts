import { describe, expect, it } from 'vitest';
import type { ProviderUpdateState } from '@seshboard/protocol';
import { appStateFake } from '../../system/testing.ts';
import { copilotUpdater, copilotUpdatesOff, detectCopilotInstall, parseCopilotVersionOutput, type CopilotUpdaterOptions } from './copilotUpdate.ts';

describe('detectCopilotInstall', () => {
  it("updates Copilot's own install with copilot update, through the same binary", () => {
    expect(detectCopilotInstall('/Users/me/.local/bin/copilot', [], '/Users/me/.local/bin/copilot', 'darwin')).toEqual({
      method: 'native',
      cask: null,
      command: 'copilot update',
      run: { file: '/Users/me/.local/bin/copilot', args: ['update'] },
    });
  });

  it('updates Homebrew, npm and WinGet installs with their own command', () => {
    expect(detectCopilotInstall('/opt/homebrew/bin/copilot', [], '/opt/homebrew/Caskroom/copilot-cli/1.0.90/copilot', 'darwin')).toMatchObject({
      method: 'homebrew',
      command: 'brew upgrade --cask copilot-cli',
      run: { file: '/opt/homebrew/bin/brew', args: ['upgrade', '--cask', 'copilot-cli'] },
    });
    expect(detectCopilotInstall('/opt/homebrew/bin/copilot', [], '/opt/homebrew/Cellar/copilot-cli/1.0.90/bin/copilot', 'darwin')).toMatchObject({ method: 'homebrew', command: 'brew upgrade copilot-cli' });
    expect(detectCopilotInstall('/usr/local/bin/copilot', [], '/usr/local/lib/node_modules/@github/copilot/npm-loader.js', 'linux')).toMatchObject({
      method: 'npm',
      command: 'npm install -g @github/copilot@latest',
      run: { file: '/usr/local/bin/npm', args: ['install', '-g', '@github/copilot@latest'] },
    });
    // On Windows npm's install runs as node with its script, which says where the package is.
    const script = 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@github\\copilot\\npm-loader.js';
    expect(detectCopilotInstall('C:\\Program Files\\nodejs\\node.exe', [script], script, 'win32')).toMatchObject({
      method: 'npm',
      run: { file: 'npm', args: ['install', '-g', '--prefix', 'C:\\Users\\me\\AppData\\Roaming\\npm', '@github/copilot@latest'] },
    });
    expect(detectCopilotInstall('C:\\x\\copilot.exe', [], 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Packages\\GitHub.Copilot_x\\copilot.exe', 'win32')).toMatchObject({ method: 'winget', run: null, command: 'winget upgrade GitHub.Copilot' });
  });
});

describe('parseCopilotVersionOutput', () => {
  it('reads the version that runs, and the newer one its channel has', () => {
    const output = "GitHub Copilot CLI 1.0.90-0\n\nUpdate available: 1.0.106-2\nRun 'copilot update' to update, or download from: https://github.com/github/copilot-cli/releases/tag/v1.0.106-2\n";
    expect(parseCopilotVersionOutput(output)).toEqual({ installed: '1.0.90-0', available: '1.0.106-2' });
    expect(parseCopilotVersionOutput('GitHub Copilot CLI 1.0.105.\n')).toEqual({ installed: '1.0.105', available: null });
    expect(parseCopilotVersionOutput('')).toEqual({ installed: null, available: null });
  });

  it("knows when Copilot's own updates are off", () => {
    expect(copilotUpdatesOff({ COPILOT_AUTO_UPDATE: 'false' })).toBe(true);
    expect(copilotUpdatesOff({ CI: 'true' })).toBe(true);
    expect(copilotUpdatesOff({ COPILOT_AUTO_UPDATE: 'true' })).toBe(false);
    expect(copilotUpdatesOff({})).toBe(false);
  });
});

describe('copilotUpdater', () => {
  /** A Copilot CLI at `version` whose `copilot version` offers `available`, and whose update installs it. */
  function setup(installed: string, available: string | null, extra: Partial<CopilotUpdaterOptions> = {}) {
    let version = installed;
    const states: ProviderUpdateState[] = [];
    const ran: string[] = [];
    const updater = copilotUpdater({
      store: appStateFake(),
      binary: async () => ({ path: '/Users/me/.local/bin/copilot', version }),
      env: async () => ({ PATH: '/usr/bin' }),
      ready: Promise.resolve(),
      onChange: (state) => states.push(state),
      log: () => {},
      version: async () => `GitHub Copilot CLI ${version}\n${available && available !== version ? `\nUpdate available: ${available}\n` : ''}`,
      run: async (file, args, _env, onOutput) => {
        ran.push([file, ...args].join(' '));
        onOutput(`Downloading ${available}\r\nDone\n`);
        version = available ?? version;
        return { exitCode: 0 };
      },
      ...extra,
    });
    return { updater, states, ran };
  }

  it('finds a newer version with copilot version, and updates with copilot update', async () => {
    const { updater, states, ran } = setup('1.0.90-0', '1.0.106-2');
    await updater.check();
    expect(updater.state).toMatchObject({ provider: 'copilot', name: 'GitHub Copilot CLI', status: 'available', method: 'native', command: 'copilot update', canUpdate: true, installedVersion: '1.0.90-0', latestVersion: '1.0.106-2', channel: null });
    expect(states[0]!.status).toBe('checking');

    await updater.update();
    expect(ran).toEqual(['/Users/me/.local/bin/copilot update']);
    expect(updater.state).toMatchObject({ status: 'updated', installedVersion: '1.0.106-2', updatedTo: '1.0.106-2', output: 'Downloading 1.0.106-2\nDone\n' });
  });

  it('is up to date when Copilot offers nothing newer, and keeps the dismissed version', async () => {
    const { updater } = setup('1.0.105', null);
    await updater.check();
    expect(updater.state).toMatchObject({ status: 'up-to-date', latestVersion: '1.0.105' });

    const offered = setup('1.0.90', '1.0.105');
    await offered.updater.check();
    offered.updater.dismiss();
    expect(offered.updater.state.dismissedVersion).toBe('1.0.105');
  });

  it('says when Copilot CLI is missing, or the check fails, and never updates in a smoke run', async () => {
    const missing = setup('1.0.90', '1.0.105', { binary: async () => null });
    await missing.updater.check();
    expect(missing.updater.state.status).toBe('missing');

    const offline = setup('1.0.90', null, { version: async () => Promise.reject(new Error('getaddrinfo ENOTFOUND')) });
    await offline.updater.check();
    expect(offline.updater.state).toMatchObject({ status: 'error', installedVersion: '1.0.90' });
    expect(offline.updater.state.error).toBe('Couldn’t check for GitHub Copilot CLI updates: getaddrinfo ENOTFOUND');

    const smoke = setup('1.0.90', '1.0.105', { allowUpdate: false });
    await smoke.updater.check();
    expect(() => smoke.updater.update()).toThrow(/turned off/);
  });
});
