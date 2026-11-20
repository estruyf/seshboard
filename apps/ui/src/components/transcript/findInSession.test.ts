import { describe, expect, it } from 'vitest';
import type { DisplayItem, RenderItem } from './displayItems.ts';
import { countOccurrences, findMatches, startMatch } from './findInSession.ts';

const text = (key: string, value: string): DisplayItem => ({ kind: 'text', key, at: null, text: value, subagent: false });
const user = (key: string, value: string): RenderItem => ({ kind: 'user', key, at: null, text: value, images: [], subagent: false });

describe('find in session', () => {
  it('counts case-insensitive occurrences without overlap', () => {
    expect(countOccurrences('Link test, link TEST', 'link')).toBe(2);
    expect(countOccurrences('aaaa', 'aa')).toBe(2);
    expect(countOccurrences('anything', '')).toBe(0);
  });

  it('lists every match top to bottom, skipping collapsed activity', () => {
    const items: RenderItem[] = [
      user('u1', 'Run the link test'),
      { kind: 'activity', key: 'activity:t1', items: [{ ...text('t0', 'link test inside a tool run'), subagent: true } as DisplayItem] },
      text('t1', 'The link test passed. Every link works.'),
      { kind: 'command', key: 'c1', at: null, name: '/links', args: '' },
    ];
    expect(findMatches(items, '  LINK ')).toEqual([
      { index: 0, nth: 0 },
      { index: 2, nth: 0 },
      { index: 2, nth: 1 },
      { index: 3, nth: 0 },
    ]);
    expect(findMatches(items, '   ')).toEqual([]);
  });

  it('finds plans', () => {
    const plan: RenderItem = { kind: 'tool', key: 'p', at: null, id: 'x', name: 'ExitPlanMode', input: { plan: 'Add a find bar' }, inputTruncated: false, result: null, subagent: false };
    expect(findMatches([plan], 'find bar')).toEqual([{ index: 0, nth: 0 }]);
  });

  it('starts at the first match in view, or the last one when all are above', () => {
    const matches = [{ index: 1, nth: 0 }, { index: 5, nth: 0 }, { index: 9, nth: 0 }];
    expect(startMatch(matches, 4)).toBe(1);
    expect(startMatch(matches, 0)).toBe(0);
    expect(startMatch(matches, 12)).toBe(2);
    expect(startMatch([], 0)).toBe(-1);
  });
});
