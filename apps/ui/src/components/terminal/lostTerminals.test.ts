import { describe, expect, it } from 'vitest';
import { APP_TERMINAL } from './appTerminal.ts';
import { panelsWithLostTerminals } from './lostTerminals.ts';

describe('panelsWithLostTerminals', () => {
  it('lists each session that lost a terminal once', () => {
    const before = [
      { id: 't1', sessionId: 's1' },
      { id: 't2', sessionId: 's1' },
      { id: 't3', sessionId: 's2' },
    ];
    expect(panelsWithLostTerminals(before, [])).toEqual(['s1', 's2']);
  });

  it('leaves out sessions whose terminals are all still there', () => {
    const before = [
      { id: 't1', sessionId: 's1' },
      { id: 't2', sessionId: 's2' },
    ];
    expect(panelsWithLostTerminals(before, [{ id: 't1' }])).toEqual(['s2']);
  });

  it('says nothing when there were no terminals', () => {
    expect(panelsWithLostTerminals([], [])).toEqual([]);
  });

  it("puts a terminal without a session in the window's own panel", () => {
    expect(panelsWithLostTerminals([{ id: 't1', sessionId: null }, { id: 't2', sessionId: 's1' }], [])).toEqual([APP_TERMINAL, 's1']);
  });

  it('takes a map of the store', () => {
    const before = new Map([['t1', { id: 't1', sessionId: 's1' }]]);
    expect(panelsWithLostTerminals(before.values(), [{ id: 't9' }])).toEqual(['s1']);
  });
});
