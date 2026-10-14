import { describe, expect, it } from 'vitest';
import type { SessionsChanged, SessionSummary } from '@switchboard/protocol/client';
import { createBatcher, mergeSessionChanges } from './sessionChanges.ts';

// Only the id matters to the merge; the rest of a summary rides along.
const summary = (id: string, title = id) => ({ id, title }) as unknown as SessionSummary;
const change = (upserted: SessionSummary[], removed: string[] = [], complete = true): SessionsChanged => ({ upserted, removed, complete });

describe('mergeSessionChanges', () => {
  it('applies the changes in order on one copy', () => {
    const before = new Map([['a', summary('a')], ['b', summary('b')]]);
    const next = mergeSessionChanges({ sessions: before, complete: false }, [
      change([summary('c')], [], false),
      change([summary('a', 'renamed')], ['b'], false),
      // Removed, then back: the later change wins.
      change([], ['c'], false),
      change([summary('c', 'again')], [], true),
    ]);
    expect([...next.sessions.keys()]).toEqual(['a', 'c']);
    expect(next.sessions.get('a')!.title).toBe('renamed');
    expect(next.sessions.get('c')!.title).toBe('again');
    expect(next.complete).toBe(true);
    // The map the store had is left alone.
    expect([...before.keys()]).toEqual(['a', 'b']);
  });

  it('takes `complete` from the last change', () => {
    const next = mergeSessionChanges({ sessions: new Map(), complete: true }, [change([], [], true), change([], [], false)]);
    expect(next.complete).toBe(false);
  });

  it('gives back the same state when there is nothing to apply', () => {
    const current = { sessions: new Map([['a', summary('a')]]), complete: true };
    expect(mergeSessionChanges(current, [])).toBe(current);
  });

  it('merges a burst of a thousand new sessions in one go', () => {
    const changes = Array.from({ length: 1000 }, (_, i) => change([summary(`s${i}`)]));
    expect(mergeSessionChanges({ sessions: new Map(), complete: false }, changes).sessions.size).toBe(1000);
  });
});

describe('createBatcher', () => {
  /** A schedule run by hand, like an animation frame that hasn't come yet. */
  const manual = () => {
    const runs: (() => void)[] = [];
    let scheduled = 0;
    let cancelled = 0;
    const schedule = (run: () => void) => {
      scheduled++;
      runs.push(run);
      return () => void cancelled++;
    };
    return { schedule, tick: () => runs.splice(0).forEach((run) => run()), counts: () => ({ scheduled, cancelled }) };
  };

  it('hands over everything pushed before the scheduled run, in order, once', () => {
    const clock = manual();
    const batches: number[][] = [];
    const batch = createBatcher<number>((items) => batches.push(items), clock.schedule);
    batch.push(1);
    batch.push(2);
    batch.push(3);
    expect(batches).toEqual([]);
    expect(clock.counts().scheduled).toBe(1);
    clock.tick();
    expect(batches).toEqual([[1, 2, 3]]);
    batch.push(4);
    clock.tick();
    expect(batches).toEqual([[1, 2, 3], [4]]);
  });

  it('flushes at once on request and cancels the scheduled run', () => {
    const clock = manual();
    const batches: string[][] = [];
    const batch = createBatcher<string>((items) => batches.push(items), clock.schedule);
    batch.push('a');
    batch.flush();
    expect(batches).toEqual([['a']]);
    expect(clock.counts().cancelled).toBe(1);
    // The run that was scheduled finds nothing left.
    clock.tick();
    expect(batches).toEqual([['a']]);
  });

  it('drops what waits when cancelled', () => {
    const clock = manual();
    const batches: string[][] = [];
    const batch = createBatcher<string>((items) => batches.push(items), clock.schedule);
    batch.push('a');
    batch.cancel();
    clock.tick();
    batch.flush();
    expect(batches).toEqual([]);
  });
});
