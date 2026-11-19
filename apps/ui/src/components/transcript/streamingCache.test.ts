import { describe, expect, it } from 'vitest';
import { newStreamingCache, streamingBlockTexts, streamingBlocksFresh } from './streamingMarkdown.ts';

const PROSE = 'Some **text** with `code` and a [link](https://example.com).\n\n- one <b>x</b>\n- two\n\nReturns Promise<void> and Vec<u8> here, then useState<S> too.\n\n```ts\nconst a: Array<string> = [];\n```\n\n';

/** Documents that stress what the cache must not get wrong: tags paired over blocks, strays, a block left open, quotes, footnotes. */
const DOCUMENTS: Record<string, string> = {
  prose: PROSE.repeat(6),
  details: `${PROSE}<details>\n<summary>More</summary>\n\nHidden **text** with Promise<void>\n\n- a\n- b\n\nMore hidden.\n\n</details>\n\nAfter the details.\n\n${PROSE}`,
  strays: `${PROSE}<script> stray one.\n\nNext **bold**.\n\n<pre> stray two.\n\n- list\n\n<details> hides content.\n\n<b>\n\nLast paragraph with Foo<I>.\n\n${PROSE}`,
  divOverBlocks: `${PROSE}<div align="center">\n\n**Title** for Component<P>\n\nMiddle block.\n\n</div>\n\nAfter the div.\n\n<table>\n<tr><td>a<td>b\n</table>\n\n${PROSE}`,
  // An opener whose end tag comes within a few blocks.
  divClosesSoon: `Intro.\n\n<div>\n\n${PROSE}Middle.\n\n</div>\n\nEnd.\n\n${PROSE}`,
  openTwo: `<div>\n\nOne.\n\n<pre>\n\nTwo.\n\n</pre>\n\nThree.\n\n</div>\n\n${PROSE}`,
  pairedPre: `<pre>\ncode <b>x</b>\n\nmore\n</pre>\n\n${PROSE}<script>alert(1)</script>\n\n${PROSE}`,
  quotes: `> <details> hides\n>\n> After.\n\n> <div>\n> <b>bold\n> </div>\n\n- <pre> in a list\n- next\n\n${PROSE}`,
  footnotes: `Text[^1] and [ref][1].\n\n<pre> stray.\n\n[^1]: The note\n\n[1]: https://example.com/x\n\n${PROSE}`,
  maths: `${PROSE}If $a<b$ then <branch> and $x<y$.\n\n$$\nc<d\n\ne>f\n$$\n\n<details>\n<summary>s</summary>\n\n$q<r$ inside.\n\n</details>\n\n${PROSE}`,
  unknown: `<DETAILS>x</DETAILS> and <Br> and <your-token>\n\n<your-token>\n\n${PROSE}`,
};

describe('streamingBlockTexts with a cache', () => {
  it('gives what the whole text gives, for every prefix of a reply as it is written', () => {
    for (const [name, text] of Object.entries(DOCUMENTS)) {
      const cache = newStreamingCache();
      for (let end = 1; end <= text.length; end += end < 60 ? 1 : 7) {
        const prefix = text.slice(0, end);
        expect(streamingBlockTexts(prefix, cache, Infinity), `${name} at ${end}: ${JSON.stringify(prefix.slice(-40))}`).toEqual(streamingBlocksFresh(prefix));
      }
      expect(streamingBlockTexts(text, cache, Infinity), name).toEqual(streamingBlocksFresh(text));
    }
  });

  it('starts again when the text is not the one it kept going on from', () => {
    const cache = newStreamingCache();
    streamingBlockTexts(DOCUMENTS.prose!, cache, Infinity);
    expect(streamingBlockTexts(DOCUMENTS.details!, cache, Infinity)).toEqual(streamingBlocksFresh(DOCUMENTS.details!));
    expect(streamingBlockTexts('Short.', cache, Infinity)).toEqual(streamingBlocksFresh('Short.'));
  });

  it('keeps what is before an opener, and takes an opener for text once blocks pass without its end tag', () => {
    const cache = newStreamingCache();
    const text = `Intro.\n\n<div>\n\n${PROSE.repeat(4)}Middle.\n\n</div>\n\nEnd.`;
    const open = text.indexOf('<div>');
    // While the div is near, nothing after it is kept, and the result is what the whole text gives.
    for (const end of [10, 40, open + 12, open + 60]) expect(streamingBlockTexts(text.slice(0, end), cache), `${end}`).toEqual(streamingBlocksFresh(text.slice(0, end)));
    expect(cache.raw.length).toBeLessThanOrEqual(open);
    // Many blocks later it is text, and what is after it is kept.
    const later = streamingBlockTexts(text.slice(0, text.indexOf('Middle.')), cache);
    expect(cache.raw.length).toBeGreaterThan(open + 100);
    expect(later.join('')).toContain('&lt;div>');
    // The reply once finished is read whole: the div is live.
    expect(streamingBlocksFresh(text).join('')).toContain('<div>');
  });

  it('is fast on a long reply with many generics, one delta at a time', () => {
    const base = PROSE.repeat(Math.ceil(45_000 / PROSE.length));
    const cache = newStreamingCache();
    streamingBlockTexts(base, cache);
    const deltas = 120;
    const tail = 'More text here with Promise<void> and a <b>bold</b> word, then a new paragraph.\n\n'.repeat(4);
    let text = base;
    const started = performance.now();
    for (let i = 0; i < deltas; i++) {
      text += tail.slice((i * 7) % tail.length, ((i + 1) * 7) % tail.length || undefined);
      streamingBlockTexts(text, cache);
    }
    const each = (performance.now() - started) / deltas;
    console.log(`streaming, ${base.length} characters: ${each.toFixed(2)} ms per delta`);
    // Without the cache this is about 300 ms; the limit is generous, for slow runners.
    expect(each).toBeLessThan(25);
  });

  it('is fast when the reply starts with an opener that never gets its end tag', () => {
    for (const opener of ['<div>', '<pre>', '<script> stray.', '<details> hides content.', '<b>']) {
      const para = PROSE.repeat(1);
      const base = `${opener}\n\n${para.repeat(Math.ceil(17_000 / para.length))}`;
      const cache = newStreamingCache();
      streamingBlockTexts(base, cache);
      let text = base;
      const started = performance.now();
      for (let i = 0; i < 80; i++) {
        text += 'More text with Promise<void> in it.\n\n'.slice((i * 5) % 30, ((i + 1) * 5) % 30 || undefined);
        streamingBlockTexts(text, cache);
      }
      const each = (performance.now() - started) / 80;
      console.log(`streaming after ${JSON.stringify(opener)}, ${base.length} characters: ${each.toFixed(2)} ms per delta`);
      expect(each, opener).toBeLessThan(25);
    }
  });
});
