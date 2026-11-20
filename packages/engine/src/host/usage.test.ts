import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UsageSnapshot } from '@seshboard/protocol';
import type { SdkRuntime } from './hostManager.ts';
import { toUsageSnapshot, UsageMonitor } from './usageMonitor.ts';

const REPORT = {
  rate_limits: {
    limits: [
      { kind: 'session', group: 'session', percent: 18, resets_at: '2026-10-05T16:10:00.729805+00:00', scope: null, severity: 'normal', is_active: true },
      { kind: 'weekly_scoped', group: 'weekly', percent: 0, resets_at: null, scope: { model: { display_name: 'Fable' }, surface: null }, severity: 'normal', is_active: false },
      { kind: 'broken' },
    ],
    extra_usage: { is_enabled: false, monthly_limit: 1700, used_credits: 0, currency: 'EUR' },
  },
};

describe('toUsageSnapshot', () => {
  it('maps the report rows, drops malformed ones and keeps extra usage', () => {
    const snapshot = toUsageSnapshot(REPORT, 1)!;
    expect(snapshot.limits).toEqual([
      { kind: 'session', group: 'session', percent: 18, resetsAt: Date.parse('2026-10-05T16:10:00.729Z'), scope: null, severity: 'normal', isActive: true },
      { kind: 'weekly_scoped', group: 'weekly', percent: 0, resetsAt: null, scope: 'Fable', severity: 'normal', isActive: false },
    ]);
    expect(snapshot.extraUsage).toEqual({ enabled: false, usedCredits: 0, monthlyLimit: 1700, currency: 'EUR' });
    expect(toUsageSnapshot(undefined)).toBeNull();
    expect(toUsageSnapshot({ rate_limits: null })).toBeNull();
  });
});

describe('UsageMonitor', () => {
  it('asks Claude Code for /usage without writing a session, and hides the helper', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const hidden: string[] = [];
    const changes: Array<UsageSnapshot | null> = [];
    const sdk: SdkRuntime = {
      query: ({ prompt, options }) => {
        calls.push(options as Record<string, unknown>);
        let closed = false;
        return {
          async *[Symbol.asyncIterator]() {
            for await (const message of prompt) {
              expect(message.message.content).toBe('/usage');
              yield { type: 'assistant', message: { content: [] }, usage_report: REPORT };
              yield { type: 'result', subtype: 'success' };
              if (closed) return;
            }
          },
          close: () => void (closed = true),
        } as never;
      },
      startup: async () => ({}) as never,
    };
    const monitor = new UsageMonitor({
      sdk: async () => sdk,
      env: async () => ({}),
      claudePath: async () => '/bin/claude',
      onChange: (u) => changes.push(u),
      log: () => {},
      ephemeral: { add: (id) => hidden.push(id), delete: () => {} },
    });
    const { usage, error } = await monitor.get(false);
    expect(error).toBeNull();
    expect(usage?.limits[0]).toMatchObject({ kind: 'session', percent: 18 });
    expect(calls[0]).toMatchObject({ persistSession: false, sessionId: hidden[0] });
    // The user's settings stay (env, proxy, apiKeyHelper), the hooks (SessionStart and the rest) don't run.
    expect(calls[0]).toMatchObject({ settingSources: ['user'], settings: { disableAllHooks: true } });
    expect(changes).toHaveLength(1);
    // Cached for a minute: no second process.
    await monitor.get(false);
    expect(calls).toHaveLength(1);
    monitor.stop();
  });

  it('keeps the last good numbers when a fetch comes back empty, and retries soon', async () => {
    let answer: unknown = REPORT;
    let fetches = 0;
    const changes: Array<UsageSnapshot | null> = [];
    const sdk: SdkRuntime = {
      query: ({ prompt }) =>
        ({
          async *[Symbol.asyncIterator]() {
            for await (const _ of prompt) {
              fetches++;
              yield { type: 'assistant', message: { content: [] }, usage_report: answer };
              yield { type: 'result', subtype: 'success' };
              return;
            }
          },
          close: () => {},
        }) as never,
      startup: async () => ({}) as never,
    };
    const monitor = new UsageMonitor({
      sdk: async () => sdk,
      env: async () => ({}),
      claudePath: async () => '/bin/claude',
      onChange: (u) => changes.push(u),
      log: () => {},
      ephemeral: { add: () => {}, delete: () => {} },
      retryMs: 20,
    });
    expect((await monitor.get(false)).usage).not.toBeNull();
    answer = null;
    const missed = await monitor.get(true);
    expect(missed.usage?.limits[0]).toMatchObject({ kind: 'session' });
    expect(missed.error).toMatch(/No plan usage/);
    expect(changes).toHaveLength(1);
    // The retry fires shortly after the miss.
    answer = REPORT;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fetches).toBe(3);
    monitor.stop();
  });
});

