import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TerminalInfo } from '@switchboard/protocol';
import { userShell } from '../system/shell.ts';
import { withUpperCasePath } from '../system/shellEnv.ts';
import { removeDir } from '../util/removeDir.ts';
import { READY_MAX_MS, READY_QUIET_MS, REPLAY_LIMIT, TerminalManager, type Pty, type SpawnPty } from './terminalManager.ts';

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
// PowerShell on a busy Windows runner can take longer than 5s just to start.
const until = async (check: () => boolean, timeoutMs = process.platform === 'win32' ? 20_000 : 5000) => {
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

// The same steps in the shell each platform runs: bash (or /bin/sh), or PowerShell on Windows (which reads Enter as \r).
// Not /bin/sh where that is dash (Ubuntu): an interactive dash ignores Ctrl+C and SIGTERM, so Stop could only kill it.
const windows = process.platform === 'win32';
const posixShell = existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
const real = windows
  ? { env: withUpperCasePath(process.env as Record<string, string>), input: 'pwd; echo "TERM=$env:TERM"\r', exit: 'exit 7\r', long: 'echo started; Start-Sleep 30', silent: '$null = 1' }
  : { env: { PATH: process.env.PATH ?? '', SHELL: posixShell }, input: 'pwd; echo "TERM=$TERM"\n', exit: 'exit 7\n', long: 'echo started; sleep 30', silent: 'true' };
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

  it('waits for a new shell to print and go quiet before it counts as ready, a few seconds at most', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const fake = fakeSpawn();
      const { manager } = setup(fake.spawn);
      const watch = (id: string) => {
        const state = { ready: false };
        void manager.whenReady(id).then(() => (state.ready = true));
        return state;
      };
      const open = () => manager.open({ sessionId: 's1', cwd: tempDir(), kind: 'shell', cols: 80, rows: 24, fork: false });

      // A slow rc file: nothing for a while, then a line, more loading, and the prompt.
      const slow = await open();
      const shell = watch(slow.id);
      await vi.advanceTimersByTimeAsync(2000);
      expect(shell.ready).toBe(false);
      fake.emit('Loading plugins…\r\n');
      await vi.advanceTimersByTimeAsync(READY_QUIET_MS - 100);
      fake.emit('~/project % ');
      await vi.advanceTimersByTimeAsync(READY_QUIET_MS - 1);
      expect(shell.ready).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(shell.ready).toBe(true);
      // Once it is up, it is ready right away.
      const again = watch(slow.id);
      await vi.advanceTimersByTimeAsync(0);
      expect(again.ready).toBe(true);

      // A shell that never goes quiet (or never prints) gets the input at the limit anyway.
      const busy = await open();
      const noisy = watch(busy.id);
      for (let t = 0; t < READY_MAX_MS - 100; t += 100) {
        fake.emit('.');
        await vi.advanceTimersByTimeAsync(100);
      }
      expect(noisy.ready).toBe(false);
      await vi.advanceTimersByTimeAsync(100);
      expect(noisy.ready).toBe(true);

      // Closing it ends the wait too.
      const closed = await open();
      const gone = watch(closed.id);
      manager.close(closed.id);
      await vi.advanceTimersByTimeAsync(READY_QUIET_MS);
      expect(gone.ready).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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

  /** A new pty for every spawn, each one able to exit and to fail like a closed pty does. */
  function fakePtys() {
    const ptys: Array<Pty & { killed: boolean; exit(code: number): void; closed: boolean }> = [];
    const spawn: SpawnPty = () => {
      let onExit: (event: { exitCode: number }) => void = () => {};
      const pty = {
        pid: 5000 + ptys.length,
        killed: false,
        closed: false,
        onData: () => ({ dispose() {} }),
        onExit: (l: typeof onExit) => ((onExit = l), { dispose() {} }),
        write() {
          if (pty.closed) throw new Error('write EIO');
        },
        resize() {
          if (pty.closed) throw new Error('ioctl(2) failed, EBADF');
        },
        kill() {
          pty.killed = true;
        },
        exit: (code: number) => onExit({ exitCode: code }),
      };
      ptys.push(pty);
      return pty;
    };
    return { spawn, ptys };
  }

  it('starts one process for two Restarts at once, and kills one that starts after its tab closed', async () => {
    const fake = fakePtys();
    const { manager } = setup(fake.spawn);
    const info = await manager.open({ sessionId: null, cwd: tempDir(), kind: 'action', command: 'echo hi', title: 'Echo', cols: 80, rows: 24, fork: false });
    fake.ptys[0]!.exit(0);
    const [a, b] = await Promise.all([manager.restart(info.id), manager.restart(info.id)]);
    expect(fake.ptys).toHaveLength(2);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ id: info.id, exitCode: null, pid: fake.ptys[1]!.pid });
    // Running again: a later Restart is refused as before.
    await expect(manager.restart(info.id)).rejects.toThrow(/still running/);

    fake.ptys[1]!.exit(0);
    const restarting = manager.restart(info.id);
    manager.close(info.id);
    await expect(restarting).rejects.toThrow(/gone/);
    expect(fake.ptys).toHaveLength(3);
    expect(fake.ptys[2]!.killed).toBe(true);
  });

  it('reports what each run printed when it ends, and whether you stopped it, but not for a closed tab', async () => {
    let emit: (data: string) => void = () => {};
    let exit: (event: { exitCode: number }) => void = () => {};
    const spawn: SpawnPty = () => ({
      pid: 6000,
      onData: (l) => ((emit = l), { dispose() {} }),
      onExit: (l) => ((exit = l), { dispose() {} }),
      write() {},
      resize() {},
      kill() {},
    });
    const exits: Array<{ exitCode: number | null; output: string; stopped: boolean }> = [];
    const manager = new TerminalManager({
      spawn: async () => spawn,
      env: async () => ({ PATH: '', SHELL: '/bin/sh' }),
      claudePath: async () => undefined,
      onData: () => {},
      onChange: () => {},
      onExit: (info, run) => exits.push({ exitCode: info.exitCode, ...run }),
      log: () => {},
    });
    managers.push(manager);
    const info = await manager.open({ sessionId: 's1', cwd: tempDir(), kind: 'action', command: 'npm test', title: 'Test', cols: 80, rows: 24, fork: false });
    emit('1 failed\r\n');
    exit({ exitCode: 1 });
    // The command shown above the output and the line saying it ended aren't part of it.
    expect(exits).toEqual([{ exitCode: 1, output: '1 failed\r\n', stopped: false }]);

    // A second run reports only its own output; Stop is remembered for the run it was pressed in.
    await manager.restart(info.id);
    emit('all passed\r\n');
    manager.stop(info.id);
    exit({ exitCode: 130 });
    expect(exits[1]).toEqual({ exitCode: 130, output: 'all passed\r\n', stopped: true });

    await manager.restart(info.id);
    manager.close(info.id);
    exit({ exitCode: 0 });
    expect(exits).toHaveLength(2);
  });

  it('drops a resize or keystroke for a pty that closed before its exit event', async () => {
    const fake = fakePtys();
    const { manager } = setup(fake.spawn);
    const info = await manager.open({ sessionId: null, cwd: tempDir(), kind: 'shell', cols: 80, rows: 24, fork: false });
    fake.ptys[0]!.closed = true;
    expect(() => manager.resize(info.id, 120, 40)).not.toThrow();
    expect(() => manager.write(info.id, 'ls\n')).not.toThrow();
    expect(manager.list()[0]).toMatchObject({ cols: 80, rows: 24, exitCode: null });
  });
});

