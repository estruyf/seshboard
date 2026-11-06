import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DriverStatus } from '../provider.ts';
import { codexDriver } from './codexDriver.ts';
import { fakeAppServer } from './codexFakes.ts';
import { AppServerError } from './appServer.ts';
import { CodexUsage, codexUsageSnapshot, mergeRateLimits, NO_LIMITS, readFailure, SIGNED_OUT } from './codexUsage.ts';
import type { GetAccountRateLimitsResponse } from './protocol.ts';

/** Made up, in the shape `account/rateLimits/read` answers with (codex-cli 0.167, a ChatGPT login): Codex's bucket and a model's. */
const LIMITS = JSON.parse(readFileSync(new URL('./fixtures/rateLimits.json', import.meta.url), 'utf8')) as GetAccountRateLimitsResponse;
const NOW = 1_793_980_000_000;

describe('codexUsageSnapshot', () => {
  it('puts Codex\'s own bucket first, wherever it is in the list, so its 5-hour window is the session limit', () => {
    const scopedFive = { ...LIMITS.rateLimitsByLimitId!.codex_mini!, primary: { usedPercent: 70, windowDurationMins: 300, resetsAt: 1793990000 } };
    const limits = codexUsageSnapshot({ ...LIMITS, rateLimitsByLimitId: { codex_mini: scopedFive, codex: LIMITS.rateLimits } }, NOW)!.limits;
    expect(limits.find((l) => l.group === 'session')).toMatchObject({ kind: 'session', percent: 12, scope: null });
    expect(limits.map((l) => l.kind)).toEqual(['session', 'weekly_all', 'session_scoped', 'weekly_scoped']);
  });

  it('shows the 5-hour and weekly windows as plan meters, Codex\'s own bucket first', () => {
    expect(codexUsageSnapshot(LIMITS, NOW)).toEqual({
      fetchedAt: NOW,
      extraUsage: null,
      limits: [
        { kind: 'session', group: 'session', percent: 12, resetsAt: 1_793_990_000_000, scope: null, severity: 'normal', isActive: false },
        { kind: 'weekly_all', group: 'weekly', percent: 41, resetsAt: 1_794_550_000_000, scope: null, severity: 'normal', isActive: false },
        { kind: 'weekly_scoped', group: 'weekly', percent: 93, resetsAt: 1_794_550_000_000, scope: 'GPT-5 mini', severity: 'critical', isActive: false },
      ],
    });
  });

  it('reads the single bucket when there is no list, and other window lengths by their length', () => {
    const single = { rateLimits: { ...LIMITS.rateLimits, primary: { usedPercent: 100, windowDurationMins: 180, resetsAt: null }, secondary: null }, rateLimitsByLimitId: null };
    expect(codexUsageSnapshot(single, NOW)?.limits).toEqual([{ kind: 'window', group: 'window', percent: 100, resetsAt: null, scope: '3 hours', severity: 'critical', isActive: true }]);
  });

  it('is null without limits to show (an API key, or nothing read)', () => {
    expect(codexUsageSnapshot({ rateLimits: { limitId: 'codex', primary: null, secondary: null }, rateLimitsByLimitId: null }, NOW)).toBeNull();
    expect(codexUsageSnapshot(null, NOW)).toBeNull();
    expect(codexUsageSnapshot({ rateLimits: 'x', rateLimitsByLimitId: [1] }, NOW)).toBeNull();
  });
});

describe('mergeRateLimits', () => {
  it('lays a sparse update over what is known, keeping what it leaves out', () => {
    const merged = mergeRateLimits(LIMITS, { rateLimits: { limitId: 'codex', limitName: null, primary: { usedPercent: 30, windowDurationMins: 300, resetsAt: 1793990000 }, secondary: null, planType: null } });
    const limits = codexUsageSnapshot(merged, NOW)!.limits;
    expect(limits.map((l) => [l.kind, l.percent])).toEqual([
      ['session', 30],
      ['weekly_all', 41],
      ['weekly_scoped', 93],
    ]);
    expect(merged.rateLimits.planType).toBe('plus');
  });

  it('starts from an update alone', () => {
    const merged = mergeRateLimits(null, { rateLimits: { limitId: 'codex', primary: { usedPercent: 5, windowDurationMins: 300, resetsAt: 1 }, secondary: null } });
    expect(codexUsageSnapshot(merged, NOW)?.limits.map((l) => [l.kind, l.percent, l.resetsAt])).toEqual([['session', 5, 1000]]);
  });
});

