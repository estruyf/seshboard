import { describe, expect, it } from 'vitest';
import { createPathResolver, fileRefFromHref, fileUrl, parseFileRef } from './fileRefs.ts';

describe('parseFileRef', () => {
  it('reads paths with and without a line', () => {
    expect(parseFileRef('packages/common/src/search/suggestions.ts:69')).toEqual({ path: 'packages/common/src/search/suggestions.ts', line: 69 });
    expect(parseFileRef('src/a.ts:12:5')).toEqual({ path: 'src/a.ts', line: 12 });
    expect(parseFileRef('src/a.ts:12-30')).toEqual({ path: 'src/a.ts', line: 12 });
    expect(parseFileRef(' /Users/me/a.ts ')).toEqual({ path: '/Users/me/a.ts' });
    expect(parseFileRef('~/Developer/involv')).toEqual({ path: '~/Developer/involv' });
    expect(parseFileRef('Root.xml')).toEqual({ path: 'Root.xml' });
    expect(parseFileRef('.gitignore')).toEqual({ path: '.gitignore' });
    expect(parseFileRef('src/a.ts:0')).toEqual({ path: 'src/a.ts' });
  });

  it('reads Windows paths, with the drive and with backslashes', () => {
    expect(parseFileRef('C:\\repo\\src\\a.ts:12')).toEqual({ path: 'C:\\repo\\src\\a.ts', line: 12 });
    expect(parseFileRef('C:/repo/src/a.ts')).toEqual({ path: 'C:/repo/src/a.ts' });
    expect(parseFileRef('src\\a.ts:7')).toEqual({ path: 'src\\a.ts', line: 7 });
    expect(parseFileRef('~\\notes.md')).toEqual({ path: '~\\notes.md' });
  });

  it('leaves code that is not a path alone', () => {
    for (const text of ['Description', 'npm run check', 'node:fs', 'https://example.com/a.ts', '5.4.1', 'v0.0.12', '..', '/', '\\', 'C:', 'a.ts && b.ts', 'fn(a.ts)', '']) {
      expect(parseFileRef(text), text).toBeNull();
    }
  });
});

describe('fileUrl', () => {
  it('makes file links from macOS and Windows paths, and reads them back', () => {
    expect(fileUrl('/Users/me/my notes.md')).toBe('file:///Users/me/my%20notes.md');
    expect(fileUrl('E:\\repos\\a b\\x.ts')).toBe('file:///E:/repos/a%20b/x.ts');
    expect(fileRefFromHref(fileUrl('C:\\repo\\a.ts'))).toEqual({ path: 'C:/repo/a.ts' });
    expect(fileUrl('C:\\repo\\a#b?.ts')).toBe('file:///C:/repo/a%23b%3F.ts');
    expect(fileUrl('/repo/c#/x.cs')).toBe('file:///repo/c%23/x.cs');
  });
});

describe('fileRefFromHref', () => {
  it('reads relative and file links, with GitHub-style lines', () => {
    expect(fileRefFromHref('src/a.ts#L69')).toEqual({ path: 'src/a.ts', line: 69 });
    expect(fileRefFromHref('src/a.ts#L69-L80')).toEqual({ path: 'src/a.ts', line: 69 });
    expect(fileRefFromHref('file:///Users/me/my%20notes/a.md')).toBeNull();
    expect(fileRefFromHref('file:///Users/me/a.md')).toEqual({ path: '/Users/me/a.md' });
    expect(fileRefFromHref('file:///C:/Users/me/a.md#L3')).toEqual({ path: 'C:/Users/me/a.md', line: 3 });
    expect(fileRefFromHref('https://github.com/a/b/blob/main/a.ts')).toBeNull();
    expect(fileRefFromHref('mailto:me@example.com')).toBeNull();
    expect(fileRefFromHref(undefined)).toBeNull();
  });
});

describe('createPathResolver', () => {
  it('asks for the paths of one moment in one call, and remembers the answers', async () => {
    const calls: string[][] = [];
    const resolver = createPathResolver(
      async (paths) => {
        calls.push(paths);
        return paths.map((p) => (p === 'a.ts' ? '/repo/a.ts' : null));
      },
      { batchMs: 0 },
    );
    expect(resolver.peek('a.ts')).toBeUndefined();
    const results = await Promise.all([resolver.resolve('a.ts'), resolver.resolve('b.ts'), resolver.resolve('a.ts')]);
    expect(results).toEqual(['/repo/a.ts', null, '/repo/a.ts']);
    expect(calls).toEqual([['a.ts', 'b.ts']]);
    expect(resolver.peek('a.ts')).toBe('/repo/a.ts');
    expect(resolver.peek('b.ts')).toBeNull();
    await resolver.resolve('a.ts');
    expect(calls).toHaveLength(1);
  });

  it('splits big batches and forgets failed lookups', async () => {
    let fail = true;
    const calls: number[] = [];
    const resolver = createPathResolver(
      async (paths) => {
        calls.push(paths.length);
        if (fail) throw new Error('engine gone');
        return paths.map(() => '/x');
      },
      { batchMs: 0, batchSize: 2 },
    );
    expect(await Promise.all(['a', 'b', 'c'].map((p) => resolver.resolve(`${p}.ts`)))).toEqual([null, null, null]);
    expect(calls).toEqual([2, 1]);
    expect(resolver.peek('a.ts')).toBeUndefined();
    fail = false;
    expect(await resolver.resolve('a.ts')).toBe('/x');
  });
});
