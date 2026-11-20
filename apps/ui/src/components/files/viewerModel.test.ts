import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '../../lib/unifiedDiff.ts';
import { changedLines, fenceLanguage, lineSpan, markdownOutline } from './viewerModel.ts';

describe('changedLines', () => {
  it('marks new and replaced lines, with the old text', () => {
    const diff = '@@ -1,4 +1,5 @@\n a\n-b\n+B\n+new\n c\n-d\n e\n';
    const marks = changedLines(parseUnifiedDiff(diff));
    expect([...marks]).toEqual([
      [2, 'b'],
      [3, null],
      [5, 'd'],
    ]);
  });
});

describe('markdownOutline', () => {
  it('lists headings, not the ones in code', () => {
    const text = '# Storefront\n\nText\n\n## Run it\n\n```sh\n# not a heading\n```\n\n## The **cart** ##\n';
    expect(markdownOutline(text)).toEqual([
      { level: 1, text: 'Storefront', index: 0 },
      { level: 2, text: 'Run it', index: 1 },
      { level: 2, text: 'The cart', index: 2 },
    ]);
  });
});

describe('small helpers', () => {
  it('says the lines and the language', () => {
    expect(lineSpan(6, 12)).toBe('lines 6–12');
    expect(lineSpan(3, 3)).toBe('line 3');
    expect(fenceLanguage('/a/CartButton.tsx')).toBe('tsx');
    expect(fenceLanguage('/a/Dockerfile')).toBeUndefined();
  });
});
