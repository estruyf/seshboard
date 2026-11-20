import type { TerminalInfo } from '@seshboard/protocol/client';

/** A dev server a session's terminal started, offered for the web preview. */
export interface ServerOffer {
  url: string;
  /** The terminal's tab title (the action's name, or the shell's). */
  title: string;
  terminalId: string;
}

/**
 * The servers running in a session's terminals, one offer per address (the first terminal that printed it wins), newest
 * terminal first. A terminal that exited offers nothing: its server is gone.
 */
export function sessionServerOffers(terminals: Iterable<TerminalInfo>, sessionId: string): ServerOffer[] {
  const running = [...terminals].filter((t) => t.sessionId === sessionId && t.exitCode === null && (t.urls?.length ?? 0) > 0).sort((a, b) => b.startedAt - a.startedAt);
  const seen = new Set<string>();
  const offers: ServerOffer[] = [];
  for (const terminal of running) {
    for (const url of terminal.urls ?? []) {
      if (seen.has(url)) continue;
      seen.add(url);
      offers.push({ url, title: terminal.title, terminalId: terminal.id });
    }
  }
  return offers;
}

/** The address a terminal offers first, while it runs: its tab and its action's pill show Open preview for it. */
export const terminalOffer = (terminal: TerminalInfo | undefined): string | null => (terminal && terminal.exitCode === null ? (terminal.urls?.[0] ?? null) : null);
