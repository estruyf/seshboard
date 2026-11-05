import type { CatchUp, CatchUpTests } from '@seshboard/protocol/client';
import { diffLines } from 'diff';
import type { DisplayItem } from './displayItems.ts';
import { editHunks } from './toolSummary.ts';
import { formatTurnDuration } from './turnFormat.ts';
import { claudeMs, type Turn } from './turns.ts';

/**
 * Skim (Settings › Conversation): the same conversation with less to read once a turn has finished. Which messages fold
 * and the numbers above the reply are worked out here, from the turn's items; which sentences fade is in `skimFade.ts`.
 */

/**
 * The messages that fold into the activity group: Claude's messages with a tool call after them in a finished turn. The
 * turn's last reply never folds, nor does an API error, and an open turn stays as it is so text doesn't move under you.
 */
export function foldedMessages(items: readonly DisplayItem[], turns: readonly Turn[], openTurn: Turn | null): ReadonlySet<string> {
  const folded = new Set<string>();
  for (const turn of turns) {
    if (turn === openTurn) continue;
    let toolAfter = false;
    for (let i = turn.end; i > turn.start; i--) {
      const item = items[i]!;
      if (item.kind === 'tool' && !item.subagent) toolAfter = true;
      else if (item.kind === 'text' && !item.subagent && toolAfter && item.key !== turn.replyKey && !item.failed) folded.add(item.key);
    }
  }
  return folded;
}

/** A group with folded messages in it: "3 messages and 9 steps". */
export function foldedLabel(messages: number, steps: number): string {
  const said = messages === 1 ? '1 message' : `${messages} messages`;
  return steps === 0 ? said : `${said} and ${steps === 1 ? '1 step' : `${steps} steps`}`;
}

export interface TurnStats {
  added: number;
  removed: number;
  files: number;
  /** Null when the turn's tests aren't known (see `latestTests`). */
  tests: CatchUpTests | null;
  durationMs: number | null;
}

/** What a turn changed, from its file tools that went through; a declined or failed edit changed nothing. */
export function turnStats(items: readonly DisplayItem[], turn: Turn, tests: CatchUpTests | null): TurnStats {
  let added = 0;
  let removed = 0;
  const files = new Set<string>();
  for (let i = turn.start; i <= turn.end; i++) {
    const item = items[i]!;
    if (item.kind !== 'tool' || !item.result || item.result.isError) continue;
    const hunks = editHunks(item);
    if (!hunks) continue;
    const input = (item.input ?? {}) as { file_path?: unknown; notebook_path?: unknown };
    files.add(String(input.file_path ?? input.notebook_path ?? ''));
    for (const { before, after } of hunks) {
      for (const part of diffLines(before, after)) {
        if (part.added) added += part.count;
        else if (part.removed) removed += part.count;
      }
    }
  }
  return { added, removed, files: files.size, tests, durationMs: claudeMs(turn) };
}

/**
 * The tests of the latest turn, from its catch-up card. The engine keeps one card per session, so an older turn's are
 * gone and its line leaves them out; the card names the turn's last message, in case it is still the turn before.
 */
export function latestTests(card: Pick<CatchUp, 'turnId' | 'signals'> | null, items: readonly DisplayItem[], turn: Turn | undefined): { turn: Turn; tests: CatchUpTests } | null {
  if (!card || !turn) return null;
  for (let i = turn.end; i >= turn.start; i--) {
    if (items[i]!.key.split(':')[0] === card.turnId) return { turn, tests: card.signals.tests };
  }
  return null;
}

export interface StatPart {
  key: string;
  text: string;
  tone: 'ok' | 'error' | null;
}

function testsPart(tests: CatchUpTests | null): StatPart | null {
  if (tests?.state === 'passed') return { key: 'tests', text: 'tests pass', tone: 'ok' };
  if (tests?.state !== 'failed') return null;
  const failed = tests.failed ?? 0;
  return { key: 'tests', text: failed === 0 ? 'tests fail' : failed === 1 ? '1 test fails' : `${failed} tests fail`, tone: 'error' };
}

/**
 * The stats line, part by part: "+42 −7 · 3 files · 2 tests fail · 4m 12s". Empty for a turn that changed nothing and ran
 * no tests: a time alone isn't worth a line, and the row under the reply has it.
 */
export function statParts(stats: TurnStats): StatPart[] {
  const tests = testsPart(stats.tests);
  if (stats.files === 0 && !tests) return [];
  const parts: StatPart[] = [];
  if (stats.added > 0) parts.push({ key: 'added', text: `+${stats.added}`, tone: 'ok' });
  if (stats.removed > 0) parts.push({ key: 'removed', text: `−${stats.removed}`, tone: 'error' });
  if (stats.files > 0) parts.push({ key: 'files', text: stats.files === 1 ? '1 file' : `${stats.files} files`, tone: null });
  if (tests) parts.push(tests);
  if (stats.durationMs !== null) parts.push({ key: 'duration', text: formatTurnDuration(stats.durationMs), tone: null });
  return parts;
}
