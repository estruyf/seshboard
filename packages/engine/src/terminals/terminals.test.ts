import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TerminalInfo } from '@switchboard/protocol';
import { userShell } from '../system/shell.ts';
import { withUpperCasePath } from '../system/shellEnv.ts';
import { removeDir } from '../util/removeDir.ts';
import { REPLAY_LIMIT, TerminalManager, type Pty, type SpawnPty } from './terminalManager.ts';

const dirs: string[] = [];
const managers: TerminalManager[] = [];
afterEach(async () => {
  managers.splice(0).forEach((m) => m.closeAll());
  await Promise.all(dirs.splice(0).map((d) => removeDir(d)));
});
const tempDir = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-term-')));
  dirs.push(dir);
  return dir;
};
const until = async (check: () => boolean, timeoutMs = 5000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

function setup(spawn?: SpawnPty, env: Record<string, string> = { PATH: process.env.PATH ?? '', SHELL: '/bin/sh' }) {
  const output = new Map<string, string>();
  const changes: TerminalInfo[][] = [];
  const manager = new TerminalManager({
    ...(spawn ? { spawn: async () => spawn } : {}),
    env: async () => env,
    claudePath: async () => '/usr/local/bin/claude',
    onData: (id, data) => output.set(id, (output.get(id) ?? '') + data),
    onChange: (list) => changes.push(list),
    log: () => {},
  });
  managers.push(manager);
  return { manager, output, changes };
}

// The same steps in the shell each platform runs: /bin/sh, or PowerShell on Windows (which reads Enter as \r).
const windows = process.platform === 'win32';
const real = windows
  ? { env: withUpperCasePath(process.env as Record<string, string>), input: 'pwd; echo "TERM=$env:TERM"\r', exit: 'exit 7\r', long: 'echo started; Start-Sleep 30', silent: '$null = 1' }
  : { env: { PATH: process.env.PATH ?? '', SHELL: '/bin/sh' }, input: 'pwd; echo "TERM=$TERM"\n', exit: 'exit 7\n', long: 'echo started; sleep 30', silent: 'true' };
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('TerminalManager with a real pty', () => {
  it('runs a login shell in the folder, streams output, takes input and reports the exit', async () => {
    const cwd = tempDir();
    const { manager, output, changes } = setup(undefined, real.env);
    // Wide, so ConPTY doesn't wrap the folder's path.
    const info = await manager.open({ sessionId: 's1', cwd, kind: 'shell', cols: 200, rows: 24, fork: false });
    expect(info).toMatchObject({ sessionId: 's1', kind: 'shell', cwd, exitCode: null });
    manager.write(info.id, real.input);
    // Exit only once the output is in: ConPTY drops what a process prints right before it exits.
    await until(() => (output.get(info.id) ?? '').includes('TERM=xterm-256color'));
    manager.write(info.id, real.exit);
    await until(() => manager.list()[0]?.exitCode !== null);
    const text = output.get(info.id) ?? '';
    expect(text).toContain(cwd);
    expect(text).toContain('TERM=xterm-256color');
    expect(manager.list()[0]!.exitCode).toBe(7);
    expect(manager.replay(info.id).replay).toBe(text);
    expect(changes.at(-1)![0]!.exitCode).toBe(7);
    manager.close(info.id);
    expect(manager.list()).toEqual([]);
  });

  it('stops an action with Ctrl+C and restarts it in the same tab', async () => {
    const cwd = tempDir();
    const { manager, output } = setup(undefined, real.env);
    const info = await manager.open({ sessionId: 's1', cwd, kind: 'action', command: real.long, title: 'Dev', cols: 80, rows: 24, fork: false });
    // The command is shown first, so wait for its output, not the echo of it.
    await until(() => (output.get(info.id) ?? '').includes('started\r\n'));
    manager.stop(info.id);
    await until(() => manager.list()[0]?.exitCode !== null, 10_000);
    // Shells report Ctrl+C as 130; on Windows the console's own exit code says it was stopped.
    const stopped = manager.list()[0]!.exitCode!;
    if (windows) expect(stopped).not.toBe(0);
    else expect(stopped).toBe(130);

    const restarted = await manager.restart(info.id, { command: 'echo again' });
    expect(restarted).toMatchObject({ id: info.id, exitCode: null });
    await until(() => manager.list()[0]?.exitCode === 0);
    expect(manager.replay(info.id).replay).toMatch(new RegExp(`\\$ ${escape(real.long)}[\\s\\S]*Exited with code ${stopped}[\\s\\S]*Restarted[\\s\\S]*\\$ echo again[\\s\\S]*again\\r\\n[\\s\\S]*Done`));
  }, 20_000);

  it('shows the command and that it finished when an action prints nothing', async () => {
    const cwd = tempDir();
    const { manager } = setup(undefined, real.env);
    const info = await manager.open({ sessionId: 's1', cwd, kind: 'action', command: real.silent, title: 'Fetch', cols: 80, rows: 24, fork: false });
    expect(await manager.waitForExit(info.id)).toBe(0);
    // The login shell's rc files may print in between.
    expect(manager.replay(info.id).replay).toMatch(new RegExp(`^\\x1b\\[2m\\$ ${escape(real.silent)}\\x1b\\[0m\\r\\n[\\s\\S]*\\x1b\\[2m── Done ──\\x1b\\[0m\\r\\n$`));
  });
});

describe('TerminalManager', () => {
  function fakeSpawn() {
    const calls: Array<{ file: string; args: string[]; env: Record<string, string> }> = [];
    let emit: (data: string) => void = () => {};
    const pty: Pty & { resized: number[][]; killed: boolean } = {
      pid: 4242,
      resized: [],
      killed: false,
      onData: (l) => ((emit = l), { dispose() {} }),
      onExit: () => ({ dispose() {} }),
      write: () => {},
      resize(cols, rows) {
        this.resized.push([cols, rows]);
      },
      kill() {
        this.killed = true;
      },
    };
    const spawn: SpawnPty = (file, args, options) => {
      calls.push({ file, args, env: options.env });
      return pty;
    };
    return { spawn, calls, pty, emit: (d: string) => emit(d) };
  }

  it('runs the Claude Code TUI on the session, or a fork of it', async () => {
    const fake = fakeSpawn();
    const { manager } = setup(fake.spawn);
    await manager.open({ sessionId: 's1', cwd: tempDir(), kind: 'claude', cols: 80, rows: 24, fork: false });
    await manager.open({ sessionId: 's1', cwd: tempDir(), kind: 'claude', cols: 80, rows: 24, fork: true });
    expect(fake.calls.map((c) => [c.file, c.args])).toEqual([
      ['/usr/local/bin/claude', ['--resume', 's1']],
      ['/usr/local/bin/claude', ['--resume', 's1', '--fork-session']],
    ]);
  });

  it('keeps an enclosing Claude Code out of the environment', async () => {
    const fake = fakeSpawn();
    const env = { PATH: '/bin', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_USE_BEDROCK: '1', SHELL: '/bin/zsh' };
    const { manager } = setup(fake.spawn, env);
    await manager.open({ sessionId: null, cwd: tempDir(), kind: 'shell', cols: 80, rows: 24, fork: false });
    expect(fake.calls[0]!.file).toBe(windows ? userShell(env).file : '/bin/zsh');
    expect(fake.calls[0]!.env).toMatchObject({ PATH: '/bin', CLAUDE_CODE_USE_BEDROCK: '1', TERM_PROGRAM: 'Switchboard' });
    expect(fake.calls[0]!.env).not.toHaveProperty('CLAUDECODE');
    expect(fake.calls[0]!.env).not.toHaveProperty('CLAUDE_CODE_ENTRYPOINT');
  });

  it('batches output, caps the replay buffer, skips no-op resizes and kills on close', async () => {
    const fake = fakeSpawn();
    const { manager, output } = setup(fake.spawn);
    const info = await manager.open({ sessionId: null, cwd: tempDir(), kind: 'shell', cols: 80, rows: 24, fork: false });
    for (let i = 0; i < 100; i++) fake.emit('x');
    await until(() => (output.get(info.id) ?? '').length === 100);
    const chunk = 'y'.repeat(100_000);
    for (let i = 0; i < 6; i++) {
      fake.emit(chunk);
      manager.replay(info.id);
    }
    expect(manager.replay(info.id).replay.length).toBeLessThanOrEqual(REPLAY_LIMIT);
    manager.resize(info.id, 80, 24);
    manager.resize(info.id, 120, 40);
    expect(fake.pty.resized).toEqual([[120, 40]]);
    manager.close(info.id);
    expect(fake.pty.killed).toBe(true);
    await expect(manager.open({ sessionId: null, cwd: join(tempDir(), 'missing'), kind: 'shell', cols: 80, rows: 24, fork: false })).rejects.toThrow(/Folder not found/);
  });
});

describe('terminal font detection', async () => {
  const { ghosttyFont, vscodeTerminalFont, windowsTerminalFont } = await import('../system/terminalFont.ts');
  it('reads Ghostty and VS Code settings', () => {
    expect(ghosttyFont('theme = dark\nfont-family = "SauceCodePro Nerd Font Mono"\nfont-size = 13\n')).toBe('SauceCodePro Nerd Font Mono');
    expect(ghosttyFont('font-family = JetBrains Mono\n')).toBe('JetBrains Mono');
    expect(ghosttyFont('font-size = 13\n')).toBeNull();
    expect(vscodeTerminalFont('{\n  // comment\n  "terminal.integrated.fontFamily": "MesloLGS NF",\n}')).toBe('MesloLGS NF');
    expect(vscodeTerminalFont('{ "editor.fontFamily": "X" }')).toBeNull();
  });

  it('reads Windows Terminal settings, the defaults first and the older key too', () => {
    expect(windowsTerminalFont('{ "profiles": { "defaults": { "font": { "size": 11, "face": "CaskaydiaCove NF" } }, "list": [{ "font": { "face": "Other" } }] } }')).toBe('CaskaydiaCove NF');
    expect(windowsTerminalFont('{ "profiles": { "defaults": { "fontFace": "Cascadia Mono" } } }')).toBe('Cascadia Mono');
    expect(windowsTerminalFont('{ "profiles": { "defaults": {} } }')).toBeNull();
  });
});