describe('terminal font detection', async () => {
  const { ghosttyFonts, vscodeTerminalFonts, windowsTerminalFonts, parseFontFamilies } = await import('../system/terminalFont.ts');

  it('splits a CSS font list into names without quotes, generics or repeats', () => {
    expect(parseFontFamilies("'Cascadia Cove', monospace")).toEqual(['Cascadia Cove']);
    expect(parseFontFamilies('"Fira Code", \'JetBrains Mono\' ,  Menlo, "fira code", sans-serif')).toEqual(['Fira Code', 'JetBrains Mono', 'Menlo']);
    expect(parseFontFamilies('"Name, with comma", Hack')).toEqual(['Name, with comma', 'Hack']);
    expect(parseFontFamilies("Foo's Mono, Bar")).toEqual(["Foo's Mono", 'Bar']);
    expect(parseFontFamilies('monospace')).toEqual([]);
    expect(parseFontFamilies(' , UI-Monospace, ,')).toEqual([]);
  });

  it('reads Ghostty settings: every font-family line, in order, and an empty one starts over', () => {
    expect(ghosttyFonts('theme = dark\nfont-family = "SauceCodePro Nerd Font Mono"\nfont-size = 13\n')).toEqual(['SauceCodePro Nerd Font Mono']);
    expect(ghosttyFonts('font-family = JetBrains Mono\n')).toEqual(['JetBrains Mono']);
    expect(ghosttyFonts('font-family = JetBrains Mono\r\nfont-family-bold = Other\r\nfont-family = "Symbols Nerd Font"\r\nfont-family = jetbrains mono\r\n')).toEqual(['JetBrains Mono', 'Symbols Nerd Font']);
    expect(ghosttyFonts('font-family = Old\nfont-family = ""\nfont-family = New\nfont-family = Newer\n')).toEqual(['New', 'Newer']);
    expect(ghosttyFonts('font-family = Old\nfont-family =\n')).toEqual([]);
    expect(ghosttyFonts('font-size = 13\n')).toEqual([]);
  });

  it('reads the terminal font list from VS Code settings', () => {
    expect(vscodeTerminalFonts('{\n  // comment\n  "terminal.integrated.fontFamily": "MesloLGS NF",\n}')).toEqual(['MesloLGS NF']);
    expect(vscodeTerminalFonts(String.raw`{ "terminal.integrated.fontFamily": "'Cascadia Cove', monospace" }`)).toEqual(['Cascadia Cove']);
    expect(vscodeTerminalFonts(String.raw`{ "terminal.integrated.fontFamily": "\"Fira Code\", \"Hack Nerd Font\", monospace" }`)).toEqual(['Fira Code', 'Hack Nerd Font']);
    expect(vscodeTerminalFonts('{ "terminal.integrated.fontFamily": "monospace" }')).toEqual([]);
    expect(vscodeTerminalFonts('{ "editor.fontFamily": "X" }')).toEqual([]);
  });

  it('reads Windows Terminal settings, the defaults first and the older key too', () => {
    expect(windowsTerminalFonts('{ "profiles": { "defaults": { "font": { "size": 11, "face": "CaskaydiaCove NF" } }, "list": [{ "font": { "face": "Other" } }] } }')).toEqual(['CaskaydiaCove NF']);
    expect(windowsTerminalFonts('{ "profiles": { "defaults": { "font": { "face": "Cascadia Code, Segoe UI Emoji" } } } }')).toEqual(['Cascadia Code', 'Segoe UI Emoji']);
    expect(windowsTerminalFonts('{ "profiles": { "defaults": { "fontFace": "Cascadia Mono" } } }')).toEqual(['Cascadia Mono']);
    expect(windowsTerminalFonts('{ "profiles": { "defaults": {} } }')).toEqual([]);
  });
});
