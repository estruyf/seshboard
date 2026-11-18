import { describe, expect, it } from 'vitest';
import { newStreamingCache, streamingBlocks, streamingBlocksFresh } from './streamingMarkdown.ts';

const PROSE = 'Some **text** with `code` and a [link](https://example.com).\n\n- one <b>x</b>\n- two\n\nReturns Promise<void> and Vec<u8> here, then useState<S> too.\n\n```ts\nconst a: Array<string> = [];\n```\n\n';

/** Documents that stress what the cache must not get wrong: tags paired over blocks, strays, a block left open, quotes, footnotes. */
const DOCUMENTS: Record<string, string> = {
  prose: PROSE.repeat(6),
  details: `${PROSE}<details>\n<summary>More</summary>\n\nHidden **text** with Promise<void>\n\n- a\n- b\n\nMore hidden.\n\n</details>\n\nAfter the details.\n\n${PROSE}`,
  strays: `${PROSE}<script> stray one.\n\nNext **bold**.\n\n<pre> stray two.\n\n- list\n\n<details> hides content.\n\n<b>\n\nLast paragraph with Foo<I>.\n\n${PROSE}`,
  divOverBlocks: `${PROSE}<div align="center">\n\n**Title** for Component<P>\n\nMiddle block.\n\n</div>\n\nAfter the div.\n\n<table>\n<tr><td>a<td>b\n</table>\n\n${PROSE}`,
  unclosedForLong: `Intro.\n\n<div>\n\n${PROSE}${PROSE}Middle.\n\n</div>\n\nEnd.`,
  pairedPre: `<pre>\ncode <b>x</b>\n\nmore\n</pre>\n\n${PROSE}<script>alert(1)</script>\n\n${PROSE}`,
  quotes: `> <details> hides\n>\n> After.\n\n> <div>\n> <b>bold\n> </div>\n\n- <pre> in a list\n- next\n\n${PROSE}`,
  footnotes: `Text[^1] and [ref][1].\n\n<pre> stray.\n\n[^1]: The note\n\n[1]: https://example.com/x\n\n${PROSE}`,
  unknown: `<DETAILS>x</DETAILS> and <Br> and <your-token>\n\n<your-token>\n\n${PROSE}`,
};

describe('streamingBlocks with a cache', () => {
  it('gives what the whole text gives, for every prefix of a reply as it is written', () => {
    for (const [name, text] of Object.entries(DOCUMENTS)) {
      const cache = newStreamingCache();
      for (let end = 1; end <= text.length; end += end < 60 ? 1 : 7) {
        const prefix = text.slice(0, end);
        expect(streamingBlocks(prefix, cache), `${name} at ${end}: ${JSON.stringify(prefix.slice(-40))}`).toEqual(streamingBlocksFresh(prefix));
      }
      expect(streamingBlocks(text, cache), name).toEqual(streamingBlocksFresh(text));
    }
  });

  it('starts again when the text is not the one it kept going on from', () => {
    const cache = newStreamingCache();
    streamingBlocks(DOCUMENTS.prose!, cache);
    expect(streamingBlocks(DOCUMENTS.details!, cache)).toEqual(streamingBlocksFresh(DOCUMENTS.details!));
    expect(streamingBlocks('Short.', cache)).toEqual(streamingBlocksFresh('Short.'));
  });

  it('keeps the blocks before the last when a block is still open, and gives the same blocks', () => {
    const cache = newStreamingCache();
    const text = DOCUMENTS.unclosedForLong!;
    // The div is open for most of the text: nothing after it is kept, and the result is still the same.
    for (const end of [10, 40, 200, 400, text.length - 20]) expect(streamingBlocks(text.slice(0, end), cache)).toEqual(streamingBlocksFresh(text.slice(0, end)));
    expect(cache.raw.length).toBeLessThan(text.indexOf('<div>') + 10);
  });

  it('is fast on a long reply with many generics, one delta at a time', () => {
    const base = PROSE.repeat(Math.ceil(45_000 / PROSE.length));
    const cache = newStreamingCache();
    streamingBlocks(base, cache);
    const deltas = 120;
    const tail = 'More text here with Promise<void> and a <b>bold</b> word, then a new paragraph.\n\n'.repeat(4);
    let text = base;
    const started = performance.now();
    for (let i = 0; i < deltas; i++) {
      text += tail.slice((i * 7) % tail.length, ((i + 1) * 7) % tail.length || undefined);
      streamingBlocks(text, cache);
    }
    const each = (performance.now() - started) / deltas;
    console.log(`streaming, ${base.length} characters: ${each.toFixed(2)} ms per delta`);
    // Without the cache this is about 300 ms; the limit is generous, for slow runners.
    expect(each).toBeLessThan(25);
  });
});
