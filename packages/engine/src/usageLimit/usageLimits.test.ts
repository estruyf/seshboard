import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LimitsState, ResumeAtLimit } from '@seshboard/protocol';
import { openCacheDatabase, type CacheDatabase } from '../db/database.ts';
import { LimitStore } from './limitStore.ts';
import { MAX_RESUME_ATTEMPTS, RESUME_GRACE_MS } from './usageLimit.ts';
import { UsageLimits } from './usageLimits.ts';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 15, 10, 0);

describe('UsageLimits', () => {
  let dir: string;
  let caches: CacheDatabase[];
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    dir = mkdtempSync(join(tmpdir(), 'sb-limits-'));
    caches = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    for (const cache of caches) cache.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** A service on the cache file in `dir`: opening it again is a restart of the app. */
  function open(opts: { mode?: ResumeAtLimit; resumeFails?: boolean } = {}) {
    const cache = openCacheDatabase(join(dir, 'cache.sqlite'));
    caches.push(cache);
    const resumed: string[] = [];
    const notified: string[] = [];
    const changed: string[] = [];
    const states: LimitsState[] = [];
    const limits = new UsageLimits({
      store: new LimitStore(cache.db),
      resume: async (sessionId) => {
        if (opts.resumeFails) throw new Error('Unknown session');
        resumed.push(sessionId);
      },
      profileOf: () => 'default',
      mode: () => opts.mode ?? 'ask',
      onChange: (state) => states.push(state),
      onLimitChanged: (profileId) => changed.push(profileId),
      onResumed: (sessionId) => notified.push(sessionId),
      log: () => {},
    });
    limits.start();
    return { limits, resumed, notified, changed, states, cache };
  }
  const stop = (resetsAt: number | null = T0 + HOUR) => ({ kind: 'five_hour', resetsAt, message: "You've hit your limit" });

  it('sets the profile\'s limit when a turn stops on it, and clears it when a turn gets through', () => {
    const t = open();
    t.limits.hit('default', 's1', stop());
    expect(t.limits.of('default')).toMatchObject({ profileId: 'default', kind: 'five_hour', resetsAt: T0 + HOUR, since: T0, sessionIds: ['s1'] });
    expect(t.limits.of('work')).toBeNull();
    expect(t.changed).toEqual(['default']);
    // Another session of the profile stopping on it joins the same limit.
    t.limits.hit('default', 's2', stop());
    expect(t.limits.of('default')!.sessionIds).toEqual(['s1', 's2']);
    t.limits.ok('default', 's3');
    expect(t.limits.of('default')).toBeNull();
    expect(t.changed).toEqual(['default', 'default', 'default']);
  });

  it('keeps a limit across a restart until its reset', () => {
    open().limits.hit('default', 's1', stop());
    expect(open().limits.of('default')).not.toBeNull();
    vi.setSystemTime(T0 + 2 * HOUR);
    expect(open().limits.of('default')).toBeNull();
  });

  it('resumes an armed session once, a grace period after the reset', async () => {
    const t = open();
    t.limits.hit('default', 's1', stop());
    t.limits.arm('s1', true);
    expect(t.limits.state().resumes).toEqual([{ sessionId: 's1', profileId: 'default', at: T0 + HOUR + RESUME_GRACE_MS, attempts: 0 }]);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(t.resumed).toEqual([]);
    await vi.advanceTimersByTimeAsync(RESUME_GRACE_MS);
    expect(t.resumed).toEqual(['s1']);
    expect(t.notified).toEqual(['s1']);
    // Its turn got through: the limit is gone, and it doesn't fire again.
    t.limits.ok('default', 's1');
    expect(t.limits.state()).toEqual({ limits: [], resumes: [], gaveUp: [] });
    await vi.advanceTimersByTimeAsync(10 * HOUR);
    expect(t.resumed).toEqual(['s1']);
  });

  it('keeps an armed resume when the app restarts, and sends it once, shortly after start when it was missed', async () => {
    const first = open();
    first.limits.hit('default', 's1', stop());
    first.limits.arm('s1', true);
    first.limits.close();

    // Reopened before the reset: it waits for it.
    const second = open();
    expect(second.limits.state().resumes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(HOUR + RESUME_GRACE_MS);
    expect(second.resumed).toEqual(['s1']);
    second.limits.ok('default', 's1');
    second.limits.close();

    // Missed while the app was closed: it goes a few seconds after start, once.
    vi.setSystemTime(T0 + 5 * HOUR);
    const third = open();
    third.limits.hit('default', 's2', stop(T0 + 5 * HOUR - 60_000));
    third.limits.arm('s2', true);
    third.limits.close();
    vi.setSystemTime(T0 + 6 * HOUR);
    const fourth = open();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fourth.resumed).toEqual([]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fourth.resumed).toEqual(['s2']);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(fourth.resumed).toEqual(['s2']);
  });

  it('waits for the new reset when the resume is refused, and gives up after the last try', async () => {
    const t = open();
    let resetsAt = T0 + HOUR;
    t.limits.hit('default', 's1', stop(resetsAt));
    t.limits.arm('s1', true);
    for (let attempt = 1; attempt <= MAX_RESUME_ATTEMPTS; attempt++) {
      await vi.advanceTimersByTimeAsync(resetsAt + RESUME_GRACE_MS - Date.now());
      expect(t.resumed).toHaveLength(attempt);
      // Refused again: the reset moved.
      resetsAt += HOUR;
      t.limits.hit('default', 's1', stop(resetsAt));
    }
    expect(t.limits.state()).toMatchObject({ resumes: [], gaveUp: ['s1'] });
    await vi.advanceTimersByTimeAsync(10 * HOUR);
    expect(t.resumed).toHaveLength(MAX_RESUME_ATTEMPTS);
  });

  it('arms a session straight away with Always', () => {
    const t = open({ mode: 'always' });
    t.limits.hit('default', 's1', stop());
    expect(t.limits.state().resumes.map((r) => r.sessionId)).toEqual(['s1']);
    // Without a reset time there is nothing to wait for.
    const untimed = open({ mode: 'always' });
    untimed.limits.hit('work', 's9', stop(null));
    expect(untimed.limits.state().resumes.map((r) => r.sessionId)).toEqual(['s1']);
  });

  it('refuses to arm without a reset time, and can be disarmed', () => {
    const t = open();
    t.limits.hit('default', 's1', stop(null));
    expect(() => t.limits.arm('s1', true)).toThrow(/didn’t say when/);
    t.limits.hit('default', 's1', stop());
    t.limits.arm('s1', true);
    t.limits.arm('s1', false);
    expect(t.limits.state().resumes).toEqual([]);
  });

  it('resumes now: the session leaves the stopped list, and the limit stays until a turn gets through', async () => {
    const t = open();
    t.limits.hit('default', 's1', stop());
    t.limits.arm('s1', true);
    await t.limits.resumeNow('s1');
    expect(t.resumed).toEqual(['s1']);
    expect(t.limits.state()).toMatchObject({ resumes: [], limits: [{ sessionIds: [] }] });
  });

  it('gives up with a notice when the session can\'t be resumed', async () => {
    const t = open({ resumeFails: true });
    t.limits.hit('default', 's1', stop());
    t.limits.arm('s1', true);
    await vi.advanceTimersByTimeAsync(HOUR + RESUME_GRACE_MS);
    expect(t.limits.state()).toMatchObject({ resumes: [], gaveUp: ['s1'] });
    expect(t.notified).toEqual([]);
  });
});
