import { describe, expect, it } from 'vitest';
import { autoUpdaterDisabled, claudeChannel, compareVersions, detectInstall, versionFromDistTags } from './claudeInstall.ts';
import { parseClaudeVersion } from './claudeBinary.ts';

const home = '/Users/me';
const detect = (path: string, realPath = path, channel: 'latest' | 'stable' = 'latest') => detectInstall(path, realPath, { home, channel, platform: 'darwin' });

describe('detectInstall', () => {
  it('native installer: ~/.local/bin/claude linked into ~/.local/share/claude/versions', () => {
    const info = detect('/Users/me/.local/bin/claude', '/Users/me/.local/share/claude/versions/2.1.291');
    expect(info).toEqual({ method: 'native', cask: null, command: 'claude update', run: { file: '/Users/me/.local/bin/claude', args: ['update'] } });
  });

  it('Homebrew casks, stable and @latest, with the brew next to the Caskroom', () => {
    const stable = detect('/opt/homebrew/bin/claude', '/opt/homebrew/Caskroom/claude-code/2.1.285/claude');
    expect(stable).toMatchObject({ method: 'homebrew', cask: 'claude-code', command: 'brew upgrade --cask claude-code', run: { file: '/opt/homebrew/bin/brew', args: ['upgrade', '--cask', 'claude-code'] } });
    const latest = detect('/usr/local/bin/claude', '/usr/local/Caskroom/claude-code@latest/2.1.291/claude');
    expect(latest).toMatchObject({ method: 'homebrew', cask: 'claude-code@latest', command: 'brew upgrade --cask claude-code@latest', run: { file: '/usr/local/bin/brew' } });
  });

  it('npm global installs use the npm of the same Node, on the chosen channel', () => {
    const nvm = detect('/Users/me/.nvm/versions/node/v24.1.0/bin/claude', '/Users/me/.nvm/versions/node/v24.1.0/lib/node_modules/@anthropic-ai/claude-code/cli.js', 'stable');
    expect(nvm).toEqual({
      method: 'npm',
      cask: null,
      command: 'npm install -g @anthropic-ai/claude-code@stable',
      run: { file: '/Users/me/.nvm/versions/node/v24.1.0/bin/npm', args: ['install', '-g', '@anthropic-ai/claude-code@stable'] },
    });
    // Some other node_modules layout: npm from PATH.
    expect(detect('/opt/x/claude', '/opt/x/node_modules/@anthropic-ai/claude-code/cli.js').run?.file).toBe('npm');
  });

  it('the old local install in ~/.claude/local, even though it is an npm package inside', () => {
    expect(detect('/Users/me/.claude/local/claude')).toMatchObject({ method: 'local', command: 'claude update', run: { file: '/Users/me/.claude/local/claude', args: ['update'] } });
    expect(detect('/Users/me/.claude/local/claude', '/Users/me/.claude/local/node_modules/@anthropic-ai/claude-code/cli.js').method).toBe('local');
  });

  it('Windows: the native installer copies claude.exe into ~\\.local\\bin', () => {
    const home = 'C:\\Users\\me';
    const win = (path: string, realPath = path) => detectInstall(path, realPath, { home, channel: 'latest', platform: 'win32' });
    expect(win('C:\\Users\\me\\.local\\bin\\claude.exe')).toEqual({ method: 'native', cask: null, command: 'claude update', run: { file: 'C:\\Users\\me\\.local\\bin\\claude.exe', args: ['update'] } });
    // The drive letter and folder names may come back in another case.
    expect(win('c:\\users\\me\\.local\\bin\\claude.exe').method).toBe('native');
    expect(win('C:\\Users\\me\\.local\\bin\\claude.exe', 'C:\\Users\\me\\.local\\share\\claude\\versions\\2.1.291').method).toBe('native');
    expect(win('C:\\tools\\claude.exe')).toEqual({ method: 'unknown', cask: null, command: 'claude update', run: null });
  });

  it("Windows: npm's package updates in its own prefix, and WinGet's only shows its command", () => {
    const win = (path: string, channel: 'latest' | 'stable' = 'latest') => detectInstall(path, path, { home: 'C:\\Users\\me', channel, platform: 'win32' });
    // The prefix is named: the npm first on PATH (nvm-windows', say) would otherwise install into its own.
    expect(win('C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe', 'stable')).toEqual({
      method: 'npm',
      cask: null,
      command: 'npm install -g --prefix "C:\\Users\\me\\AppData\\Roaming\\npm" @anthropic-ai/claude-code@stable',
      run: { file: 'npm', args: ['install', '-g', '--prefix', 'C:\\Users\\me\\AppData\\Roaming\\npm', '@anthropic-ai/claude-code@stable'] },
      failureHint: expect.stringContaining('stop your sessions'),
    });
    const winget = { method: 'winget', cask: null, command: 'winget upgrade Anthropic.ClaudeCode', run: null };
    expect(win('C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe\\claude.exe')).toEqual(winget);
    // Installed for every user (`winget install --scope machine`).
    expect(win('C:\\Program Files\\WinGet\\Packages\\Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe\\claude.exe')).toEqual(winget);
  });

  it('anything else can only be shown, not run', () => {
    expect(detect('/opt/tools/claude')).toEqual({ method: 'unknown', cask: null, command: 'claude update', run: null });
    // A folder that merely starts with the same name isn't the native install.
    expect(detect('/Users/me/.local/share/claude-other/claude').method).toBe('unknown');
  });
});

