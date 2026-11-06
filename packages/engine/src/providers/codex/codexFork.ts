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
