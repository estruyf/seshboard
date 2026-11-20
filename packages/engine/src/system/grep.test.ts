import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cutLine, expandGlob, globRegExp, grep, pathFilter, queryRegExp, type GrepOptions } from './grep.ts';
import { walk } from './files.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A folder with these files; a git repository (with the files committed) unless `git` is false. */
function folder(files: Record<string, string | Buffer>, git = true): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-grep-')));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  if (git) {
    const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    run('init', '-q');
    run('add', '-A');
    run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  }
  return dir;
}

const search = (cwd: string, query: string, options: Partial<GrepOptions> = {}) =>
  grep({ cwd, query, regex: false, caseSensitive: false, wholeWord: false, include: '', exclude: '', limit: 2000, git: true, files: () => walk(cwd), ...options });

const FILES = {
  'README.md': 'The Add to cart button\n',
  'src/cart/CartButton.tsx': 'export function CartButton() {\n  return t("cart.add"); // Add to cart\n}\n',
  'src/i18n/en.json': '{\n  "cart.add": "Add to cart",\n  "cart.addMore": "add to cart again"\n}\n',
  'tests/cart.test.ts': 'expect(label).toBe("Add to cart");\n',
};

describe.each([true, false])('grep (git: %s)', (git) => {
  it('finds every match with its line, column and text', async () => {
    const cwd = folder(FILES, git);
    const result = await search(cwd, 'Add to cart', { git });
    expect(result.files).toBe(4);
    expect(result.truncated).toBe(false);
    const json = result.matches.filter((m) => m.path === 'src/i18n/en.json');
    expect(json.map((m) => [m.line, m.column, m.length])).toEqual([[2, 16, 11], [3, 20, 11]]);
    expect(json[0]!.text).toBe('  "cart.add": "Add to cart",');
  });

  it('matches case only when asked', async () => {
    const cwd = folder(FILES, git);
    const result = await search(cwd, 'Add to cart', { git, caseSensitive: true });
    expect(result.matches.some((m) => m.text.includes('add to cart again'))).toBe(false);
    expect(result.matches).toHaveLength(4);
  });

  it('matches whole words', async () => {
    const cwd = folder({ 'a.txt': 'cart carts\ncartography\n' }, git);
    const result = await search(cwd, 'cart', { git, wholeWord: true });
    expect(result.matches.map((m) => [m.line, m.column])).toEqual([[1, 1]]);
  });

  it('takes a regular expression, and reports one that is invalid', async () => {
    const cwd = folder(FILES, git);
    const result = await search(cwd, 'cart\\.add(More)?', { git, regex: true });
    expect(result.matches.map((m) => `${m.path}:${m.line}`)).toEqual(['src/cart/CartButton.tsx:2', 'src/i18n/en.json:2', 'src/i18n/en.json:3']);
    await expect(search(cwd, 'cart(', { git, regex: true })).rejects.toMatchObject({ code: 'INVALID_QUERY' });
  });

  it('takes include and exclude globs', async () => {
    const cwd = folder(FILES, git);
    const paths = async (options: Partial<GrepOptions>) => [...new Set((await search(cwd, 'Add to cart', { git, ...options })).matches.map((m) => m.path))];
    expect(await paths({ include: 'src/**' })).toEqual(['src/cart/CartButton.tsx', 'src/i18n/en.json']);
    expect(await paths({ include: '*.json, *.md' })).toEqual(['README.md', 'src/i18n/en.json']);
    expect(await paths({ exclude: 'tests, *.json' })).toEqual(['README.md', 'src/cart/CartButton.tsx']);
  });

  it('skips binary files', async () => {
    const cwd = folder({ 'a.txt': 'needle\n', 'b.bin': Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0, 1, 2]) }, git);
    expect((await search(cwd, 'needle', { git })).matches.map((m) => m.path)).toEqual(['a.txt']);
  });

  it('stops at the limit, marked truncated', async () => {
    const cwd = folder({ 'a.txt': 'x\n'.repeat(50) }, git);
    const result = await search(cwd, 'x', { git, limit: 10 });
    expect(result.matches).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it('is cancelled by its signal', async () => {
    const cwd = folder(FILES, git);
    const controller = new AbortController();
    controller.abort();
    await expect(search(cwd, 'cart', { git, signal: controller.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

describe('grep in a git checkout', () => {
  it('respects .gitignore and searches untracked files', async () => {
    const cwd = folder({ '.gitignore': 'dist/\n', 'a.txt': 'needle\n' });
    writeFileSync(join(cwd, 'new.txt'), 'needle\n');
    mkdirSync(join(cwd, 'dist'));
    writeFileSync(join(cwd, 'dist', 'out.txt'), 'needle\n');
    expect((await search(cwd, 'needle')).matches.map((m) => m.path)).toEqual(['a.txt', 'new.txt']);
  });
});

describe('the pieces', () => {
  it('expands globs to match at any depth and as folders', () => {
    expect(expandGlob('*.ts')).toEqual(['**/*.ts', '**/*.ts/**']);
    expect(expandGlob('src/')).toEqual(['**/src', '**/src/**']);
    expect(expandGlob('/src')).toEqual(['src', 'src/**']);
    expect(expandGlob('src/**')).toEqual(['src/**']);
    expect(globRegExp('**/*.ts').test('a/b/c.ts')).toBe(true);
    expect(globRegExp('**/*.ts').test('c.ts')).toBe(true);
    expect(globRegExp('src/*.ts').test('src/a/b.ts')).toBe(false);
    const keep = pathFilter('src', '*.test.ts');
    expect(['src/a.ts', 'src/a.test.ts', 'lib/a.ts'].filter(keep)).toEqual(['src/a.ts']);
  });

  it('escapes a plain query', () => {
    expect(queryRegExp('a.b', { regex: false, caseSensitive: true, wholeWord: false }).test('axb')).toBe(false);
    expect(queryRegExp('(x)', { regex: false, caseSensitive: true, wholeWord: true }).test('a (x) b')).toBe(true);
  });

  it('cuts a long line around the match', () => {
    const line = `${'a'.repeat(1000)}NEEDLE${'b'.repeat(1000)}`;
    const { text, textStart } = cutLine(line, 1000, 6);
    expect(text).toHaveLength(400);
    expect(text.slice(1000 - textStart, 1006 - textStart)).toBe('NEEDLE');
    expect(cutLine('short', 0, 1)).toEqual({ text: 'short', textStart: 0 });
  });
});
