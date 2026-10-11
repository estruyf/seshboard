import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeCandidates, findClaude, parseClaudeVersion } from './claudeBinary.ts';
import { parseEnvOutput, withUpperCasePath } from './shellEnv.ts';
import { removeDir } from '../util/removeDir.ts';

const dirs: string[] = [];
afterEach(() => Promise.all(dirs.splice(0).map((d) => removeDir(d))));

describe('parseEnvOutput', () => {
  it('reads NUL-separated entries between markers and ignores rc-file noise', () => {
    const out = 'Welcome to zsh!\n__SWITCHBOARD_ENV__PATH=/opt/homebrew/bin:/usr/bin\0MULTI=line one\nline two\0EMPTY=\0__SWITCHBOARD_ENV__';
    expect(parseEnvOutput(out)).toEqual({ PATH: '/opt/homebrew/bin:/usr/bin', MULTI: 'line one\nline two', EMPTY: '' });
  });

  it('returns null when markers are missing', () => {
    expect(parseEnvOutput('PATH=/usr/bin')).toBeNull();
  });
});

describe('claude binary', () => {
  it('parses the version line', () => {
    expect(parseClaudeVersion('2.1.285 (Claude Code)\n')).toBe('2.1.285');
    expect(parseClaudeVersion('garbage')).toBeNull();
  });

  it('checks PATH before the well-known locations, without duplicates', () => {
    const candidates = claudeCandidates({ PATH: '/x/bin:/opt/homebrew/bin' }, '/home/me', 'darwin');
    expect(candidates[0]).toBe('/x/bin/claude');
    expect(candidates.filter((c) => c === '/opt/homebrew/bin/claude')).toHaveLength(1);
    expect(candidates).toContain('/home/me/.claude/local/claude');
  });

  it('looks for claude.exe on Windows: on PATH, in npm\'s package next to its shim, and where installers put it', () => {
    const npm = (dir: string) => `${dir}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
    const candidates = claudeCandidates({ PATH: 'C:\\tools;C:\\Users\\me\\.local\\bin', APPDATA: 'C:\\Users\\me\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, 'C:\\Users\\me', 'win32');
    expect(candidates).toEqual([
      'C:\\tools\\claude.exe',
      npm('C:\\tools'),
      'C:\\Users\\me\\.local\\bin\\claude.exe',
      npm('C:\\Users\\me\\.local\\bin'),
      npm('C:\\Users\\me\\AppData\\Roaming\\npm'),
      'C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe',
    ]);
  });

  it('finds an executable on PATH and reads its version', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'switchboard-bin-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'bin'));
    if (process.platform === 'win32') {
      // A script can't stand in for claude.exe; Node itself prints a version for --version too. A copy, not a
      // hard link: Windows won't delete a link to the node.exe that is running these tests.
      const fake = join(dir, 'bin', 'claude.exe');
      copyFileSync(process.execPath, fake);
      await expect(findClaude({ PATH: join(dir, 'bin') })).resolves.toEqual({ path: fake, version: process.versions.node });
      return;
    }
    const fake = join(dir, 'bin', 'claude');
    writeFileSync(fake, '#!/bin/sh\necho "9.8.7 (Claude Code)"\n');
    chmodSync(fake, 0o755);
    await expect(findClaude({ PATH: join(dir, 'bin') })).resolves.toEqual({ path: fake, version: '9.8.7' });
  });

  it('reads PATH on Windows however its name is written', () => {
    expect(withUpperCasePath({ Path: 'C:\\a', HOME: 'x' })).toEqual({ PATH: 'C:\\a', HOME: 'x' });
    expect(withUpperCasePath({ PATH: 'C:\\b', Path: 'C:\\a' })).toEqual({ PATH: 'C:\\b' });
    const env = { PATH: '/usr/bin' };
    expect(withUpperCasePath(env)).toBe(env);
  });
});