describe('claudeChannel', () => {
  it('follows the Homebrew cask, else autoUpdatesChannel, else latest', () => {
    expect(claudeChannel({ autoUpdatesChannel: 'latest' }, 'claude-code')).toBe('stable');
    expect(claudeChannel({ autoUpdatesChannel: 'stable' }, 'claude-code@latest')).toBe('latest');
    expect(claudeChannel({ autoUpdatesChannel: 'stable' }, null)).toBe('stable');
    expect(claudeChannel({ autoUpdatesChannel: 'nonsense' }, null)).toBe('latest');
    expect(claudeChannel(null, null)).toBe('latest');
  });
});

describe('autoUpdaterDisabled', () => {
  it('reads the environment and the env and autoUpdates of Claude settings', () => {
    expect(autoUpdaterDisabled({}, null)).toBe(false);
    expect(autoUpdaterDisabled({ DISABLE_AUTOUPDATER: '1' }, null)).toBe(true);
    expect(autoUpdaterDisabled({ DISABLE_AUTOUPDATER: '0' }, null)).toBe(false);
    expect(autoUpdaterDisabled({ DISABLE_AUTOUPDATER: 'false' }, null)).toBe(false);
    expect(autoUpdaterDisabled({}, { env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } })).toBe(true);
    expect(autoUpdaterDisabled({}, { autoUpdates: false })).toBe(true);
  });
});

describe('versions', () => {
  it('compares X.Y.Z numerically, releases after their pre-releases', () => {
    expect(compareVersions('2.1.10', '2.1.9')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '10.0.0')).toBeLessThan(0);
    expect(compareVersions('2.1.0', '2.1.0')).toBe(0);
    expect(compareVersions('2.1.0', '2.1.0-beta.1')).toBeGreaterThan(0);
    expect(compareVersions('v2.1.0', '2.1.0')).toBe(0);
    expect(compareVersions('garbage', '2.1.0')).toBe(0);
  });

  it('compares what parseClaudeVersion reads from `claude --version`', () => {
    const installed = parseClaudeVersion('2.1.285 (Claude Code)\n')!;
    expect(compareVersions('2.1.291', installed)).toBeGreaterThan(0);
  });

  it('reads a channel from the dist-tags', () => {
    const tags = { stable: '2.1.285', latest: '2.1.291', next: '2.1.292' };
    expect(versionFromDistTags(tags, 'latest')).toBe('2.1.291');
    expect(versionFromDistTags(tags, 'stable')).toBe('2.1.285');
    expect(versionFromDistTags({ latest: '2.1.291' }, 'stable')).toBe('2.1.291');
    expect(versionFromDistTags({ latest: 'oops' }, 'latest')).toBeNull();
    expect(versionFromDistTags(null, 'latest')).toBeNull();
  });
});
