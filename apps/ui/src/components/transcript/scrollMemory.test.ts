import { describe, expect, it } from 'vitest';
import { anchorAt, MAX_SPOTS, recallScroll, rememberScroll } from './scrollMemory.ts';

const rows = [
  { key: 'a', start: 16 },
  { key: 'b', start: 100 },
  { key: 'c', start: 400 },
];

describe('anchorAt', () => {
  it('finds the row that holds the top of the view, and how far into it', () => {
    expect(anchorAt(rows, 250)).toEqual({ key: 'b', offset: 150 });
    expect(anchorAt(rows, 100)).toEqual({ key: 'b', offset: 0 });
    expect(anchorAt(rows, 900)).toEqual({ key: 'c', offset: 500 });
  });

  it('uses the first row above the first message', () => {
    expect(anchorAt(rows, 0)).toEqual({ key: 'a', offset: 0 });
  });

  it('has nothing to anchor to in an empty list', () => {
    expect(anchorAt([], 120)).toBeNull();
  });
});

describe('rememberScroll', () => {
  const spot = (key: string) => ({ key, offset: 0, sizes: new Map<string, number>() });

  it('keeps a spot per session and forgets it when left at the end', () => {
    rememberScroll('s1', spot('x'));
    expect(recallScroll('s1')?.key).toBe('x');
    rememberScroll('s1', null);
    expect(recallScroll('s1')).toBeNull();
  });

  it('drops the oldest spot past the limit, counting a session left again as new', () => {
    for (let i = 0; i < MAX_SPOTS; i++) rememberScroll(`cap${i}`, spot(`k${i}`));
    rememberScroll('cap0', spot('again'));
    rememberScroll('one-more', spot('new'));
    expect(recallScroll('cap0')?.key).toBe('again');
    expect(recallScroll('cap1')).toBeNull();
    expect(recallScroll('one-more')?.key).toBe('new');
  });
});