describe('UsageMonitor retries', () => {
  /** A fake Claude Code that answers `/usage` with `answer()`, or never answers when it returns `hang`. */
  const fakeSdk = (answer: () => unknown, counters: { fetches: number; closed: number }): SdkRuntime => ({
    query: ({ prompt }) => {
      let wake: (() => void) | undefined;
      let closed = false;
      return {
        async *[Symbol.asyncIterator]() {
          for await (const _ of prompt) {
            counters.fetches++;
            const report = answer();
            if (report === 'hang') {
              while (!closed) await new Promise<void>((resolve) => (wake = resolve));
              return;
            }
            yield { type: 'assistant', message: { content: [] }, usage_report: report };
            yield { type: 'result', subtype: 'success' };
            return;
          }
        },
        close: () => {
          counters.closed++;
          closed = true;
          wake?.();
        },
      } as never;
    },
    startup: async () => ({}) as never,
  });
  const monitorFor = (sdk: SdkRuntime, extra: { retryMs?: number; timeoutMs?: number } = {}) =>
    new UsageMonitor({
      sdk: async () => sdk,
      env: async () => ({}),
      claudePath: async () => '/bin/claude',
      onChange: () => {},
      log: () => {},
      ephemeral: { add: () => {}, delete: () => {} },
      ...extra,
    });

  it('retries a miss once, not forever', async () => {
    const counters = { fetches: 0, closed: 0 };
    const monitor = monitorFor(fakeSdk(() => null, counters), { retryMs: 10 });
    await monitor.get(false);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(counters.fetches).toBe(2);
    monitor.stop();
  });

  it('starts nothing after stop()', async () => {
    const counters = { fetches: 0, closed: 0 };
    const monitor = monitorFor(fakeSdk(() => null, counters), { retryMs: 10 });
    // Stopped while the fetch is still running: its miss must not arm a retry, and nudges are ignored.
    const pending = monitor.get(false);
    monitor.stop();
    await pending;
    monitor.nudge();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(counters.fetches).toBe(1);
  });

  it('says when Claude Code took too long, and closes the helper', async () => {
    const counters = { fetches: 0, closed: 0 };
    const monitor = monitorFor(fakeSdk(() => 'hang', counters), { timeoutMs: 20, retryMs: 60_000 });
    const { usage, error } = await monitor.get(false);
    expect(usage).toBeNull();
    expect(error).toMatch(/in time/);
    expect(counters.closed).toBeGreaterThan(0);
    monitor.stop();
  });
});

