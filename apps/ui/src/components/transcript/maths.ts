import type { InlineMath } from 'mdast-util-math';
import { mathFromMarkdown } from 'mdast-util-math';
import { math } from 'micromark-extension-math';
import type { Code, Construct, Extension, State, TokenizeContext, Tokenizer } from 'micromark-util-types';
import type { Root } from 'mdast';
import type { Processor } from 'unified';

/**
 * Maths in Markdown: `$x^2$`, `$$ … $$` and a ```` ```math ```` block. It is `remark-math`'s syntax (its micromark and mdast
 * pieces), with one change: a single dollar opens a formula only the way Pandoc's does, so `it costs $5 and $10` stays text.
 *
 * - The opening `$` is followed by something that is not a space, and not `@`, `*`, `?` or `#` (`$@`, `$*`, `$?` and `$#`
 *   are shell). It doesn't come right after a letter or a digit either (not a Han, Hiragana, Katakana or Hangul one, which
 *   have no spaces): `df$col`, `10$-20$` and `a$b` are not formulas, `设$x$为` is.
 * - The closing `$` follows something that is not a space and is followed by a space, the end, punctuation or an operator
 *   (`$x$.`, `$x$)`, `$x$-axis`, `$a$+$b$`, `**$x$**`) or a Han, Hiragana, Katakana or Hangul character, never a Latin or
 *   other letter, a digit or `{` or `(`: `$5 and $10`, `$5-$10`, `$HOME/$USER` and `${A}/${B}` don't close. This costs
 *   `$n$th`; shell variables and prices are more common.
 * - A `$` that could only open another formula (after a space, before something that is not a space) means the first one
 *   was a price, so `costs $5 and $x$` still draws `$x$`.
 *
 * Two dollars or more (`$$ … $$`) keep `remark-math`'s rules: nobody writes a price that way.
 *
 * The nodes are `remark-math`'s: `inlineMath` becomes `<code class="language-math math-inline">` and a block
 * `<pre><code class="language-math math-display">`. They are drawn by `Maths.tsx`, with KaTeX loaded the first time.
 */

const DOLLAR = 36;
const SPACE = 32;

/** A space, a tab, a line ending or the end: where a formula can't start or stop. */
const blank = (code: Code): boolean => code === null || code < 0 || code === SPACE;
/** Han, Hiragana, Katakana and Hangul: written without spaces, so a formula sits right against them. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const cjk = (code: Code): boolean => code !== null && code > 0 && CJK.test(String.fromCodePoint(code));
/** A letter or a digit that is part of a word (so `df$col`, `10$`): not one of the scripts above. */
const wordy = (code: Code): boolean => code !== null && code > 0 && /[\p{L}\p{N}]/u.test(String.fromCodePoint(code)) && !cjk(code);
/** What may follow a closing `$`: the end of a sentence, a closing bracket or quote, a dash, an operator or a Markdown mark. */
const AFTER_CLOSE = '.,;:!?)]}"\'’”-–—…*_~<>|/+=×·»。，、；：！？）」』\u00a0';
const endsFormula = (code: Code): boolean => blank(code) || cjk(code) || (code !== null && AFTER_CLOSE.includes(String.fromCodePoint(code)));
/** A formula can't start with these: `$@`, `$*`, `$?` and `$#` are shell. */
const SHELL_FIRST = '@*?#';
/** The `$…$` construct of micromark-extension-math, with Pandoc's rules for a single dollar. */
function mathText(): Construct {
  const original = math().text![DOLLAR] as Construct;

  function tokenize(this: TokenizeContext, effects: Parameters<Tokenizer>[0], ok: State, nok: State): State {
    let sizeOpen = 0;
    let size = 0;
    let token: ReturnType<typeof effects.enter>;
    // The last thing read was a space or a line ending.
    let afterBlank = false;
    // The character before the opening `$`.
    const before = this.previous;
    return start;

    function start(code: Code) {
      effects.enter('mathText');
      effects.enter('mathTextSequence');
      return sequenceOpen(code);
    }

    function sequenceOpen(code: Code): State | undefined {
      if (code === DOLLAR) {
        effects.consume(code);
        sizeOpen++;
        return sequenceOpen;
      }
      effects.exit('mathTextSequence');
      // `$ ` and a `$` at the end of a line are a dollar sign.
      if (sizeOpen === 1 && (blank(code) || wordy(before) || SHELL_FIRST.includes(String.fromCodePoint(code!)))) return nok(code);
      return between(code);
    }

    function between(code: Code): State | undefined {
      if (code === null) return nok(code);
      if (code === DOLLAR) {
        token = effects.enter('mathTextSequence');
        size = 0;
        return sequenceClose(code);
      }
      if (code === SPACE) {
        effects.enter('space');
        effects.consume(code);
        effects.exit('space');
        afterBlank = true;
        return between;
      }
      if (code < 0) {
        effects.enter('lineEnding');
        effects.consume(code);
        effects.exit('lineEnding');
        afterBlank = true;
        return between;
      }
      effects.enter('mathTextData');
      afterBlank = false;
      return data(code);
    }

    function data(code: Code): State | undefined {
      if (code === null || code === SPACE || code === DOLLAR || code < 0) {
        effects.exit('mathTextData');
        return between(code);
      }
      effects.consume(code);
      return data;
    }

    function sequenceClose(code: Code): State | undefined {
      if (code === DOLLAR) {
        effects.consume(code);
        size++;
        return sequenceClose;
      }
      if (size === sizeOpen) {
        // A single dollar after a space, or before a letter, a digit or a bracket, is not the end: a price or a shell variable.
        if (sizeOpen === 1 && (afterBlank || !endsFormula(code))) return nok(code);
        effects.exit('mathTextSequence');
        effects.exit('mathText');
        return ok(code);
      }
      // More or fewer dollars than it opened with: part of the formula.
      token.type = 'mathTextData';
      return data(code);
    }
  }

  return { ...original, tokenize };
}

