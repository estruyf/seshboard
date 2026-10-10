import { describe, expect, it } from 'vitest';
import { AbsolutePath } from './absolutePath.ts';
import { expandHome, isAbsolutePath, isLocalAbsolutePath, isSameOrInside, joinPath, pathInside, separatorOf, trimTrailingSeparators } from './paths.ts';

describe('isAbsolutePath', () => {
  it('takes absolute paths on macOS, Linux and Windows', () => {
    for (const path of ['/', '/Users/me/dev/app', 'C:\\Users\\me\\dev\\app', 'c:/Users/me', 'E:\\']) expect(isAbsolutePath(path), path).toBe(true);
  });

  it('refuses relative, home-relative, drive-relative and network paths', () => {
    for (const path of ['', 'src', './src', '~/dev', '~\\dev', 'C:', 'C:folder', '\\\\server\\share', '\\folder']) expect(isAbsolutePath(path), path).toBe(false);
  });

  it('knows which separator a path uses, and puts the home folder in front of ~ in it', () => {
    expect(separatorOf('/Users/me')).toBe('/');
    expect(separatorOf('C:\\Users\\me')).toBe('\\');
    expect(separatorOf('C:/Users/me')).toBe('/');
    expect(expandHome('~/.claude-work', '/Users/me')).toBe('/Users/me/.claude-work');
    expect(expandHome('~\\.claude-work', 'C:\\Users\\me')).toBe('C:\\Users\\me\\.claude-work');
    expect(expandHome('~/dev/app', 'C:\\Users\\me')).toBe('C:\\Users\\me\\dev\\app');
    expect(expandHome('~', '/Users/me')).toBe('/Users/me');
    expect(expandHome('~other/x', '/Users/me')).toBe('~other/x');
    expect(expandHome('~/x', null)).toBe('~/x');
  });

  it('tells whether a path is a folder or inside it', () => {
    expect(isSameOrInside('/Users/me/q', '/Users/me/q/')).toBe(true);
    expect(isSameOrInside('/Users/me/q/sub', '/Users/me/q')).toBe(true);
    expect(isSameOrInside('/Users/me/qq', '/Users/me/q')).toBe(false);
    expect(isSameOrInside('/Users/Me/q', '/Users/me/q')).toBe(false);
    expect(isSameOrInside('C:\\Users\\me\\q\\sub', 'C:\\Users\\me\\q')).toBe(true);
    expect(isSameOrInside('c:/users/me/q', 'C:\\Users\\me\\q\\')).toBe(true);
    expect(isSameOrInside('C:\\Users\\me\\qq', 'C:\\Users\\me\\q')).toBe(false);
    expect(isSameOrInside('D:\\Users\\me\\q', 'C:\\Users\\me\\q')).toBe(false);
  });

  it('takes a path apart from its folder, and puts one together in the folder\'s separator', () => {
    expect(pathInside('/repo/src/a.ts', '/repo/')).toBe('src/a.ts');
    expect(pathInside('/repo', '/repo')).toBe('');
    expect(pathInside('/repository/a.ts', '/repo')).toBeNull();
    expect(pathInside('C:\\repo\\src\\a.ts', 'c:\\repo')).toBe('src\\a.ts');
    expect(joinPath('/repo/', 'src/a.ts')).toBe('/repo/src/a.ts');
    expect(joinPath('/', 'etc')).toBe('/etc');
    expect(joinPath('C:\\repo', 'src/a.ts')).toBe('C:\\repo\\src\\a.ts');
    expect(joinPath('C:\\', 'repo')).toBe('C:\\repo');
  });

  it('takes only the local form for paths from outside', () => {
    expect(isLocalAbsolutePath('/Users/me', 'darwin')).toBe(true);
    expect(isLocalAbsolutePath('C:\\Users\\me', 'darwin')).toBe(false);
    expect(isLocalAbsolutePath('C:\\Users\\me', 'win32')).toBe(true);
    expect(isLocalAbsolutePath('C:/Users/me', 'win32')).toBe(true);
    // On Windows /x means "on the current drive": relative to something after all.
    expect(isLocalAbsolutePath('/Users/me', 'win32')).toBe(false);
    expect(isLocalAbsolutePath('\\\\server\\share', 'win32')).toBe(false);
  });

  it('is what the protocol checks paths with, for the platform it runs on', () => {
    const local = process.platform === 'win32' ? 'C:\\Users\\me' : '/Users/me';
    const other = process.platform === 'win32' ? '/Users/me' : 'C:\\Users\\me';
    expect(AbsolutePath.safeParse(local).success).toBe(true);
    expect(AbsolutePath.safeParse(other).success).toBe(false);
    expect(AbsolutePath.safeParse('Users/me').success).toBe(false);
  });
});

describe('trimTrailingSeparators', () => {
  it('drops trailing separators but keeps a root', () => {
    expect(trimTrailingSeparators('/Users/me/dev/')).toBe('/Users/me/dev');
    expect(trimTrailingSeparators('/Users/me//')).toBe('/Users/me');
    expect(trimTrailingSeparators('/')).toBe('/');
    expect(trimTrailingSeparators('C:\\Users\\me\\')).toBe('C:\\Users\\me');
    expect(trimTrailingSeparators('C:/Users/me/')).toBe('C:/Users/me');
  });

  it('keeps one separator after a drive, as C: alone is relative', () => {
    expect(trimTrailingSeparators('C:\\')).toBe('C:\\');
    expect(trimTrailingSeparators('C:\\\\')).toBe('C:\\');
    expect(trimTrailingSeparators('E:/')).toBe('E:/');
    expect(trimTrailingSeparators('C://')).toBe('C:/');
  });

  it('keeps a trailing backslash outside drive paths, where it is part of a name', () => {
    expect(trimTrailingSeparators('/Users/me/odd\\')).toBe('/Users/me/odd\\');
    expect(trimTrailingSeparators('src')).toBe('src');
  });
});
