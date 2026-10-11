import { describe, expect, it } from 'vitest';
import { basename, dirnameOf, guessHome, pathTail, shortAge, tildify } from './format.ts';

describe('format', () => {
  const now = Date.UTC(2026, 9, 5, 12, 0, 0);
  it('formats ages compactly', () => {
    expect(shortAge(now - 10_000, now)).toBe('now');
    expect(shortAge(now - 5 * 60_000, now)).toBe('5m');
    expect(shortAge(now - 3 * 3_600_000, now)).toBe('3h');
    expect(shortAge(now - 2 * 86_400_000, now)).toBe('2d');
    expect(shortAge(now + 60_000, now)).toBe('now');
  });

  it('handles paths', () => {
    expect(basename('/Users/me/dev/app/')).toBe('app');
    expect(guessHome(['/tmp/x', '/Users/me/dev/app'])).toBe('/Users/me');
    expect(tildify('/Users/me/dev/app', '/Users/me')).toBe('~/dev/app');
    expect(tildify('/Users/meow/app', '/Users/me')).toBe('/Users/meow/app');
  });

  it('handles Windows paths', () => {
    expect(basename('C:\\Users\\me\\dev\\app\\')).toBe('app');
    expect(guessHome(['E:\\repos\\app', 'C:\\Users\\me\\.claude'])).toBe('C:\\Users\\me');
    expect(tildify('C:\\Users\\me\\dev\\app', 'C:\\Users\\me')).toBe('~\\dev\\app');
    expect(tildify('c:\\Users\\me\\dev', 'C:\\Users\\me')).toBe('~\\dev');
    expect(tildify('C:\\Users\\meow\\app', 'C:\\Users\\me')).toBe('C:\\Users\\meow\\app');
    expect(tildify('/Users/Me/app', '/Users/me')).toBe('/Users/Me/app');
  });
});

describe('dirnameOf and pathTail', () => {
  it('take paths apart at either separator, and keep the path’s own', () => {
    expect(dirnameOf('/Users/me/memory/a.md')).toBe('/Users/me/memory');
    expect(dirnameOf('C:\\Users\\me\\memory\\a.md')).toBe('C:\\Users\\me\\memory');
    expect(pathTail('/Users/me/memory/a.md', 2)).toBe('memory/a.md');
    expect(pathTail('C:\\Users\\me\\memory\\a.md', 2)).toBe('memory\\a.md');
    expect(pathTail('C:\\Users\\me\\memory\\a.md', 3)).toBe('me\\memory\\a.md');
  });
});
