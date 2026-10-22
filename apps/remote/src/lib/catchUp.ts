import type { CatchUp } from '@switchboard/protocol/remote-client';

/**
 * The catch-up card's wording, the same as the desktop's (apps/ui `catchUpModel.ts`), so a finished session reads
 * the same on both. Pure, with tests.
 */

export type CatchUpTone = 'unread' | 'error' | 'ok' | 'neutral';

/** "Finished", "Finished with errors", or "Committed" after a commit from here. */
export function stateLabel(card: CatchUp, committed = false): { label: string; tone: CatchUpTone } {
  if (committed) return { label: 'Committed', tone: 'ok' };
  if (card.state === 'error') return { label: 'Finished with errors', tone: 'error' };
  return { label: 'Finished', tone: 'unread' };
}

/** "~2 min to review", or "Nothing to review" when the turn needs nothing from you. */
export const reviewLabel = (card: CatchUp) => (card.need.kind === 'none' ? 'Nothing to review' : `~${card.reviewMinutes} min to review`);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The chips: the tests always, the diff's size when there is one. */
export function catchUpChips(card: CatchUp): Array<{ id: 'tests' | 'diff'; text: string; tone: CatchUpTone }> {
  const { tests, diff } = card.signals;
  const chips: Array<{ id: 'tests' | 'diff'; text: string; tone: CatchUpTone }> = [];
  if (tests.state === 'passed') chips.push({ id: 'tests', text: tests.passed ? `${plural(tests.passed, 'test')} passed` : 'Tests passed', tone: 'ok' });
  else if (tests.state === 'failed') {
    const total = (tests.passed ?? 0) + (tests.failed ?? 0);
    chips.push({ id: 'tests', text: tests.failed ? `${tests.failed} of ${total} ${total === 1 ? 'test fails' : 'tests fail'}` : 'Tests failed', tone: 'error' });
  } else chips.push({ id: 'tests', text: 'No tests run', tone: 'neutral' });
  if (diff && diff.files > 0) chips.push({ id: 'diff', text: `+${diff.add} −${diff.del} · ${plural(diff.files, 'file')}`, tone: 'neutral' });
  return chips;
}

/** A catch-up worth a card: a turn that ended (not one that waits for you), while Claude isn't working, in the background either. */
export const showsCatchUp = (card: CatchUp | null, working: boolean, waiting: boolean): card is CatchUp => Boolean(card && card.state !== 'waiting' && !working && !waiting);

/** The commit message to start from: the ask that started the work, on one line. */
export function commitTitle(card: CatchUp | null): string {
  const line = (card?.ask ?? '').split('\n')[0]!.trim().replace(/[.\s]+$/, '');
  return line.length > 72 ? `${line.slice(0, 71).trimEnd()}…` : line;
}

/** A commit hash in a line: 7 to 40 hex characters, with a digit and a letter (so not a number or a word). */
const HASH = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g;

/** A line of What it did in parts, the commit hashes apart, so they show in mono ("Committed it as 5ea17e39"). */
export function withHashes(line: string): Array<{ text: string; hash: boolean }> {
  const parts: Array<{ text: string; hash: boolean }> = [];
  let at = 0;
  for (const match of line.matchAll(HASH)) {
    if (match.index > at) parts.push({ text: line.slice(at, match.index), hash: false });
    parts.push({ text: match[0], hash: true });
    at = match.index + match[0].length;
  }
  if (at < line.length) parts.push({ text: line.slice(at), hash: false });
  return parts;
}
