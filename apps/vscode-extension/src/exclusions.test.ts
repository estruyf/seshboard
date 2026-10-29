import { describe, expect, it } from 'vitest';
import { deniedByRead, escapeGlob, excludedBy, globMatcher, readRules } from './exclusions.ts';

describe('globMatcher', () => {
  const matches = (glob: string, path: string, ignoreCase = false) => globMatcher(glob, ignoreCase)(path);

  it('matches VS Code globs over whole paths', () => {
    expect(matches('**/node_modules', 'node_modules')).toBe(true);
    expect(matches('**/node_modules', 'a/b/node_modules')).toBe(true);
    expect(matches('**/node_modules', 'a/b/node_modules2')).toBe(false);
    expect(matches('**/*.{env,pem}', 'config/prod.pem')).toBe(true);
    expect(matches('**/*.{env,pem}', 'config/prod.key')).toBe(false);
    expect(matches('*.ts', 'src/a.ts')).toBe(false);
    expect(matches('src/**', 'src/a/b.ts')).toBe(true);
    expect(matches('secret?.txt', 'secret1.txt')).toBe(true);
    expect(matches('secret?.txt', 'secret/.txt')).toBe(false);
    expect(matches('[ab].md', 'c.md')).toBe(false);
    expect(matches('[a-c].md', 'b.md')).toBe(true);
    expect(matches('[!ab].md', 'c.md')).toBe(true);
    expect(matches('a/{b,{c,d}}/e', 'a/d/e')).toBe(true);
    expect(matches('A/*.TS', 'a/x.ts', true)).toBe(true);
  });

  it('takes an escaped or unclosed special character as itself', () => {
    expect(matches(escapeGlob('/w/[x]{y,z}*?'), '/w/[x]{y,z}*?')).toBe(true);
    expect(matches(escapeGlob('/w/[x]'), '/w/x')).toBe(false);
    expect(matches('a{b', 'a{b')).toBe(true);
    expect(matches('a[b', 'a[b')).toBe(true);
  });

  it('answers at once for globs a regular expression would take minutes on', () => {
    const started = Date.now();
    expect(matches(`${'**/'.repeat(40)}x`, `${'a/'.repeat(200)}y`)).toBe(false);
    expect(matches(`${'*a'.repeat(40)}b`, 'a'.repeat(300))).toBe(false);
    expect(matches(`${'{a,b}'.repeat(30)}`, 'ab')).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
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

  it('takes the folders in front of a pattern as paths, whatever characters their names have', () => {
    const rules = readRules([{ root: '/w/[x]', json: { permissions: { deny: ['Read(./.env)', 'Read(/secrets/**)', 'Read(~/.aws/**)'] } } }], '/w/[x]', '/home/{me}');
    expect(deniedByRead('/w/[x]/.env', rules)).toBe(true);
    expect(deniedByRead('/w/[x]/secrets/key.pem', rules)).toBe(true);
    expect(deniedByRead('/home/{me}/.aws/credentials', rules)).toBe(true);
    expect(deniedByRead('/w/x/.env', rules)).toBe(false);
  });

  it('denies everything for a bare Read, and ignores other tools and odd entries', () => {
    expect(denied('/repo/a.ts', ['Read'])).toBe(true);
    expect(denied('/repo/a.ts', ['Edit(./a.ts)', 'Bash(rm:*)', 42])).toBe(false);
    expect(deniedByRead('/repo/a.ts', readRules([{ root: '/repo', json: 'not settings' }], '/repo', '/Users/me'))).toBe(false);
  });
});
