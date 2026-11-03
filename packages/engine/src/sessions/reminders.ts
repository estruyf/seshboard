/**
 * Remind me later (session triage): when snoozed sessions come back, and what brings one back early. Pure, so a fake
 * clock can test it; the engine checks every minute, after the first scan (reminders missed while Seshboard was
 * closed), when a window comes to the front (the computer woke) and right after a reminder is set.
 */
import type { CompanionStatus } from '@seshboard/protocol';

/** A reminder this late was missed (Seshboard closed, the computer asleep): it says when it was for. */
export const MISSED_AFTER_MS = 2 * 60_000;

export interface DueReminder {
  sessionId: string;
  remindAt: number;
  missed: boolean;
}

/** The reminders that come due now, oldest first, each saying whether it was missed. */
export function dueNow(due: readonly { sessionId: string; remindAt: number }[], now: number): DueReminder[] {
  return [...due].sort((a, b) => a.remindAt - b.remindAt).map((d) => ({ ...d, missed: now - d.remindAt > MISSED_AFTER_MS }));
}

/** What breaks through a reminder: Claude needs you, failed, or works there. Plain new activity doesn't. */
const LOUD: ReadonlySet<CompanionStatus> = new Set<CompanionStatus>(['needs-you', 'working', 'error']);

/**
 * Notices which snoozed sessions start to need you, fail or work: those drop their reminder. Only a change counts, so a
 * session you snooze while it shows a failure stays snoozed.
 */
export class BreakThrough {
  private readonly last = new Map<string, CompanionStatus>();

  /** The snoozed sessions to wake now, from each one's status. */
  check(snoozed: readonly string[], statusOf: (sessionId: string) => CompanionStatus): string[] {
    const wake: string[] = [];
    const ids = new Set(snoozed);
    for (const id of [...this.last.keys()]) if (!ids.has(id)) this.last.delete(id);
    for (const id of snoozed) {
      const status = statusOf(id);
      const before = this.last.get(id);
      this.last.set(id, status);
      if (before !== undefined && LOUD.has(status) && !LOUD.has(before)) wake.push(id);
    }
    for (const id of wake) this.last.delete(id);
    return wake;
  }
}
