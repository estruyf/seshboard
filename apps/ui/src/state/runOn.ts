import { THIS_COMPUTER } from './remoteRows.ts';

/**
 * Where New session opens: on this computer, unless it is asked for the last choice (the sidebar's +) and that is
 * another computer with a prompt typed for it and not sent yet, which stays there to add to it.
 */
export function newSessionTarget(where: 'here' | 'last', last: string, hasDraft: (computerId: string) => boolean): string {
  if (where === 'here' || last === THIS_COMPUTER) return THIS_COMPUTER;
  return hasDraft(last) ? last : THIS_COMPUTER;
}
