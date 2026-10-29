import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commandFolders, folderFromArgv, installShellCommand, readShellCommand, removeShellCommand, shellCommandDir, shellCommandFile, shellCommandPlan, shellCommandScript, windowsPathScript } from './shellCommand.ts';

const posix = process.platform !== 'win32';

describe('shellCommandDir', () => {
  it('puts the commands on the PATH, or in a folder of the app on Windows', () => {
    expect(shellCommandDir('darwin', { home: '/Users/me', userData: '/x' })).toBe('/usr/local/bin');
    expect(shellCommandDir('linux', { home: '/home/me', userData: '/x' })).toBe('/home/me/.local/bin');
    expect(shellCommandDir('win32', { home: 'C:\\Users\\me', userData: 'C:\\Users\\me\\AppData\\Roaming\\Seshboard' })).toBe('C:\\Users\\me\\AppData\\Roaming\\Seshboard\\bin');
    expect(shellCommandFile('win32', 'C:\\bin', 'seshboard')).toBe('C:\\bin\\seshboard.cmd');
    expect(shellCommandFile('darwin', '/usr/local/bin', 'seshboard')).toBe('/usr/local/bin/seshboard');
  });
});

describe('shellCommandScript', () => {
  it('opens the bundle with a link on macOS, quoting its path', () => {
    const script = shellCommandScript('darwin', 'seshboard', "/Applications/Elio's Seshboard.app");
    expect(script).toContain(`exec open -a '/Applications/Elio'\\''s Seshboard.app' "seshboard://new-session?cwd=$cwd"`);
    expect(script).toContain('Usage: seshboard [folder]');
  });

  it('writes the executable under %LOCALAPPDATA% on Windows, and doubles a % elsewhere', () => {
    const env = { LOCALAPPDATA: 'C:\\Users\\Jörg\\AppData\\Local' };
    expect(shellCommandScript('win32', 'switchboard', 'C:\\Users\\Jörg\\AppData\\Local\\Programs\\switchboard\\Seshboard.exe', env)).toContain('start "" "%LOCALAPPDATA%\\Programs\\switchboard\\Seshboard.exe" "%dir%"');
    expect(shellCommandScript('win32', 'switchboard', 'D:\\100% apps\\Seshboard.exe', env)).toContain('start "" "D:\\100%% apps\\Seshboard.exe" "%dir%"');
    expect(shellCommandScript('win32', 'switchboard', 'D:\\Seshboard.exe')).toContain('\r\n');
    // A folder named `R&D` is echoed as text, never run as a command after the `&`.
    expect(shellCommandScript('win32', 'seshboard', 'D:\\Seshboard.exe')).toContain('echo seshboard: "%~1" is not a folder 1>&2');
    expect(shellCommandScript('win32', 'seshboard', 'D:\\Seshboard.exe').split('\r\n').filter((line) => line.includes('%~1') && !line.includes('"%~1"'))).toEqual([]);
  });

  describe.runIf(posix)('run', () => {
    let root: string;
    beforeEach(() => {
      root = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-shell-command-')));
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    /** A fake program that writes its arguments, one per line, to `out`. */
    function recorder(file: string, out: string): string {
      writeFileSync(file, `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > '${out}'\n`, { mode: 0o755 });
      return file;
    }
    function runScript(script: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): { status: number; stderr: string } {
      const file = join(root, 'cmd');
      writeFileSync(file, script, { mode: 0o755 });
      try {
        execFileSync(file, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        return { status: 0, stderr: '' };
      } catch (error) {
        const failed = error as { status: number; stderr: Buffer };
        return { status: failed.status, stderr: String(failed.stderr) };
      }
    }

    it('macOS: sends the folder as a link, every byte encoded', () => {
      const folder = join(root, 'my project & é');
      mkdirSync(folder);
      mkdirSync(join(root, 'bin'));
      const out = join(root, 'open.txt');
      recorder(join(root, 'bin', 'open'), out);
      const result = runScript(shellCommandScript('darwin', 'switchboard', '/Applications/Seshboard.app'), ['.'], folder, { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}` });
      expect(result.status).toBe(0);
      const [flag, app, link] = readFileSync(out, 'utf8').trim().split('\n');
      expect([flag, app]).toEqual(['-a', '/Applications/Seshboard.app']);
      expect(new URL(link!).searchParams.get('cwd')).toBe(folder);
    });

    it('Linux: starts the executable with the folder, on its own', async () => {
      const out = join(root, 'args.txt');
      const exe = recorder(join(root, 'switchboard-bin'), out);
      mkdirSync(join(root, 'project'));
      expect(runScript(shellCommandScript('linux', 'switchboard', exe), ['project'], root).status).toBe(0);
      for (let i = 0; i < 50 && !existsSync(out); i++) await new Promise((r) => setTimeout(r, 50));
      expect(readFileSync(out, 'utf8').trim()).toBe(join(root, 'project'));
    });

    it('refuses something that is not a folder, and more than one argument', () => {
      writeFileSync(join(root, 'file.txt'), '');
      const script = shellCommandScript('linux', 'seshboard', '/bin/false');
      expect(runScript(script, ['file.txt'], root)).toEqual({ status: 1, stderr: 'seshboard: file.txt is not a folder\n' });
      expect(runScript(script, ['a', 'b'], root).status).toBe(2);
    });
  });
});

describe.runIf(posix)('install and remove', () => {
  let dir: string;
  beforeEach(() => {
    dir = join(mkdtempSync(join(tmpdir(), 'seshboard-shell-command-')), 'bin');
  });
  afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true }));

  it('installs every name, tells an older script from the current one, and removes them', async () => {
    const plan = shellCommandPlan('linux', dir, '/opt/Seshboard/seshboard');
    expect((await readShellCommand(plan)).status).toBe('missing');
    await installShellCommand(plan, false);
    expect(await readShellCommand(plan)).toEqual({ status: 'installed', names: ['seshboard', 'sesh', 'switchboard'], dir, taken: [] });
    expect(existsSync(join(dir, 'sesh'))).toBe(true);
    expect(statSync(join(dir, 'seshboard')).mode & 0o777).toBe(0o755);
    // Another copy of the app, somewhere else.
    expect((await readShellCommand(shellCommandPlan('linux', dir, '/home/me/Seshboard.AppImage'))).status).toBe('outdated');
    await removeShellCommand(shellCommandPlan('linux', dir, '/home/me/Seshboard.AppImage'), false);
    expect(existsSync(join(dir, 'switchboard'))).toBe(false);
    expect((await readShellCommand(plan)).status).toBe('missing');
  });

  it('skips a name another program has (the tmux tool sesh) and installs the others', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'sesh'), '#!/bin/sh\necho tmux sessions\n');
    const plan = shellCommandPlan('linux', dir, '/opt/Seshboard/seshboard');
    expect(await readShellCommand(plan)).toEqual({ status: 'missing', names: ['seshboard', 'switchboard'], dir, taken: [join(dir, 'sesh')] });
    await installShellCommand(plan, false);
    expect(await readShellCommand(plan)).toMatchObject({ status: 'installed', names: ['seshboard', 'switchboard'] });
    expect(readFileSync(join(dir, 'sesh'), 'utf8')).toContain('tmux sessions');
    await removeShellCommand(plan, false);
    expect(existsSync(join(dir, 'switchboard'))).toBe(false);
    expect(readFileSync(join(dir, 'sesh'), 'utf8')).toContain('tmux sessions');
  });

  it('skips a name another program has in another folder, like Homebrew’s sesh, but not Seshboard’s own executable', async () => {
    const brew = join(dir, '..', 'homebrew-bin');
    const opt = join(dir, '..', 'opt');
    mkdirSync(brew, { recursive: true });
    mkdirSync(opt, { recursive: true });
    writeFileSync(join(brew, 'sesh'), '#!/bin/sh\necho tmux sessions\n', { mode: 0o755 });
    // A Linux package links /usr/bin/seshboard to the app itself.
    writeFileSync(join(opt, 'seshboard'), 'ELF', { mode: 0o755 });
    symlinkSync(join(opt, 'seshboard'), join(brew, 'seshboard'));
    const plan = shellCommandPlan('linux', dir, join(opt, 'seshboard'), {}, [brew]);
    expect(await readShellCommand(plan)).toMatchObject({ status: 'missing', names: ['seshboard', 'switchboard'], taken: [join(brew, 'sesh')] });
    await installShellCommand(plan, false);
    expect(existsSync(join(dir, 'sesh'))).toBe(false);
    expect(existsSync(join(dir, 'seshboard'))).toBe(true);
  });

  it('keeps managing a command it wrote before another program got the name', async () => {
    const brew = join(dir, '..', 'homebrew-bin');
    await installShellCommand(shellCommandPlan('linux', dir, '/opt/Seshboard/seshboard'), false);
    mkdirSync(brew, { recursive: true });
    writeFileSync(join(brew, 'sesh'), '#!/bin/sh\n', { mode: 0o755 });
    const plan = shellCommandPlan('linux', dir, '/opt/Seshboard/seshboard', {}, [brew]);
    expect(await readShellCommand(plan)).toMatchObject({ status: 'installed', taken: [] });
    await removeShellCommand(plan, false);
    expect(existsSync(join(dir, 'sesh'))).toBe(false);
  });

  it('is taken when another program has every name', async () => {
    mkdirSync(dir, { recursive: true });
    for (const name of ['switchboard', 'seshboard', 'sesh']) writeFileSync(join(dir, name), '#!/bin/sh\n');
    expect((await readShellCommand(shellCommandPlan('linux', dir, '/opt/Seshboard/seshboard'))).status).toBe('taken');
  });

  it('counts the commands as not installed while their folder is off the PATH', async () => {
    const plan = shellCommandPlan('linux', dir, '/opt/Seshboard/seshboard');
    await installShellCommand(plan, false);
    expect((await readShellCommand(plan, async () => false)).status).toBe('outdated');
  });
});

describe('commandFolders', () => {
  it('looks on the PATH and in the usual folders a GUI app on macOS does not get', () => {
    const folders = commandFolders('darwin', '/Users/me', '/usr/bin:/bin:relative');
    expect(folders).toContain('/opt/homebrew/bin');
    expect(folders).toContain('/Users/me/go/bin');
    expect(folders).not.toContain('relative');
    expect(folders.filter((dir) => dir === '/usr/bin')).toHaveLength(1);
    expect(commandFolders('win32', 'C:\\Users\\me', 'C:\\Windows;C:\\tools')).toEqual(['C:\\Windows', 'C:\\tools']);
  });
});

describe('windowsPathScript', () => {
  it('writes the PATH back unexpanded, only when it changes', () => {
    expect(windowsPathScript('read')).not.toContain('SetValue');
    expect(windowsPathScript('add')).toContain('if ($has) { exit 0 }');
    expect(windowsPathScript('remove')).toContain('if (-not $has) { exit 0 }');
    expect(windowsPathScript('add')).toContain("'DoNotExpandEnvironmentNames'");
    expect(windowsPathScript('add')).toContain('[Microsoft.Win32.RegistryValueKind]::ExpandString');
  });
});

describe('folderFromArgv', () => {
  it('resolves the first argument that is not a flag or a link', () => {
    expect(folderFromArgv(['.'], '/Users/me/dev/app', 'darwin')).toBe('/Users/me/dev/app');
    expect(folderFromArgv(['--no-sandbox', '../other'], '/home/me/dev/app', 'linux')).toBe('/home/me/dev/other');
    expect(folderFromArgv(['C:\\dev\\app\\.'], 'C:\\Users\\me', 'win32')).toBe('C:\\dev\\app');
    expect(folderFromArgv(['sub'], 'C:\\dev', 'win32')).toBe('C:\\dev\\sub');
  });

  it('is null without one', () => {
    expect(folderFromArgv([], '/x', 'linux')).toBeNull();
    expect(folderFromArgv(['--updated', 'seshboard://show'], '/x', 'linux')).toBeNull();
  });
});
