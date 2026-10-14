import type { TerminalInfo } from '@switchboard/protocol/client';

/** Said in the panel of a session whose terminals went with an engine restart. */
export const ENGINE_RESTARTED_MESSAGE = "Switchboard's engine restarted, so its terminals were closed.";

/**
 * The sessions that had terminals before a reconnect and lost some of them in the engine's first list
 * after it: a restarted engine starts with none, so their shells, scrollback and running actions are gone.
 * Terminals without a session are left out (there is no panel to say it in).
 */
export function sessionsWithLostTerminals(before: Iterable<Pick<TerminalInfo, 'id' | 'sessionId'>>, after: readonly Pick<TerminalInfo, 'id'>[]): string[] {
  const still = new Set(after.map((t) => t.id));
  const lost = new Set<string>();
  for (const terminal of before) {
    if (terminal.sessionId && !still.has(terminal.id)) lost.add(terminal.sessionId);
  }
  return [...lost];
}
