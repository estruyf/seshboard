import { Lexer } from 'marked';
import type { DisplayItem } from './displayItems.ts';
import { activitySummary } from './toolSummary.ts';
import type { Turn } from './turns.ts';

/**
 * What reading mode shows for a reply: one turn's output as text blocks with the tool calls between them, plus the
 * outline, the word count and the neighbours. Pure, so it can be tested without a DOM; the view only draws it.
 */

export type ReadBlock =
  /** A top-level assistant text item. Code and tables stay inside its Markdown. */
  | { kind: 'text'; key: string; text: string }
  /** A run of tool calls (and what subagents did) between two texts. */
  | { kind: 'tools'; key: string; items: DisplayItem[] };

export interface OutlineEntry {
  /** The id the view gives the heading in the DOM. Unique within the reply. */
  id: string;
  level: 1 | 2 | 3;
  text: string;
  /** The key of the text block the heading is in. */
  block: string;
}

export interface ReadReply {
  turnKey: string;
  /** 0-based among the replies that have text. */
  index: number;
  /** Replies with text in the session. */
  total: number;
  blocks: ReadBlock[];
  /** Every tool item of the turn, subagents' included. */
  tools: DisplayItem[];
  /** `activitySummary(tools)`; empty when there are none. */
  toolSummary: string;
  outline: OutlineEntry[];
  words: number;
  minutes: number;
  /** The turn key of the previous reply with text, null at the first. */
  previous: string | null;
  next: string | null;
}

/** An average reading speed, in words a minute. */
const WORDS_PER_MINUTE = 230;
/** Headings deeper than this are not in the outline. */
const OUTLINE_DEPTH = 3;
/** The key of the block made from the text Claude is still writing. */
export const STREAMING_BLOCK = 'streaming';

const isReplyText = (item: DisplayItem) => item.kind === 'text' && !item.subagent;

/** The replies of a session that can be read: turns with at least one top-level text item. */
export function readableTurns(items: readonly DisplayItem[], turns: readonly Turn[]): Turn[] {
  return turns.filter((turn) => {
    for (let i = turn.start + 1; i <= turn.end; i++) if (isReplyText(items[i]!)) return true;
    return false;
  });
}

/**
 * The reply of the turn with `turnKey`, or null when it has no text (nothing to read, so no Read button).
 * `streamingText`: what Claude is writing now. It belongs to the last turn and is added as a final block, so the
 * outline and the word count follow the headings as they arrive.
 */
export function readReply(items: readonly DisplayItem[], turns: readonly Turn[], turnKey: string, streamingText?: string | null): ReadReply | null {
  const turn = turns.find((t) => t.key === turnKey);
  if (!turn) return null;

  const blocks: ReadBlock[] = [];
  const tools: DisplayItem[] = [];
  let run: DisplayItem[] = [];
  const flush = () => {
    if (run.length) blocks.push({ kind: 'tools', key: `tools-${run[0]!.key}`, items: run });
    run = [];
  };
  // The prompt itself (`turn.start`) is not part of the reply.
  for (let i = turn.start + 1; i <= turn.end; i++) {
    const item = items[i]!;
    if (item.kind === 'text' && !item.subagent) {
      flush();
      blocks.push({ kind: 'text', key: item.key, text: item.text });
    } else if (item.kind === 'tool') {
      tools.push(item);
      run.push(item);
    } else if ('subagent' in item && item.subagent) {
      // A subagent's own words belong to the turn it ran in, with the tool calls.
      run.push(item);
    }
    // Thinking, notices and commands are not part of what is read.
  }
  flush();

  const streaming = streamingText && turns.at(-1)?.key === turnKey ? streamingText : null;
  if (streaming) blocks.push({ kind: 'text', key: STREAMING_BLOCK, text: streaming });
  if (!blocks.some((b) => b.kind === 'text')) return null;

  const readable = readableTurns(items, turns);
  const at = readable.findIndex((t) => t.key === turnKey);
  // A turn that only has streaming text so far isn't in the list yet; it comes last.
  const total = at === -1 ? readable.length + 1 : readable.length;
  const index = at === -1 ? readable.length : at;
  const words = blocks.reduce((sum, b) => sum + (b.kind === 'text' ? countWords(b.text) : 0), 0);

  return {
    turnKey,
    index,
    total,
    blocks,
    tools,
    toolSummary: tools.length ? activitySummary(tools) : '',
    outline: replyOutline(blocks),
    words,
    minutes: words === 0 ? 0 : Math.max(1, Math.ceil(words / WORDS_PER_MINUTE)),
    previous: readable[index - 1]?.key ?? null,
    next: readable[index + 1]?.key ?? null,
  };
}

type Token = { type: string; raw: string; text?: string; depth?: number; tokens?: Token[] };

/** Lexes like the renderer does; text the lexer can't read is one paragraph, so nothing throws in the view. */
function lex(text: string): Token[] {
  try {
    return Lexer.lex(text, { gfm: true }) as Token[];
  } catch {
    return [{ type: 'paragraph', raw: text, text }];
  }
}

/** The plain text of inline tokens: `**Bold** and `code`` reads as "Bold and code". */
function plain(tokens: readonly Token[] | undefined, fallback: string): string {
  if (!tokens?.length) return fallback;
  return tokens.map((t) => (t.tokens ? plain(t.tokens, t.text ?? t.raw) : (t.text ?? t.raw))).join('');
}

/** `slug('Why it works!')` is `why-it-works`. Empty when nothing letter-like is left. */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The headings of level 1 to 3 in the text blocks, in order. Only the lexer's top-level heading tokens count, so a
 * `#` inside a code block, a quote or a list is never an entry. Repeated titles get `-2`, `-3`.
 */
export function replyOutline(blocks: readonly ReadBlock[]): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  const seen = new Map<string, number>();
  for (const block of blocks) {
    if (block.kind !== 'text') continue;
    for (const token of lex(block.text)) {
      if (token.type !== 'heading' || !token.depth || token.depth > OUTLINE_DEPTH) continue;
      const text = plain(token.tokens, token.text ?? '').trim();
      const base = slug(text) || 'section';
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      entries.push({ id: n === 1 ? base : `${base}-${n}`, level: token.depth as 1 | 2 | 3, text, block: block.key });
    }
  }
  return entries;
}

/** Prose words only: fenced and indented code is left out, and so is the address of a link. */
export function countWords(markdown: string): number {
  let words = 0;
  for (const token of lex(markdown)) {
    if (token.type === 'code') continue;
    const prose = token.raw.replace(/\]\([^)\s]*\)/g, ']').replace(/https?:\/\/\S+/g, ' ');
    words += prose.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
  }
  return words;
}

/**
 * The heading the reader is at: the last one whose top is at or above `scrollTop` plus `offset` (so a heading counts
 * a little before it reaches the top edge). -1 before the first. `tops` are the headings' offsets in the scroller,
 * in reading order.
 */
export function currentHeading(tops: readonly number[], scrollTop: number, offset = 80): number {
  let current = -1;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i]! <= scrollTop + offset) current = i;
    else break;
  }
  return current;
}
