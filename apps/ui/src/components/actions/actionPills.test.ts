import { describe, expect, it } from 'vitest';
import { actionContextItems, fitActionPills, moveActionId, splitActionPills } from './actionPills.ts';

describe('fitActionPills', () => {
  const room = { gap: 6, more: 80, end: 26 };

  it('shows no pills without actions', () => {
    expect(fitActionPills([], { ...room, available: 500 })).toBe(0);
  });

  it('gives every action a pill when they all fit with the + after them', () => {
    // 3 × (100 + 6) + 26 = 344.
    expect(fitActionPills([100, 100, 100], { ...room, available: 344 })).toBe(3);
  });

  it('puts the ones that do not fit behind "N more", which takes its own room', () => {
    // 2 × (100 + 6) + 80 = 292 fits; a third pill does not.
    expect(fitActionPills([100, 100, 100], { ...room, available: 343 })).toBe(2);
    expect(fitActionPills([100, 100, 100], { ...room, available: 292 })).toBe(2);
    expect(fitActionPills([100, 100, 100], { ...room, available: 291 })).toBe(1);
  });

  it('keeps the order: a wide pill stops the row even when a narrower one after it would fit', () => {
    expect(fitActionPills([60, 300, 40], { ...room, available: 250 })).toBe(1);
  });

  it('shows only "N more" when not even one pill fits', () => {
    expect(fitActionPills([200, 100], { ...room, available: 120 })).toBe(0);
  });
});

describe('splitActionPills', () => {
  it('splits after the pills that fit', () => {
    expect(splitActionPills(['a', 'b', 'c', 'd', 'e'], 3)).toEqual({ pills: ['a', 'b', 'c'], more: ['d', 'e'] });
    expect(splitActionPills(['a', 'b'], 2)).toEqual({ pills: ['a', 'b'], more: [] });
    expect(splitActionPills(['a', 'b'], 0)).toEqual({ pills: [], more: ['a', 'b'] });
  });
});

describe('moveActionId', () => {
  it('moves an action to an index of the list without it', () => {
    expect(moveActionId(['a', 'b', 'c', 'd'], 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveActionId(['a', 'b', 'c', 'd'], 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveActionId(['a', 'b', 'c'], 'b', 9)).toEqual(['a', 'c', 'b']);
  });

  it('leaves the list as it is for an id it does not have', () => {
    expect(moveActionId(['a', 'b'], 'x', 0)).toEqual(['a', 'b']);
  });
});

describe('actionContextItems', () => {
  it('offers Run, Edit… and Delete…', () => {
    expect(actionContextItems()).toEqual([
      { command: 'run', label: 'Run' },
      { command: 'edit', label: 'Edit…' },
      { command: 'delete', label: 'Delete…', danger: true },
    ]);
  });
});
