import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeDir } from '../util/removeDir.ts';
import { cmdArgument, needsCmd, viaCmd } from './windowsCommand.ts';

const dirs: string[] = [];
afterEach(() => Promise.all(dirs.splice(0).map((d) => removeDir(d))));

describe('running a .cmd on Windows', () => {
  it('quotes and escapes each argument for cmd.exe', () => {
    expect(cmdArgument('a b', false)).toBe('^"a^ b^"');
    expect(cmdArgument('x & y', true)).toBe('^^^"x^^^ ^^^&^^^ y^^^"');
    expect(cmdArgument('C:\\dir\\', false)).toBe('^"C:\\dir\\\\^"');
    expect(needsCmd('C:\\x\\code.cmd')).toBe(true);
    expect(needsCmd('C:\\x\\Code.exe')).toBe(false);
  });

  // A .cmd that hands its arguments to a program, as VS Code's code.cmd does: they must arrive as they were.
  it.skipIf(process.platform !== 'win32')('passes every argument through a .cmd unchanged, and runs nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'seshboard-cmd-'));
    dirs.push(dir);
    const folder = join(dir, 'with space (1)');
    mkdirSync(folder);
    const shim = join(folder, 'echo-args.cmd');
    writeFileSync(shim, `@"${process.execPath}" -e "process.stdout.write(JSON.stringify(process.argv.slice(1)))" %*\r\n`);
    const marker = join(dir, 'pwned.txt');
    const args = [
      join(dir, 'a b', 'file (1).ts'),
      `x & echo pwned > "${marker}"`,
      '100%PATH%',
      'a^b',
      'he said "hi"',
      'C:\\trailing\\',
      '!bang!',
      'semi;colon,comma',
      '<in>|out',
    ];
    const { command, args: cmdArgs } = viaCmd(shim, args, process.env);
    const out = spawnSync(command, cmdArgs, { windowsVerbatimArguments: true, encoding: 'utf8' }).stdout;
    expect(JSON.parse(out)).toEqual(args);
    // With delayed expansion on, as the registry can set it for every cmd.exe (here by `/v:on` first): still unchanged.
    const delayed = spawnSync(command, ['/v:on', ...cmdArgs], { windowsVerbatimArguments: true, encoding: 'utf8' }).stdout;
    expect(JSON.parse(delayed)).toEqual(args);
    expect(() => execFileSync('cmd.exe', ['/d', '/c', `if exist "${marker}" exit 1`])).not.toThrow();
  });
});