describe('CodexUsage', () => {
  it('reuses a read for a minute, reads again on refresh, and says why there are none', async () => {
    let now = NOW;
    let reads = 0;
    let answer: () => unknown = () => LIMITS;
    const usage = new CodexUsage({
      read: async () => {
        reads++;
        return answer() as GetAccountRateLimitsResponse;
      },
      now: () => now,
    });
    expect(await usage.get()).toMatchObject({ usage: { limits: [{}, {}, {}] }, error: null });
    now += 30_000;
    await usage.get();
    expect(reads).toBe(1);
    await usage.get(true);
    expect(reads).toBe(2);
    // Slow: the last numbers stay, with why they weren't read again.
    answer = () => {
      throw new AppServerError('timed out', 'timeout');
    };
    expect(await usage.get(true)).toMatchObject({ usage: { limits: [{}, {}, {}] }, error: 'Codex did not report its rate limits in time' });
    // Signed out: none.
    answer = () => {
      throw new AppServerError('codex account authentication required to read rate limits', 'rpc', -32600);
    };
    expect(await usage.get(true)).toEqual({ usage: null, error: SIGNED_OUT });
    // An API key: a read with no windows.
    answer = () => ({ rateLimits: { limitId: 'codex', primary: null, secondary: null }, rateLimitsByLimitId: null });
    expect(await usage.get(true)).toEqual({ usage: null, error: NO_LIMITS });
  });

  it('keeps an update that came while a read was on its way', async () => {
    let answer!: (r: GetAccountRateLimitsResponse) => void;
    let reads = 0;
    const usage = new CodexUsage({ read: () => (reads++ ? Promise.resolve(LIMITS) : new Promise((resolve) => (answer = resolve))), now: () => NOW });
    const reading = usage.get();
    usage.update({ rateLimits: { limitId: 'codex', primary: { usedPercent: 55, windowDurationMins: 300, resetsAt: 1793990000 } } });
    answer(LIMITS);
    expect((await reading).usage?.limits.map((l) => l.percent)).toEqual([55, 41, 93]);
    // A read after it is newer than the update.
    expect((await usage.get(true)).usage?.limits.map((l) => l.percent)).toEqual([12, 41, 93]);
  });

  it('names why a read failed', () => {
    expect(readFailure(new AppServerError('no codex', 'notInstalled'))).toEqual({ error: "Codex isn't installed", keep: false });
    expect(readFailure(new AppServerError('Unauthorized', 'rpc', -32603))).toEqual({ error: SIGNED_OUT, keep: false });
    expect(readFailure(new AppServerError('Codex exited', 'exited'))).toEqual({ error: 'Codex exited', keep: true });
    expect(readFailure(new Error('Something else'))).toEqual({ error: 'Something else', keep: true });
  });

  it('tells listeners what changed, not a read that changed nothing', async () => {
    const usage = new CodexUsage({ read: async () => LIMITS, now: () => NOW });
    const heard: Array<number | null> = [];
    usage.onChange((u) => heard.push(u?.limits[0]?.percent ?? null));
    await usage.get();
    await usage.get(true);
    usage.update({ rateLimits: { limitId: 'codex', primary: { usedPercent: 13, windowDurationMins: 300, resetsAt: 1793990000 } } });
    usage.update({ nothing: true });
    expect(heard).toEqual([12, 13]);
  });
});

describe('the driver\'s plan usage', () => {
  it('reads the limits from the app-server and follows Codex\'s rolling updates', async () => {
    const server = fakeAppServer({ 'account/rateLimits/read': () => LIMITS });
    const status: DriverStatus = { binary: '/fake/codex', version: '0.167.0', signedIn: true, account: null, login: null, problem: null };
    const driver = codexDriver({ server, status: async () => status });
    const heard: number[] = [];
    driver.onPlanUsage!((usage) => heard.push(usage?.limits[0]?.percent ?? -1));
    expect((await driver.planUsage!(false)).usage?.limits[0]).toMatchObject({ kind: 'session', percent: 12 });
    expect(server.calls).toEqual([{ method: 'account/rateLimits/read', params: { excludeResetCreditDetails: true } }]);
    // It comes without a thread, while a session runs.
    server.notify('account/rateLimits/updated', { rateLimits: { limitId: 'codex', primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1793990000 }, secondary: null } });
    expect(heard).toEqual([12, 20]);
    expect((await driver.planUsage!(false)).usage?.limits.map((l) => l.percent)).toEqual([20, 41, 93]);
    await driver.dispose();
    server.notify('account/rateLimits/updated', { rateLimits: { limitId: 'codex', primary: { usedPercent: 50, windowDurationMins: 300, resetsAt: 1 } } });
    expect(heard).toEqual([12, 20]);
  });
});
