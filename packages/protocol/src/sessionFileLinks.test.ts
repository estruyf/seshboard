import { describe, expect, it } from 'vitest';
import { findSessionFiles, sessionFileKind } from './sessionFileLinks.ts';

describe('sessionFileKind', () => {
  it('knows the preview kinds and images, not other files', () => {
    expect(sessionFileKind('/a/review.md')).toBe('markdown');
    expect(sessionFileKind('/a/main.ts')).toBe('code');
    expect(sessionFileKind('/a/shot.PNG')).toBe('image');
    expect(sessionFileKind('C:\\a\\photo.jpeg')).toBe('image');
    expect(sessionFileKind('/a/report.pdf')).toBeNull();
    expect(sessionFileKind('/a/.env')).toBeNull();
  });
});

describe('findSessionFiles', () => {
  const paths = (text: string) => findSessionFiles(text).map((f) => f.path);

  it('finds a path in a sentence, without the full stop after it', () => {
    const text = 'The full list is in /private/tmp/claude-501/-Users-me-web/abc/scratchpad/code-review.md.';
    const [found] = findSessionFiles(text);
    expect(found?.path).toBe('/private/tmp/claude-501/-Users-me-web/abc/scratchpad/code-review.md');
    expect(text.slice(found!.start, found!.end)).toBe(found!.path);
  });

  it('finds paths in brackets, quotes and code, with a line after them, and Windows paths', () => {
    expect(paths('See (/a/b.md) and "/c/d.ts:12", `/e/f.png`, then C:\\work\\notes.md: done')).toEqual(['/a/b.md', '/c/d.ts', '/e/f.png', 'C:\\work\\notes.md']);
  });

  it('leaves out web addresses, relative paths and files that do not open', () => {
    expect(paths('https://example.com/a.md src/a.ts ./b.md /a/report.pdf /usr/bin/node a/b/c.md')).toEqual([]);
  });
});
