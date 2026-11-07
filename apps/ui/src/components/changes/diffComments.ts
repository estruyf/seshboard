import type { ContextItem } from '@seshboard/protocol/client';
import type { UnifiedRow } from '../../lib/unifiedDiff.ts';
import { fenceFor } from '../composer/contextItems.ts';

type LineRow = Extract<UnifiedRow, { kind: 'add' | 'del' | 'same' }>;

/** A line a comment quotes, as the diff showed it. */
export interface QuotedLine {
  kind: LineRow['kind'];
  text: string;
}

/**
 * A comment on lines of a diff in Changes. Deleted lines have only an old line number, so a comment on them alone
 * counts on the `old` side; any other selection counts lines of the file as it is now (`new`).
 */
export interface DiffComment {
  id: string;
  /** The checkout the file is in. */
  root: string;
  /** The file as git lists it: relative to the checkout's root, with `/`. */
  path: string;
  side: 'old' | 'new';
  start: number;
  end: number;
  /** The lines it was written on, so it can follow them when Claude's edits move them. */
  lines: QuotedLine[];
  body: string;
}

/** Lines picked in a diff, before the comment on them is written. */
export type CommentTarget = Pick<DiffComment, 'side' | 'start' | 'end' | 'lines'>;

/** At most this many quoted lines of a comment go in the message; the rest are counted. */
export const MAX_QUOTED_LINES = 40;
/** A comment holds at most this many characters. */
export const MAX_COMMENT_LENGTH = 5_000;

const isLine = (row: UnifiedRow): row is LineRow => row.kind === 'add' || row.kind === 'del' || row.kind === 'same';
const lineOn = (row: LineRow, side: DiffComment['side']) => (side === 'old' ? row.oldLine : row.newLine);

/** The side and line range of some diff rows, or null when none of them is a line. */
function targetOf(lines: readonly LineRow[]): CommentTarget | null {
  if (lines.length === 0) return null;
  const side = lines.every((row) => row.kind === 'del') ? 'old' : 'new';
  const numbers = lines.map((row) => lineOn(row, side)).filter((n): n is number => n !== null);
  return { side, start: Math.min(...numbers), end: Math.max(...numbers), lines: lines.map(({ kind, text }) => ({ kind, text })) };
}

/** The lines from row `from` to row `to` (either way round, both included), leaving out hunk headers and notes. */
export function targetFromRows(rows: readonly UnifiedRow[], from: number, to: number): CommentTarget | null {
  const [first, last] = from <= to ? [from, to] : [to, from];
  return targetOf(rows.slice(Math.max(0, first), last + 1).filter(isLine));
}

/** A quoted deleted line matches only a deleted one; a quoted added or unchanged line either (the base may differ). */
const sameLine = (quoted: QuotedLine, row: LineRow) => quoted.text === row.text && (quoted.kind === 'del') === (row.kind === 'del');

/**
 * Where a comment's lines are in a diff now: the rows they span (the comment shows under the last), with their line
 * numbers. When the lines are in more than one place, the one nearest the comment's own line wins; when they are gone,
 * null (the comment is stale).
 */
export function anchorOf(comment: Pick<DiffComment, 'side' | 'start' | 'lines'>, rows: readonly UnifiedRow[]): { first: number; last: number; start: number; end: number } | null {
  const indexes = rows.flatMap((row, i) => (isLine(row) ? [i] : []));
  const n = comment.lines.length;
  let best: { first: number; last: number; start: number; end: number; distance: number } | null = null;
  for (let i = 0; i + n <= indexes.length; i++) {
    const span = indexes.slice(i, i + n).map((index) => rows[index] as LineRow);
    if (!comment.lines.every((quoted, k) => sameLine(quoted, span[k]!))) continue;
    const target = targetOf(span);
    if (!target) continue;
    const distance = Math.abs(target.start - comment.start) + (target.side === comment.side ? 0 : 1);
    if (!best || distance < best.distance) best = { first: indexes[i]!, last: indexes[i + n - 1]!, start: target.start, end: target.end, distance };
  }
  if (!best) return null;
  const { distance: _, ...anchor } = best;
  return anchor;
}

/** "line 12" or "lines 12-15". */
export const linesLabel = (comment: Pick<DiffComment, 'start' | 'end'>) => (comment.start === comment.end ? `line ${comment.start}` : `lines ${comment.start}-${comment.end}`);

/** Where a comment points, for its header and the message: "src/auth.ts, lines 12-15", deleted lines said so. */
export const whereLabel = (comment: Pick<DiffComment, 'path' | 'side' | 'start' | 'end'>, path = comment.path) =>
  `${path}, ${comment.side === 'old' ? `deleted ${linesLabel(comment)} (numbered as before the change)` : linesLabel(comment)}`;

const SIGN: Record<QuotedLine['kind'], string> = { add: '+', del: '-', same: ' ' };

/** The quoted lines as a diff, cut to `MAX_QUOTED_LINES`. */
function quoteOf(lines: readonly QuotedLine[]): string {
  const shown = lines.slice(0, MAX_QUOTED_LINES).map((line) => `${SIGN[line.kind]}${line.text}`);
  const more = lines.length - shown.length;
  return more > 0 ? `${shown.join('\n')}\n… ${more} more ${more === 1 ? 'line' : 'lines'}` : shown.join('\n');
}

/** Comments in the order of the files, then of their lines. */
export const sortComments = (comments: readonly DiffComment[]) =>
  [...comments].sort((a, b) => a.path.localeCompare(b.path) || a.start - b.start || (a.side === b.side ? 0 : a.side === 'old' ? -1 : 1));

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** "3 comments on 2 files". */
export function reviewSummary(comments: readonly Pick<DiffComment, 'path'>[]): string {
  const files = new Set(comments.map((c) => c.path)).size;
  return `${count(comments.length, 'comment', 'comments')} on ${count(files, 'file', 'files')}`;
}

/**
 * What Submit puts in the message box: a short prompt, and every comment in one text item (one chip per comment
 * would run into the box's limit of chips), each with its file, its lines and the code it quotes. `pathFor` writes a
 * comment's file as the session sees it (relative to its folder).
 */
export function reviewDraft(comments: readonly DiffComment[], pathFor: (comment: DiffComment) => string = (comment) => comment.path): { text: string; item: Extract<ContextItem, { kind: 'text' }> } {
  const sections = sortComments(comments).map((comment) => {
    const quote = quoteOf(comment.lines);
    const fence = fenceFor(quote);
    return `## ${whereLabel(comment, pathFor(comment))}\n\n${fence}diff\n${quote}\n${fence}\n\n${comment.body.trim()}`;
  });
  const text = comments.length === 1 ? 'Address my review comment on the changes.' : 'Address my review comments on the changes, one by one.';
  return { text, item: { kind: 'text', source: 'review', label: `Review: ${reviewSummary(comments)}`, text: sections.join('\n\n'), language: 'markdown' } };
}
