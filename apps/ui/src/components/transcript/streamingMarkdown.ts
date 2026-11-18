import { Lexer } from 'marked';
import remend from 'remend';

/**
 * Splits Markdown into top-level blocks (paragraphs, lists, fences, tables…),
 * the way Streamdown does, so a streaming message only re-renders its last block.
 * Blank lines stay with the block before them; joining the blocks gives the text back.
 */
export function splitBlocks(text: string): string[] {
  let tokens: Array<{ type: string; raw: string }>;
  try {
    tokens = Lexer.lex(text, { gfm: true });
  } catch {
    return [text];
  }
  const blocks: string[] = [];
  const scan: MathScan = { fence: null, math: false };
  for (const token of tokens) {
    // Spacing and link definitions belong with what came before (a definition alone renders nothing), and so does
    // everything after a `$$` line nothing has closed yet: a formula can have a blank line in it.
    if (blocks.length && (token.type === 'space' || token.type === 'def' || scan.math)) blocks[blocks.length - 1] += token.raw;
    else blocks.push(token.raw);
    scanMath(token.raw, scan);
  }
  return blocks.length ? blocks : [text];
}

/** Where a reader of the text is: in a code fence (its mark and length) or in a `$$` block that nothing has closed yet. */
interface MathScan {
  fence: { mark: string; length: number } | null;
  math: boolean;
}

const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;
/** A `$$` line: it opens a block (its meta can't hold a `$`) and, with nothing after it, closes one. `pid $$ is…` and `$$x$$` aren't. */
const MATH_LINE = /^ {0,3}\$\$([^$]*)$/;

/** Reads lines (whole ones) and updates where the reader is: once for each, so a long reply isn't read again for every token. */
function scanMath(text: string, state: MathScan): void {
  for (const line of text.split('\n')) {
    if (state.math) {
      // Inside a `$$` block a fence is text; only a bare `$$` ends it.
      if (/^ {0,3}\$\$\s*$/.test(line)) state.math = false;
      continue;
    }
    const fence = FENCE_LINE.exec(line)?.[1];
    if (state.fence) {
      // Only a fence of the same mark, at least as long, ends it: a short one inside a longer one is text.
      if (fence && fence[0] === state.fence.mark && fence.length >= state.fence.length && /^[`~]+\s*$/.test(line.trim())) state.fence = null;
    } else if (fence) {
      state.fence = { mark: fence[0]!, length: fence.length };
    } else if (MATH_LINE.test(line)) {
      state.math = true;
    }
  }
}

/** Whether the text ends inside a `$$` block nothing closes: `$$` at the start of a line, outside code fences. */
export function opensMath(text: string): boolean {
  const state: MathScan = { fence: null, math: false };
  scanMath(text, state);
  return state.math;
}

/**
 * Closes what a half-written message leaves open (`**bold`, `` `code ``, `[link](ht`)
 * so it renders as formatted text instead of flashing raw markers. An unfinished
 * link shows as its text; an unfinished image stays as typed until it's complete.
 */
export function healMarkdown(text: string): string {
  return remend(text, { linkMode: 'text-only', images: false, inlineKatex: false, katex: false });
}
