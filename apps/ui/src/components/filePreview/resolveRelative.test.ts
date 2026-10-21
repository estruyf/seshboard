import { describe, expect, it } from 'vitest';
import { resolveRelative } from './resolveRelative.ts';

describe('resolveRelative', () => {
  it('reads relative paths from the folder', () => {
    expect(resolveRelative('./a.png', '/work/docs')).toBe('/work/docs/a.png');
    expect(resolveRelative('a.png', '/work/docs')).toBe('/work/docs/a.png');
    expect(resolveRelative('../a.png', '/work/docs')).toBe('/work/a.png');
    expect(resolveRelative('img/b/../c.png', '/work/docs')).toBe('/work/docs/img/c.png');
  });
  it('never climbs above the root', () => {
    expect(resolveRelative('../../../a.png', '/work')).toBe('/a.png');
    expect(resolveRelative('..', '/work')).toBeNull();
  });
  it('takes absolute and file: paths as they are', () => {
    expect(resolveRelative('/abs/a.png', '/work/docs')).toBe('/abs/a.png');
    expect(resolveRelative('file:///abs/a%20b.png', '/work/docs')).toBe('/abs/a b.png');
    expect(resolveRelative('file:///C:/x/a.png', '/work')).toBe('C:/x/a.png');
    expect(resolveRelative('C:\\x\\a.png', '/work')).toBe('C:\\x\\a.png');
  });
  it('leaves the web, anchors and empty values alone', () => {
    expect(resolveRelative('https://example.com/a.png', '/work')).toBeNull();
    expect(resolveRelative('http://example.com', '/work')).toBeNull();
    expect(resolveRelative('mailto:a@b.c', '/work')).toBeNull();
    expect(resolveRelative('data:image/png;base64,AAAA', '/work')).toBeNull();
    expect(resolveRelative('//cdn.example.com/a.png', '/work')).toBeNull();
    expect(resolveRelative('#section', '/work')).toBeNull();
    expect(resolveRelative('', '/work')).toBeNull();
    expect(resolveRelative(undefined, '/work')).toBeNull();
  });
  it('cuts off a query and a fragment and decodes the name', () => {
    expect(resolveRelative('other.md#top', '/work')).toBe('/work/other.md');
    expect(resolveRelative('my%20file.md?x=1', '/work')).toBe('/work/my file.md');
  });
  it('keeps the separator of a Windows folder', () => {
    expect(resolveRelative('./a.png', 'C:\\Users\\me\\docs')).toBe('C:\\Users\\me\\docs\\a.png');
    expect(resolveRelative('..\\b/c.md', 'C:\\Users\\me\\docs')).toBe('C:\\Users\\me\\b\\c.md');
    expect(resolveRelative('../../../../a.png', 'C:\\Users')).toBe('C:\\a.png');
    expect(resolveRelative('a.md', 'C:/Users/me')).toBe('C:/Users/me/a.md');
  });
});
