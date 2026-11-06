import { codexItemId, ID_JOIN } from './codexEvents.ts';
import type { Turn } from './protocol.ts';

/**
 * The turn a fork "up to and including" a message keeps through (`thread/fork`'s `lastTurnId`). Codex forks only at the
 * end of a turn, so a message in the middle of one (your prompt, a tool call, a reply before the last) keeps its whole
 * turn. Edit and resend forks at the message before your prompt, which is in the turn before, so the prompt's own turn
 * is left out. Messages are named `<turn>~<item>…` (`codexItemId`); the turn is found by that first part among the
 * thread's turns. Null for an id of no turn here (a note Seshboard kept, a message of another thread).
 */
export function codexForkTurn(turns: readonly Turn[], messageId: string): string | null {
  const prefix = messageId.split(ID_JOIN)[0];
  if (!prefix) return null;
  // The turn's part of an id is written as `codexItemId` writes it (a `:` in Codex's id becomes `_`).
  const found = turns.find((turn) => typeof turn.id === 'string' && codexItemId(turn.id, '').slice(0, -ID_JOIN.length) === prefix);
  return found?.id ?? null;
}

/**
 * Where Edit and resend forks for a prompt (`promptId`): through the turn before the prompt's own, so the fork ends just
 * before it. A prompt sent into a running turn (steered) isn't where a turn starts, and Codex forks only where one
 * ends: no fork is just before it, so it is refused, as is the thread's first prompt (nothing before it to keep).
 */
export function codexEditTurn(turns: readonly Turn[], promptId: string): string {
  const turnId = codexForkTurn(turns, promptId);
  const index = turnId === null ? -1 : turns.findIndex((t) => t.id === turnId);
  const turn = turns[index];
  if (!turn) throw new Error('Codex can only fork at one of its own messages');
  const first = turn.items.find((item) => item.type === 'userMessage');
  if (!first || codexItemId(turn.id, first.id) !== promptId) throw new Error('This message was sent while Codex was working, so a fork can’t end just before it. Fork from a reply instead.');
  const before = turns[index - 1];
  if (!before) throw new Error('There is nothing before the first message to keep: start a new session instead.');
  return before.id;
}
