import { describe, expect, it } from 'vitest';
import { sessionsWithLostTerminals } from './lostTerminals.ts';

describe('sessionsWithLostTerminals', () => {
  it('lists each session that lost a terminal once', () => {
    const before = [
      { id: 't1', sessionId: 's1' },
      { id: 't2', sessionId: 's1' },
      { id: 't3', sessionId: 's2' },
    ];
    expect(sessionsWithLostTerminals(before, [])).toEqual(['s1', 's2']);
  });

  it('leaves out sessions whose terminals are all still there', () => {
    const before = [
      { id: 't1', sessionId: 's1' },
      { id: 't2', sessionId: 's2' },
    ];
    expect(sessionsWithLostTerminals(before, [{ id: 't1' }])).toEqual(['s2']);
  });

  it('says nothing when there were no terminals, or none had a session', () => {
    expect(sessionsWithLostTerminals([], [])).toEqual([]);
    expect(sessionsWithLostTerminals([{ id: 't1', sessionId: null }], [])).toEqual([]);
  });

  it('takes a map of the store', () => {
    const before = new Map([['t1', { id: 't1', sessionId: 's1' }]]);
    expect(sessionsWithLostTerminals(before.values(), [{ id: 't9' }])).toEqual(['s1']);
  });
});
