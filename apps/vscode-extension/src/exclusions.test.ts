import { describe, expect, it } from 'vitest';
import { deniedByRead, excludedBy, globToRegExp, readRules } from './exclusions.ts';

describe('globToRegExp', () => {
  it('matches VS Code globs over whole paths', () => {
    expect(globToRegExp('**/node_modules').test('node_modules')).toBe(true);
    expect(globToRegExp('**/node_modules').test('a/b/node_modules')).toBe(true);
    expect(globToRegExp('**/*.{env,pem}').test('config/prod.pem')).toBe(true);
    expect(globToRegExp('*.ts').test('src/a.ts')).toBe(false);
    expect(globToRegExp('secret?.txt').test('secret1.txt')).toBe(true);
    expect(globToRegExp('[ab].md').test('c.md')).toBe(false);
  });
});

describe('excludedBy', () => {
  it('excludes files inside an excluded folder, only for globs that are on', () => {
    expect(excludedBy('node_modules/x/index.js', { '**/node_modules': true })).toBe(true);
    expect(excludedBy('dist/app.js', { '**/dist': false })).toBe(false);
    expect(excludedBy('src/app.ts', { '**/dist': true, '**/.git': true })).toBe(false);
  });
});

describe('Read deny rules', () => {
  const settings = (deny: unknown[], root = '/repo') => [{ root, json: { permissions: { deny } } }];
  const denied = (path: string, deny: unknown[], root?: string) => deniedByRead(path, readRules(settings(deny, root), '/repo', '/Users/me'));

  it('reads patterns the way Claude Code does', () => {
    expect(denied('/repo/.env', ['Read(./.env)'])).toBe(true);
    expect(denied('/repo/sub/.env', ['Read(./.env)'])).toBe(false);
    expect(denied('/repo/sub/.env', ['Read(.env)'])).toBe(true);
    expect(denied('/repo/secrets/key.pem', ['Read(./secrets/**)'])).toBe(true);
    expect(denied('/repo/secrets/key.pem', ['Read(secrets/)'])).toBe(true);
    expect(denied('/Users/me/.aws/credentials', ['Read(~/.aws/**)'])).toBe(true);
    expect(denied('/etc/hosts', ['Read(//etc/hosts)'])).toBe(true);
    expect(denied('/repo/config/db.yml', ['Read(/config/*.yml)'])).toBe(true);
  });

  it('matches Windows paths in the POSIX form Claude Code uses for them, without regard to case', () => {
    const winDenied = (path: string, deny: unknown[]) => deniedByRead(path, readRules([{ root: 'C:\\repo', json: { permissions: { deny } } }], 'C:\\repo', 'C:\\Users\\me'));
    expect(winDenied('C:\\repo\\.env', ['Read(./.env)'])).toBe(true);
    expect(winDenied('c:\\Repo\\sub\\.env', ['Read(.env)'])).toBe(true);
    expect(winDenied('C:\\Users\\me\\.aws\\credentials', ['Read(~/.aws/**)'])).toBe(true);
    expect(winDenied('C:\\repo\\config\\db.yml', ['Read(/config/*.yml)'])).toBe(true);
    expect(winDenied('D:\\data\\.env', ['Read(//c/**/.env)'])).toBe(false);
    expect(winDenied('C:\\data\\.env', ['Read(//c/**/.env)'])).toBe(true);
    expect(winDenied('D:\\data\\.env', ['Read(//**/.env)'])).toBe(true);
    expect(winDenied('C:\\repo\\a.ts', ['Read(./.env)'])).toBe(false);
  });

  it('denies everything for a bare Read, and ignores other tools and odd entries', () => {
    expect(denied('/repo/a.ts', ['Read'])).toBe(true);
    expect(denied('/repo/a.ts', ['Edit(./a.ts)', 'Bash(rm:*)', 42])).toBe(false);
    expect(deniedByRead('/repo/a.ts', readRules([{ root: '/repo', json: 'not settings' }], '/repo', '/Users/me'))).toBe(false);
  });
});
