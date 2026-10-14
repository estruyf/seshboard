import { describe, expect, it } from 'vitest';
import { replyHtml } from './richText.tsx';

describe('replyHtml', () => {
  it('keeps headings, lists, emphasis and links', () => {
    const html = replyHtml('## Plan\n\n1. **Read** the [docs](https://example.com)\n2. Run *tests*\n\n- one\n- two');
    expect(html).toContain('<h2>Plan</h2>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<strong>Read</strong>');
    expect(html).toContain('<a href="https://example.com">docs</a>');
    expect(html).toContain('<em>tests</em>');
    expect(html).toContain('<ul>');
  });

  it('keeps code blocks and inline code in a monospace font', () => {
    const html = replyHtml('Run `npm test`:\n\n```ts\nconst a = 1 < 2;\n```');
    expect(html).toMatch(/<code style="font-family:[^"]*monospace">npm test<\/code>/);
    expect(html).toMatch(/<pre style="[^"]*monospace[^"]*"><code[^>]*>const a = 1 &lt; 2;\n<\/code><\/pre>/);
  });

  it('keeps tables, with borders that survive the paste', () => {
    const html = replyHtml('| File | Lines |\n| --- | --- |\n| a.ts | 12 |');
    expect(html).toContain('<table style="border-collapse:collapse">');
    expect(html).toMatch(/<th style="border:1px solid #d0d7de[^"]*">File<\/th>/);
    expect(html).toMatch(/<td style="[^"]*">a.ts<\/td>/);
  });

  it('keeps a link to a project file as its text, which means nothing elsewhere, and drops unsafe links', () => {
    expect(replyHtml('See [auth.ts](src/auth.ts#L12).')).toBe('<p>See auth.ts.</p>');
    expect(replyHtml('[x](javascript:alert(1))')).not.toContain('javascript:');
  });

  it('writes no classes or app styling', () => {
    expect(replyHtml('# Title\n\nText with `code`.')).not.toContain('class=');
  });
});
