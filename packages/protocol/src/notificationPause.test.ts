import { describe, expect, it } from 'vitest';
import { isPaused, NOTIFICATION_PAUSES, pauseUntil } from './notificationPause.ts';

describe('notification pauses', () => {
  const now = new Date(2026, 10, 2, 22, 30);
  it('ends an hour or three later, or the next morning at 8', () => {
    expect(NOTIFICATION_PAUSES.map((p) => p.id)).toEqual(['1h', '3h', 'tomorrow']);
    expect(pauseUntil('1h', now)).toBe(now.getTime() + 3_600_000);
    expect(pauseUntil('3h', now)).toBe(now.getTime() + 3 * 3_600_000);
    expect(pauseUntil('tomorrow', now)).toBe(new Date(2026, 10, 3, 8).getTime());
    // Just after midnight, tomorrow is still the next day's morning.
    expect(pauseUntil('tomorrow', new Date(2026, 10, 3, 0, 15))).toBe(new Date(2026, 10, 4, 8).getTime());
  });
  it('counts a pause that ended as none', () => {
    expect(isPaused(null, 5)).toBe(false);
    expect(isPaused(10, 5)).toBe(true);
    expect(isPaused(10, 10)).toBe(false);
  });
});
