import type { DriverEvents } from '../provider.ts';
import type { ServerNotification } from './protocol.ts';

/**
 * One running Codex thread's notifications as the events a Claude Code session reports: stream deltas while a reply or
 * a tool runs, complete messages as items finish (built as `codexMessages` builds them, with the same ids, so the live
 * transcript and the one read later agree), the turn's state, the context meter and the model.
 */
export class CodexLive {
  constructor(
    readonly threadId: string,
    private readonly events: DriverEvents,
  ) {}

  /** One notification Codex sent; those about other threads are ignored. */
  handle(_notification: ServerNotification): void {
    void this.events;
    throw new Error('CodexLive.handle: not built yet');
  }
}