/** The micromark extension: `remark-math`'s block maths, and the text maths above. */
export function mathExtension(): Extension {
  return { flow: math().flow, text: { [DOLLAR]: mathText() } };
}

/** The remark plugin: maths in a reply and in a previewed file. Parse-only, so Skim's sentence count can use it too. */
export function remarkMaths(this: Processor) {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(mathExtension());
  (data.fromMarkdownExtensions ??= []).push(mathFromMarkdown());
  // `$$x$$` inside a line of text is shown big, on its own line, as `$$` asks for.
  return (tree: Root, file: { value: unknown }) => {
    const source = typeof file.value === 'string' ? file.value : '';
    const walk = (node: { type: string; children?: unknown[] }) => {
      if (node.type === 'inlineMath') {
        const math = node as InlineMath & { position?: { start: { offset?: number } } };
        const at = math.position?.start.offset;
        if (at !== undefined && source.startsWith('$$', at)) math.data = { ...math.data, hProperties: { className: ['language-math', 'math-inline', 'math-display-inline'] } };
      }
      for (const child of node.children ?? []) walk(child as { type: string; children?: unknown[] });
    };
    walk(tree);
  };
}

/** How a `code` element is maths: `inline` (`$x$`), `display` (`$$x$$` in a line of text) or `block` (`$$` on its own lines, a ```` ```math ```` block); null when it is not. */
export type MathKind = 'inline' | 'display' | 'block';

export function mathKind(className: string | undefined): MathKind | null {
  if (!className) return null;
  const classes = className.split(/\s+/);
  if (classes.includes('math-display-inline')) return 'display';
  if (classes.includes('math-inline')) return 'inline';
  return classes.includes('language-math') ? 'block' : null;
}

/** What a formula looked like in the text, for the moment it is not drawn (Claude is still writing it, or KaTeX isn't loaded yet). */
export function mathSourceText(kind: MathKind, source: string): string {
  return kind === 'inline' ? `$${source}$` : kind === 'display' ? `$$${source}$$` : source;
}

/** What a drawn formula copies as: its TeX in the delimiters it was written with (a block on lines of its own, as `$$` blocks are). */
export function mathCopyText(kind: MathKind, source: string): string {
  return kind === 'block' ? `$$\n${source}\n$$` : mathSourceText(kind, source);
}
