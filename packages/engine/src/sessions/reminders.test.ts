import { describe, expect, it } from 'vitest';
import type { CompanionStatus } from '@seshboard/protocol';
import { BreakThrough, dueNow, MISSED_AFTER_MS } from './reminders.ts';

describe('reminders', () => {
  it('comes due oldest first, and says when one was missed (closed, or asleep)', () => {
    const now = 10 * 60 * 60_000;
    expect(dueNow([{ sessionId: 'b', remindAt: now - 30_000 }, { sessionId: 'a', remindAt: now - 2 * 60 * 60_000 }], now)).toEqual([
      { sessionId: 'a', remindAt: now - 2 * 60 * 60_000, missed: true },
      { sessionId: 'b', remindAt: now - 30_000, missed: false },
    ]);
    expect(dueNow([{ sessionId: 'c', remindAt: now - MISSED_AFTER_MS }], now)[0]!.missed).toBe(false);
  });

  it('lets needs you, a failure or working break through, only when it starts, and not plain activity', () => {
    const watch = new BreakThrough();
    const status = new Map<string, CompanionStatus>([['a', 'idle'], ['b', 'error'], ['c', 'stopped']]);
    const of = (id: string) => status.get(id)!;
    expect(watch.check(['a', 'b', 'c'], of)).toEqual([]);
    // Snoozed while failed: it stays snoozed. New activity (unread) doesn't wake anything.
    status.set('c', 'unread');
    expect(watch.check(['a', 'b', 'c'], of)).toEqual([]);
    status.set('a', 'needs-you');
    status.set('c', 'working');
    expect(watch.check(['a', 'b', 'c'], of)).toEqual(['a', 'c']);
    // Snoozed again later: it starts from where it is.
    expect(watch.check(['a'], of)).toEqual([]);
  });
});