describe('UsageMonitor nudges', () => {
  afterEach(() => vi.useRealTimers());
  const fakeSdk = (counters: { fetches: number; miss?: boolean }): SdkRuntime => ({
    query: ({ prompt }) =>
      ({
        async *[Symbol.asyncIterator]() {
          for await (const _ of prompt) {
            counters.fetches++;
            yield { type: 'assistant', message: { content: [] }, usage_report: counters.miss ? undefined : REPORT };
            yield { type: 'result', subtype: 'success' };
            return;
          }
        },
        close: () => {},
      }) as never,
    startup: async () => ({}) as never,
  });
  const start = async () => {
    vi.useFakeTimers();
    const counters: { fetches: number; miss?: boolean } = { fetches: 0 };
    const monitor = new UsageMonitor({
      sdk: async () => fakeSdk(counters),
      env: async () => ({}),
      claudePath: async () => '/bin/claude',
      onChange: () => {},
      log: () => {},
      ephemeral: { add: () => {}, delete: () => {} },
    });
    await monitor.get(false);
    return { monitor, counters, wait: (ms: number) => vi.advanceTimersByTimeAsync(ms) };
  };

  it('BUDGET: starts at most one helper a minute for nudges, however often a turn ends', async () => {
    const { monitor, counters, wait } = await start();
    expect(counters.fetches).toBe(1);
    // A turn ends every 20 s for three minutes.
    for (let t = 0; t < 180; t += 20) {
      monitor.nudge();
      await wait(20_000);
    }
    // The first at the start, then one a minute (60 s, 120 s, 180 s), not one after each turn.
    expect(counters.fetches).toBe(4);
    monitor.stop();
  });

  it('waits the floor out after the first nudge, not just 15 s', async () => {
    const { monitor, counters, wait } = await start();
    await wait(10_000);
    monitor.nudge();
    await wait(30_000);
    expect(counters.fetches).toBe(1);
    await wait(21_000);
    expect(counters.fetches).toBe(2);
    monitor.stop();
  });

  it('keeps the 15 s wait when the last fetch is old, and lets a fetch from elsewhere push the nudge back', async () => {
    const { monitor, counters, wait } = await start();
    await wait(100_000);
    monitor.nudge();
    await wait(16_000);
    expect(counters.fetches).toBe(2);

    // A nudge, then the Usage view's Refresh 10 s later: the nudge waits out the floor after that.
    monitor.nudge();
    await wait(10_000);
    await monitor.get(true);
    expect(counters.fetches).toBe(3);
    await wait(40_000);
    expect(counters.fetches).toBe(3);
    await wait(25_000);
    expect(counters.fetches).toBe(4);
    monitor.stop();
  });

  it('stop() cancels a pending nudge and one that was pushed back by another fetch', async () => {
    const { monitor, counters, wait } = await start();
    monitor.nudge();
    monitor.stop();
    await wait(120_000);
    expect(counters.fetches).toBe(1);

    const again = await start();
    again.monitor.nudge();
    await again.wait(10_000);
    await again.monitor.get(true);
    expect(again.counters.fetches).toBe(2);
    // The nudge fires at 15 s, finds the floor not over (the Refresh started at 10 s) and arms itself again: stop that too.
    await again.wait(10_000);
    again.monitor.stop();
    await again.wait(120_000);
    expect(again.counters.fetches).toBe(2);
  });

  it('a nudge while a miss waits for its retry waits out the floor after the retry', async () => {
    vi.useFakeTimers();
    const counters: { fetches: number; miss?: boolean } = { fetches: 0, miss: true };
    const monitor = new UsageMonitor({
      sdk: async () => fakeSdk(counters),
      env: async () => ({}),
      claudePath: async () => '/bin/claude',
      onChange: () => {},
      log: () => {},
      ephemeral: { add: () => {}, delete: () => {} },
    });
    await monitor.get(false);
    // The first miss retries in 30 s. The nudge is held to 60 s by the floor, finds the retry at 30 s, and waits until 90 s.
    monitor.nudge();
    await vi.advanceTimersByTimeAsync(31_000);
    expect(counters.fetches).toBe(2);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(counters.fetches).toBe(2);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(counters.fetches).toBe(3);
    monitor.stop();
  });

  it('the regular check skips its turn when a fetch just ran', async () => {
    const { monitor, counters, wait } = await start();
    // The interval fires at 5 minutes; a Refresh at 4 min 30 s is fresh enough.
    await wait(270_000);
    await monitor.get(true);
    expect(counters.fetches).toBe(2);
    await wait(31_000);
    expect(counters.fetches).toBe(2);
    // The next tick, 5 minutes after the first, finds the Refresh older than the floor.
    await wait(300_000);
    expect(counters.fetches).toBe(3);
    monitor.stop();
  });

  it('does not wait longer than the floor when the clock jumps back', async () => {
    const { monitor, counters, wait } = await start();
    vi.setSystemTime(Date.now() - 3_600_000);
    monitor.nudge();
    await wait(16_000);
    expect(counters.fetches).toBe(2);
    monitor.stop();
  });

  it('fetches again when the numbers are older than the age asked for, not the default minute', async () => {
    const { monitor, counters, wait } = await start();
    await wait(90_000);
    await monitor.get(false, 120_000);
    expect(counters.fetches).toBe(1);
    await monitor.get(false);
    expect(counters.fetches).toBe(2);
    await wait(130_000);
    await monitor.get(false, 120_000);
    expect(counters.fetches).toBe(3);
    monitor.stop();
  });
});
