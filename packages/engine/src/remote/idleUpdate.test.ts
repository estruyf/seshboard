import { describe, expect, it } from 'vitest';
import { IdleUpdate } from './idleUpdate.ts';

function setup(working: number) {
  const state = { working, started: [] as string[], changes: 0 };
  const idle = new IdleUpdate({ working: () => state.working, start: (by) => void state.started.push(by), changed: () => void state.changes++ });
  return { idle, state };
}

describe('IdleUpdate', () => {
  it('starts at once when nothing works', () => {
    const { idle, state } = setup(0);
    idle.wait('Studio Mac');
    expect(state.started).toEqual(['Studio Mac']);
    expect(idle.waiting).toBe(false);
  });

  it('waits while sessions work, and starts once none does', () => {
    const { idle, state } = setup(2);
    idle.wait('Studio Mac');
    expect(idle.waiting).toBe(true);
    expect(state.changes).toBe(1);
    state.working = 1;
    expect(idle.check()).toBe(false);
    state.working = 0;
    expect(idle.check()).toBe(true);
    expect(state.started).toEqual(['Studio Mac']);
    expect(idle.waiting).toBe(false);
    // Once only.
    expect(idle.check()).toBe(false);
    expect(state.started).toHaveLength(1);
  });

  it('stops waiting on Cancel update', () => {
    const { idle, state } = setup(1);
    idle.wait('Studio Mac');
    expect(idle.cancel()).toBe(true);
    state.working = 0;
    expect(idle.check()).toBe(false);
    expect(state.started).toEqual([]);
    expect(idle.cancel()).toBe(false);
  });
});
