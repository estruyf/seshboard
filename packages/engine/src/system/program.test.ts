import { describe, expect, it } from 'vitest';
import { programPath } from './program.ts';

describe('programPath', () => {
  const files = (...paths: string[]) => (path: string) => paths.includes(path);

  it('leaves the name to the system outside Windows', () => {
    expect(programPath('git', { PATH: '/usr/bin' }, 'darwin', () => false)).toBe('git');
    expect(programPath('git', { PATH: '/usr/bin' }, 'linux', () => false)).toBe('git');
  });

  it('starts a program on Windows by its full path from PATH, whatever case PATH is in', () => {
    const exists = files('C:\\Program Files\\Git\\cmd\\git.exe');
    expect(programPath('git', { Path: 'C:\\Windows\\System32;C:\\Program Files\\Git\\cmd' }, 'win32', exists)).toBe('C:\\Program Files\\Git\\cmd\\git.exe');
    expect(programPath('git', { PATH: '"C:\\Program Files\\Git\\cmd"' }, 'win32', exists)).toBe('C:\\Program Files\\Git\\cmd\\git.exe');
  });

  it('never finds one in the folder it runs in: relative and drive-relative PATH folders are skipped', () => {
    const exists = files('.\\git.exe', 'git.exe', '\\repo\\git.exe', 'C:\\repo\\git.exe');
    expect(programPath('git', { PATH: '.;;\\repo;repo' }, 'win32', exists)).toBeNull();
    expect(programPath('gh', { PATH: '' }, 'win32', () => true)).toBeNull();
  });

  it('tries .com and .exe for a bare name, and a name with an ending as it is', () => {
    expect(programPath('gh', { PATH: 'C:\\bin' }, 'win32', files('C:\\bin\\gh.cmd', 'C:\\bin\\gh.exe'))).toBe('C:\\bin\\gh.exe');
    expect(programPath('gh.exe', { PATH: 'C:\\tools' }, 'win32', files('C:\\tools\\gh.exe'))).toBe('C:\\tools\\gh.exe');
  });

  it('keeps a program given with a folder (the smoke test fake gh)', () => {
    expect(programPath('C:\\node\\node.exe', { PATH: '' }, 'win32', () => false)).toBe('C:\\node\\node.exe');
  });
});
