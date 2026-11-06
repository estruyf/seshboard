import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DriverStatus } from '../provider.ts';
import { codexDriver } from './codexDriver.ts';
import { fakeAppServer } from './codexFakes.ts';
import { CodexUsage, codexUsageSnapshot, mergeRateLimits } from './codexUsage.ts';
import type { GetAccountRateLimitsResponse } from './protocol.ts';

/** Made up, in the shape `account/rateLimits/read` answers with (codex-cli 0.167, a ChatGPT login): Codex's bucket and a model's. */
const LIMITS = JSON.parse(readFileSync(new URL('./fixtures/rateLimits.json', import.meta.url), 'utf8')) as GetAccountRateLimitsResponse;
const NOW = 1_793_980_000_000;

describe('codexUsageSnapshot', () => {
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
  it('reuses a read for a minute, reads again on refresh, and is null signed out', async () => {
    let now = NOW;
    let reads = 0;
    let signedIn = true;
    const usage = new CodexUsage({
      read: async () => {
        reads++;
        if (!signedIn) throw new Error('codex account authentication required');
        return LIMITS;
      },
      now: () => now,
    });
    expect((await usage.get())?.limits).toHaveLength(3);
    now += 30_000;
    await usage.get();
    expect(reads).toBe(1);
    await usage.get(true);
    expect(reads).toBe(2);
    signedIn = false;
    now += 61_000;
    expect(await usage.get()).toBeNull();
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
    expect((await driver.planUsage!(false))?.limits[0]).toMatchObject({ kind: 'session', percent: 12 });
    expect(server.calls).toEqual([{ method: 'account/rateLimits/read', params: { excludeResetCreditDetails: true } }]);
    // It comes without a thread, while a session runs.
    server.notify('account/rateLimits/updated', { rateLimits: { limitId: 'codex', primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1793990000 }, secondary: null } });
    expect(heard).toEqual([12, 20]);
    expect((await driver.planUsage!(false))?.limits.map((l) => l.percent)).toEqual([20, 41, 93]);
    await driver.dispose();
    server.notify('account/rateLimits/updated', { rateLimits: { limitId: 'codex', primary: { usedPercent: 50, windowDurationMins: 300, resetsAt: 1 } } });
    expect(heard).toEqual([12, 20]);
  });
});
