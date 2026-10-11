import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { posixQuote, powershellQuote, pwshVersion, userShell, windowsPowershellQuote, windowsUnsafe } from './shell.ts';

/**
 * Time for the tests that start real shells, each several times: Windows PowerShell 5.1 takes a second or more to
 * start on CI runners, beyond Vitest's 5 seconds for a test.
 */
const REAL_SHELLS_MS = 60_000;

/** The command `run` encodes (after `-NoLogo -ExecutionPolicy Bypass -EncodedCommand`). */
const decode = (args: string[]) => Buffer.from(args[4]!, 'base64').toString('utf16le');

describe('userShell', () => {
  it('is $SHELL as a login shell on macOS and Linux', () => {
    const shell = userShell({ SHELL: '/bin/bash' }, 'darwin');
    expect(shell).toMatchObject({ file: '/bin/bash', kind: 'posix', interactive: ['-l'] });
    expect(shell.run('npm test')).toEqual(['-ilc', 'npm test']);
    expect(shell.unsafe('a & b "c"')).toBeNull();
    expect(userShell({}, 'linux').file).toBe('/bin/zsh');
  });

  it('is PowerShell 7 on Windows when it is on PATH, else Windows PowerShell', () => {
    const env = { PATH: 'C:\\Windows\\System32;C:\\Program Files\\PowerShell\\7', SystemRoot: 'C:\\Windows' };
    const found = (p: string) => p === 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
    const deps = (version: string) => (p: string) => (p === 'C:\\Program Files\\PowerShell\\7\\pwsh.deps.json' ? `{ "targets": { "x": { "pwsh/${version}": {} } } }` : null);
    const pwsh = userShell(env, 'win32', found, deps('7.4.6'));
    expect(pwsh).toMatchObject({ file: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', kind: 'powershell', interactive: ['-NoLogo', '-ExecutionPolicy', 'Bypass'] });
    expect(pwsh.quote).toBe(powershellQuote);
    // 7.0 to 7.2 hand double quotes to programs as Windows PowerShell does; an unknown version is taken as current.
    expect(userShell(env, 'win32', found, deps('7.2.24')).quote).toBe(windowsPowershellQuote);
    expect(userShell(env, 'win32', found, deps('7.3.0')).quote).toBe(powershellQuote);
    expect(userShell(env, 'win32', found, () => null).quote).toBe(powershellQuote);
    const windowsPowershell = userShell(env, 'win32', () => false);
    expect(windowsPowershell.file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(windowsPowershell.quote).toBe(windowsPowershellQuote);
  });

  it("reads PowerShell 7's version from pwsh.deps.json", () => {
    expect(pwshVersion('{ "targets": { ".NETCoreApp,Version=v9.0/win-x64": { "pwsh/7.6.6.500": {} } } }')).toEqual([7, 6]);
    expect(pwshVersion('{ "pwsh/7.10.1": {} }')).toEqual([7, 10]);
    expect(pwshVersion('{}')).toBeNull();
    expect(pwshVersion(null)).toBeNull();
  });

  it('hands PowerShell the command encoded, so nothing in between can change it', () => {
    const args = userShell({ PATH: '' }, 'win32', () => false).run('echo "a b" && git log -1');
    expect(args.slice(0, 4)).toEqual(['-NoLogo', '-ExecutionPolicy', 'Bypass', '-EncodedCommand']);
    expect(decode(args).startsWith('echo "a b" && git log -1\n')).toBe(true);
  });
});

describe('quoting', () => {
  const nasty = ["it's", "feat/x'; rm -rf ~ #",'a "b" $(rm -rf ~) `x` $HOME', 'semi; colon & and | pipe', 'smart ’quote‘ here', ''];

  it('quotes for POSIX shells and PowerShell', () => {
    expect(posixQuote("it's")).toBe(`'it'\\''s'`);
    expect(powershellQuote("it's")).toBe(`'it''s'`);
    expect(powershellQuote('a’b')).toBe(`'a’’b'`);
    // Windows PowerShell passes `"` to programs unescaped: it is escaped for them, and so is a final `\` in a value
    // with spaces (PowerShell quotes that one, and the `\` would escape the closing quote).
    expect(windowsPowershellQuote('a "b"')).toBe(`'a \\"b\\"'`);
    expect(windowsPowershellQuote('C:\\dir with space\\')).toBe(`'C:\\dir with space\\\\'`);
    expect(windowsPowershellQuote('C:\\nospace\\')).toBe(`'C:\\nospace\\'`);
  });

  it('knows what an action may not pass on Windows', () => {
    for (const value of ['x&y', 'a|b', 'a<b', 'a>b', 'a^b', '%PATH%', '!x!', 'a"b', 'a\nb', 'a\rb', 'a\0b']) expect(windowsUnsafe(value)).not.toBeNull();
    for (const value of ['feat/x', "it's", 'C:\\Users\\me\\dev', 'Fix login (again)', 'a;b', '$HOME']) expect(windowsUnsafe(value)).toBeNull();
  });

  it.skipIf(process.platform === 'win32')('passes every value to /bin/sh as it is', () => {
    for (const value of nasty) expect(execFileSync('/bin/sh', ['-c', `printf %s ${posixQuote(value)}`]).toString()).toBe(value);
  }, REAL_SHELLS_MS);

  it.skipIf(process.platform !== 'win32')('passes every value to PowerShell as it is', () => {
    const shell = userShell(process.env as Record<string, string>);
    for (const value of nasty) {
      // UTF-8 out, or the console code page turns ’ into ' on the way back.
      const command = `[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::Out.Write(${powershellQuote(value)})`;
      const out = execFileSync(shell.file, ['-NoProfile', ...shell.run(command).slice(1)], { encoding: 'utf8' });
      expect(out).toBe(value);
    }
  }, REAL_SHELLS_MS);

  // Commit messages and branch names go to git.exe and gh.exe, through each PowerShell's own way of passing them.
  const shells = process.platform === 'win32' ? windowsShells() : [];
  it.skipIf(shells.length === 0)('passes values to a program as one argument each, in both PowerShells', () => {
    const values = ['a b"c --amend "', 'say "hi"', 'C:\\dir with space\\', 'back\\"slash', 'x&y', "it's", 'plain'];
    const script = 'console.log(JSON.stringify(process.argv.slice(1)))';
    for (const shell of shells) {
      const command = `node -e ${powershellQuote(script)} -- ${values.map(shell.quote).join(' ')}`;
      const out = execFileSync(shell.file, ['-NoProfile', ...shell.run(command).slice(1)], { encoding: 'utf8' });
      expect({ shell: shell.file, argv: JSON.parse(out.trim()) }).toEqual({ shell: shell.file, argv: values });
    }
  }, REAL_SHELLS_MS);

  it.skipIf(shells.length === 0)("reports a program's own exit code, as a POSIX shell does", () => {
    for (const shell of shells) {
      const exit = (command: string) => spawnSync(shell.file, ['-NoProfile', ...shell.run(command).slice(1)]).status;
      expect(exit('node -e "process.exit(5)"')).toBe(5);
      expect(exit('Get-Item C:\\no\\such\\thing -ErrorAction Stop')).toBe(1);
      expect(exit('node -e "process.exit(5)"; Write-Output fine')).toBe(0);
      expect(exit('Write-Output fine')).toBe(0);
    }
  }, REAL_SHELLS_MS);
});

/** Windows PowerShell, and PowerShell 7 when it is installed, each with its own quoting. */
function windowsShells() {
  const env = process.env as Record<string, string>;
  const windowsPowershell = userShell(env, 'win32', () => false);
  const current = userShell(env, 'win32');
  return [windowsPowershell, ...(current.file === windowsPowershell.file ? [] : [current])].filter((shell) => existsSync(shell.file));
}
