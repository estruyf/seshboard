import type { TerminalInfo } from '@seshboard/protocol/client';
import { APP_TERMINAL } from './appTerminal.ts';

/** Said in the panel that lost its terminals to an engine restart. */
export const ENGINE_RESTARTED_MESSAGE = "Seshboard's engine restarted, so its terminals were closed.";

/**
 * The panels that had terminals before a reconnect and lost some of them in the engine's first list after it:
 * a restarted engine starts with none, so their shells, scrollback and running actions are gone. A panel is
 * keyed by its owner, as in the terminals store: the session's id, or `APP_TERMINAL` for a terminal without one.
 */
export function panelsWithLostTerminals(before: Iterable<Pick<TerminalInfo, 'id' | 'sessionId'>>, after: readonly Pick<TerminalInfo, 'id'>[]): string[] {
  const still = new Set(after.map((t) => t.id));
  const lost = new Set<string>();
  for (const terminal of before) {
    if (!still.has(terminal.id)) lost.add(terminal.sessionId ?? APP_TERMINAL);
  }
  return [...lost];
}
