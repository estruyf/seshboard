import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClaudeUpdateState } from '@switchboard/protocol';
import { findClaude } from './claudeBinary.ts';
import { ClaudeUpdater, cleanOutput, type ClaudeUpdaterOptions } from './claudeUpdater.ts';
import { appStateFake } from './testing.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const registry = (tags: Record<string, string>) => `data:application/json,${encodeURIComponent(JSON.stringify(tags))}`;

/**
 * A fake native install: ~/.local/bin/claude links to a script in ~/.local/share/claude/versions that prints the
 * version in a file next to it, and whose `update` writes `updateTo` there (or fails with `exit`).
 */
function fakeNativeInstall(version: string, update: { to?: string; exit?: number } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'switchboard-claude-update-'));
  dirs.push(home);
  const versions = join(home, '.local', 'share', 'claude', 'versions');
  mkdirSync(versions, { recursive: true });
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  mkdirSync(join(home, '.claude'));
  const versionFile = join(versions, 'version.txt');
  writeFileSync(versionFile, version);
  const script = join(versions, 'claude');
  writeFileSync(
    script,
    [
      '#!/bin/sh',
      'if [ "$1" = "update" ]; then',
      '  printf "\\033[1mChecking for updates\\033[0m\\r\\n"',
      update.to ? `  printf '${update.to}' > '${versionFile}'; echo "Updated to ${update.to}"` : '  echo "Nothing to do"',
      `  exit ${update.exit ?? 0}`,
      'fi',
      `echo "$(cat '${versionFile}') (Claude Code)"`,
    ].join('\n'),
  );
  chmodSync(script, 0o755);
  const bin = join(home, '.local', 'bin', 'claude');
  symlinkSync(script, bin);
  return { home, bin, configDir: join(home, '.claude') };
}

function updater(install: ReturnType<typeof fakeNativeInstall>, extra: Partial<ClaudeUpdaterOptions> = {}) {
  const states: ClaudeUpdateState[] = [];
  const store = appStateFake();
  const instance = new ClaudeUpdater({
    store,
    findClaude: () => findClaude({ PATH: `${join(install.home, '.local', 'bin')}:/usr/bin:/bin` }),
    override: false,
    claudeConfigDir: install.configDir,
    env: async () => ({ PATH: process.env.PATH ?? '/usr/bin:/bin' }),
    ready: Promise.resolve(),
    onChange: (state) => states.push(state),
    log: () => {},
    home: install.home,
    registryUrl: registry({ latest: '2.2.0', stable: '2.1.5' }),
    ...extra,
  });
  return { instance, states, store };
}

// The fake install is a shell script behind a symlink, which Windows can't run. Updating on Windows has its own
// tests with the work in docs/windows-support.md (2.7).
describe.skipIf(process.platform === 'win32')('ClaudeUpdater', () => {
  it('finds a newer version, updates with the native installer, and reads the new version', async () => {
    const install = fakeNativeInstall('2.1.0', { to: '2.2.0' });
    const { instance, states } = updater(install);
    await instance.check();
    expect(instance.state).toMatchObject({ status: 'available', method: 'native', command: 'claude update', canUpdate: true, installedVersion: '2.1.0', latestVersion: '2.2.0', channel: 'latest' });
    expect(states[0]!.status).toBe('checking');

    await instance.update();
    expect(instance.state).toMatchObject({ status: 'updated', installedVersion: '2.2.0', updatedTo: '2.2.0' });
    expect(instance.state.output).toBe('Checking for updates\nUpdated to 2.2.0\n');
    expect(states.some((s) => s.status === 'updating')).toBe(true);
  });

  it('follows autoUpdatesChannel from Claude settings', async () => {
    const install = fakeNativeInstall('2.1.5');
    writeFileSync(join(install.configDir, 'settings.json'), JSON.stringify({ autoUpdatesChannel: 'stable' }));
    const { instance } = updater(install);
    await instance.check();
    expect(instance.state).toMatchObject({ status: 'up-to-date', channel: 'stable', latestVersion: '2.1.5' });
  });

  it('a failing command is an error with its output, and only one update runs at a time', async () => {
    const install = fakeNativeInstall('2.1.0', { exit: 3 });
    const { instance } = updater(install);
    await instance.check();
    const running = instance.update();
    expect(() => instance.update()).toThrow(/already/);
    await running;
    expect(instance.state).toMatchObject({ status: 'error', error: 'The update command exited with code 3.', installedVersion: '2.1.0' });
    expect(instance.state.output).toContain('Nothing to do');
  });

  it('a registry failure is a check error that keeps the install', async () => {
    const { instance } = updater(fakeNativeInstall('2.1.0'), { registryUrl: registry({ next: '3.0.0' }) });
    await instance.check();
    expect(instance.state).toMatchObject({ status: 'error', installedVersion: '2.1.0' });
    expect(instance.state.error).toContain('no latest version');
  });

  it('never runs a command for a custom path, or when updating is turned off', async () => {
    const install = fakeNativeInstall('2.1.0', { to: '2.2.0' });
    const custom = updater(install, { override: true });
    await custom.instance.check();
    expect(custom.instance.state).toMatchObject({ status: 'available', canUpdate: false, command: 'claude update' });
    expect(() => custom.instance.update()).toThrow(/custom path/);

    const smoke = updater(install, { allowUpdate: false });
    await smoke.instance.check();
    expect(() => smoke.instance.update()).toThrow(/turned off/);
    expect(smoke.instance.state.installedVersion).toBe('2.1.0');
  });

  it('remembers dismissing and turning the check off', async () => {
    const install = fakeNativeInstall('2.1.0');
    const { instance, store } = updater(install);
    await instance.check();
    instance.dismiss();
    instance.setEnabled(false);
    expect(store.dump()).toEqual({ 'claudeUpdate.dismissed': '2.2.0', 'claudeUpdate.enabled': false });
    const again = updater(install, { store });
    expect(again.instance.state).toMatchObject({ status: 'off', enabled: false, dismissedVersion: '2.2.0' });
  });

  it('no claude: missing', async () => {
    const install = fakeNativeInstall('2.1.0');
    const { instance } = updater(install, { findClaude: async () => null });
    await instance.check();
    expect(instance.state.status).toBe('missing');
  });
});

