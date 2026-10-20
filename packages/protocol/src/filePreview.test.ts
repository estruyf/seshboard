import { describe, expect, it } from 'vitest';
import { MAX_PREVIEW_BYTES, previewKind } from './filePreview.ts';

describe('previewKind', () => {
  it('knows Markdown and HTML, in any case', () => {
    expect(previewKind('/a/README.md')).toBe('markdown');
    expect(previewKind('/a/notes.markdown')).toBe('markdown');
    expect(previewKind('/a/PLAN.MD')).toBe('markdown');
    expect(previewKind('/a/index.html')).toBe('html');
    expect(previewKind('/a/old.HTM')).toBe('html');
  });

  it('reads Windows paths', () => {
    expect(previewKind('C:\\docs\\a.md')).toBe('markdown');
    expect(previewKind('C:\\docs.md\\a')).toBeNull();
  });

  it('refuses everything else', () => {
    expect(previewKind('/a/main.ts')).toBeNull();
    expect(previewKind('/a/md')).toBeNull();
    expect(previewKind('/a/.md.bak')).toBeNull();
    expect(previewKind('/a/x.constructor')).toBeNull();
    expect(previewKind('/a.md/readme')).toBeNull();
    expect(previewKind('')).toBeNull();
  });

  it('caps text at 2 MB', () => {
    expect(MAX_PREVIEW_BYTES).toBe(2 * 1024 * 1024);
  });
});
