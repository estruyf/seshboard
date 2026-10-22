import { describe, expect, it } from 'vitest';
import { markReadDelay, SEEN_WHILE_LOOKING_MS, type MarkReadInput } from './markRead.ts';

const base: MarkReadInput = { unread: true, keptUnread: false, unreadWhenLooked: true, lookedFor: 0, setting: { enabled: true, seconds: 3 } };

describe('markReadDelay', () => {
  it('reads a session opened unread after the seconds you set', () => {
    expect(markReadDelay(base)).toBe(3000);
    expect(markReadDelay({ ...base, setting: { enabled: true, seconds: 10 } })).toBe(10_000);
  });

  it('counts the time you already looked', () => {
    expect(markReadDelay({ ...base, lookedFor: 1200 })).toBe(1800);
    expect(markReadDelay({ ...base, lookedFor: 5000 })).toBe(0);
  });

  it('leaves a session opened unread alone when the setting is off', () => {
    expect(markReadDelay({ ...base, setting: { enabled: false, seconds: 3 } })).toBeNull();
  });

  it('reads activity that arrives while you look almost at once, setting or not', () => {
    expect(markReadDelay({ ...base, unreadWhenLooked: false })).toBe(SEEN_WHILE_LOOKING_MS);
    expect(markReadDelay({ ...base, unreadWhenLooked: false, setting: { enabled: false, seconds: 3 } })).toBe(SEEN_WHILE_LOOKING_MS);
  });

  it('does nothing for a read session or one you marked as unread', () => {
    expect(markReadDelay({ ...base, unread: false })).toBeNull();
    expect(markReadDelay({ ...base, keptUnread: true })).toBeNull();
    expect(markReadDelay({ ...base, keptUnread: true, unreadWhenLooked: false })).toBeNull();
  });
});