describe.skipIf(process.platform !== 'win32')('ClaudeUpdater on Windows', () => {
  it('updates an npm install through the npm.cmd on PATH, run by cmd.exe, and reads the new version', async () => {
    const home = mkdtempSync(join(tmpdir(), 'switchboard-claude-update-win-'));
    dirs.push(home);
    // npm's package (its claude.exe needn't run here: findClaude reads the version from a file instead).
    const exe = join(home, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    mkdirSync(join(exe, '..'), { recursive: true });
    writeFileSync(exe, '');
    const versionFile = join(home, 'version.txt');
    writeFileSync(versionFile, '2.1.0');
    // A stand-in npm.cmd in a folder with a space, as Node's is under Program Files.
    const nodeDir = join(home, 'node js');
    mkdirSync(nodeDir);
    writeFileSync(join(nodeDir, 'npm.cmd'), `@echo npm %*\r\n@echo 2.2.0> "${versionFile}"\r\n`);
    mkdirSync(join(home, '.claude'));
    const { instance } = updater(
      { home, bin: exe, configDir: join(home, '.claude') },
      {
        findClaude: async () => ({ path: exe, version: readFileSync(versionFile, 'utf8').trim() }),
        env: async () => ({ PATH: nodeDir, PATHEXT: '.EXE;.CMD', ComSpec: process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe', SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' }),
      },
    );
    await instance.check();
    // In the package's own prefix, whichever npm is first on PATH.
    const prefix = join(home, 'npm');
    expect(instance.state).toMatchObject({ status: 'available', method: 'npm', command: `npm install -g --prefix "${prefix}" @anthropic-ai/claude-code@latest`, installedVersion: '2.1.0' });
    await instance.update();
    expect(instance.state).toMatchObject({ status: 'updated', installedVersion: '2.2.0' });
    // The stand-in echoes its arguments as cmd.exe hands them over, quoted.
    expect(instance.state.output.startsWith(`npm "install" "-g" "--prefix" "${prefix}" "@anthropic-ai/claude-code@latest"`)).toBe(true);
  });

  it('says to stop the sessions when an npm update fails, as Windows keeps a running claude.exe', async () => {
    const home = mkdtempSync(join(tmpdir(), 'switchboard-claude-update-win-'));
    dirs.push(home);
    const exe = join(home, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    mkdirSync(join(exe, '..'), { recursive: true });
    writeFileSync(exe, '');
    mkdirSync(join(home, '.claude'));
    const { instance } = updater(
      { home, bin: exe, configDir: join(home, '.claude') },
      // npm's EBUSY, as when a session runs claude.exe.
      { findClaude: async () => ({ path: exe, version: '2.1.0' }), run: async () => ({ exitCode: 4294963214 }) },
    );
    await instance.check();
    await instance.update();
    expect(instance.state).toMatchObject({ status: 'error', installedVersion: '2.1.0' });
    expect(instance.state.error).toMatch(/^The update command exited with code 4294963214\. .*stop your sessions/);
  });
});

describe('cleanOutput', () => {
  it('drops colours and splits carriage-return progress into lines', () => {
    expect(cleanOutput('\x1b[32m✔\x1b[0m done\r\n10%\r20%')).toBe('✔ done\n10%\n20%');
  });
});
