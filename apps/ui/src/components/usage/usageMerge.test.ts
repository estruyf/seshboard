import { describe, expect, it } from 'vitest';
import { REMOTE_FEATURE_COSTS, REMOTE_FEATURE_USAGE_TOKENS, type Computer, type RemoteUsageBreakdown, type TokenCounts, type UsageBreakdown, type UsageRow } from '@switchboard/protocol/client';
import { addWindowCosts, computersToAsk, engineGroup, mergeBreakdowns, notCounted, THIS_COMPUTER_KEY } from './usageMerge.ts';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 16, 8);
const tokens = (output: number): TokenCounts => ({ input: 0, output, cacheRead: 0, cacheWrite: 0 });

function row(key: string, output: number, extra: Partial<UsageRow> = {}): UsageRow {
  return { key, label: key, sessionId: null, projectRoot: null, model: 'claude-opus-5-5', sessions: 1, turns: 2, fastTurns: 0, tokens: tokens(output), largestContext: output, share: 0, measured: false, ...extra };
}

function breakdown(rows: UsageRow[], extra: Partial<UsageBreakdown> = {}): UsageBreakdown {
  const total = rows.reduce((n, r) => n + r.tokens.output, 0);
  return {
    period: 'window',
    from: T0,
    to: T0 + 2 * HOUR,
    bucket: 'hour',
    totals: { tokens: tokens(total), sessions: rows.reduce((n, r) => n + r.sessions, 0), turns: rows.reduce((n, r) => n + r.turns, 0), fastTurns: 0, largestContext: Math.max(0, ...rows.map((r) => r.largestContext)) },
    rows,
    buckets: [
      { start: T0, tokens: tokens(total), turns: 1 },
      { start: T0 + HOUR, tokens: tokens(0), turns: 0 },
    ],
    scan: null,
    ...extra,
  };
}

function remote(rows: UsageRow[], extra: Partial<UsageBreakdown> = {}): RemoteUsageBreakdown {
  const local = breakdown(rows, extra);
  return { ...local, rows: local.rows.map(({ projectRoot, ...r }) => ({ ...r, projectId: projectRoot ? 'abcdef0123456789' : null, projectName: projectRoot ? 'Api' : null })) };
}

const studio = { id: 'studio', name: 'Studio' };

describe('mergeBreakdowns', () => {
  it('adds up the totals and the chart, with another computer\'s buckets in the bucket that holds them', () => {
    const merged = mergeBreakdowns(breakdown([row('a', 100)]), [{ computer: studio, breakdown: remote([row('b', 300)], { buckets: [{ start: T0 + HOUR + 60_000, tokens: tokens(300), turns: 3 }] }) }], 'session');
    expect(merged.totals.tokens.output).toBe(400);
    expect(merged.totals.sessions).toBe(2);
    expect(merged.totals.turns).toBe(4);
    expect(merged.buckets.map((b) => [b.start, b.tokens.output, b.turns])).toEqual([
      [T0, 100, 1],
      [T0 + HOUR, 300, 3],
    ]);
  });

  it('keeps sessions apart per computer, marks the other computer\'s, and splits the shares over all of them', () => {
    const merged = mergeBreakdowns(breakdown([row('a', 100, { sessionId: 'a', projectRoot: '/work/web' })]), [{ computer: studio, breakdown: remote([row('a', 300, { sessionId: 'b', projectRoot: '/x' })]) }], 'session');
    expect(merged.rows.map((r) => [r.key, r.computer?.name ?? null, r.projectRoot, r.remoteProject?.name ?? null, r.share])).toEqual([
      ['studio:a', 'Studio', null, 'Api', 0.75],
      ['a', null, '/work/web', null, 0.25],
    ]);
  });

  it('keeps a measured share, which the plan % already counts for every computer, and splits the rest by weight', () => {
    const merged = mergeBreakdowns(breakdown([row('a', 100, { share: 0.4, measured: true }), row('b', 100, { share: 0.6 })]), [{ computer: studio, breakdown: remote([row('c', 100)]) }], 'session');
    const share = Object.fromEntries(merged.rows.map((r) => [r.key, [r.share, r.measured]]));
    expect(share).toEqual({ a: [0.4, true], b: [0.3, false], 'studio:c': [0.3, false] });
  });

  it('adds up models and days across computers', () => {
    const merged = mergeBreakdowns(
      breakdown([row('claude-opus-5-5', 100, { byAuto: 1 }), row('auto-routing', 5, { autoRouting: { picks: 2 } })]),
      [{ computer: studio, breakdown: remote([row('claude-opus-5-5', 300, { byAuto: 2, largestContext: 900 }), row('claude-haiku-4-5', 50), row('auto-routing', 5, { autoRouting: { picks: 3 } })]) }],
      'model',
    );
    expect(merged.rows.map((r) => [r.key, r.tokens.output, r.sessions, r.computer ?? null, r.remoteProject ?? null])).toEqual([
      ['claude-opus-5-5', 400, 2, null, null],
      ['claude-haiku-4-5', 50, 1, null, null],
      ['auto-routing', 10, 2, null, null],
    ]);
    const opus = merged.rows[0]!;
    expect([opus.byAuto, opus.largestContext]).toEqual([3, 900]);
    expect(merged.rows[2]!.autoRouting).toEqual({ picks: 5 });
    expect(merged.rows.reduce((n, r) => n + r.share, 0)).toBeCloseTo(1);
  });

  it('lists days newest first', () => {
    const merged = mergeBreakdowns(breakdown([row('2026-10-15', 100)]), [{ computer: studio, breakdown: remote([row('2026-10-16', 10), row('2026-10-15', 10)]) }], 'day');
    expect(merged.rows.map((r) => [r.label, r.tokens.output])).toEqual([
      ['2026-10-16', 10],
      ['2026-10-15', 110],
    ]);
  });

  it('makes a row per computer that used tokens, for Computer', () => {
    const idle = { id: 'idle', name: 'Idle' };
    const merged = mergeBreakdowns(breakdown([row('a', 100)]), [{ computer: studio, breakdown: remote([row('b', 300)]) }, { computer: idle, breakdown: remote([]) }], 'computer', 'This computer');
    expect(merged.rows.map((r) => [r.key, r.label, r.computer?.id ?? null, r.tokens.output, r.share])).toEqual([
      ['studio', 'Studio', 'studio', 300, 0.75],
      [THIS_COMPUTER_KEY, 'This computer', null, 100, 0.25],
    ]);
    expect(engineGroup('computer')).toBe('day');
    expect(engineGroup('project')).toBe('project');
  });

  it('adds up the first reads of the transcripts while they run', () => {
    const merged = mergeBreakdowns(breakdown([], { scan: { done: 1, total: 4 } }), [{ computer: studio, breakdown: remote([], { scan: { done: 2, total: 6 } }) }], 'session');
    expect(merged.scan).toEqual({ done: 3, total: 10 });
    expect(mergeBreakdowns(breakdown([]), [{ computer: studio, breakdown: remote([]) }], 'session').scan).toBeNull();
  });

  it('is this computer\'s breakdown when no other computer answers', () => {
    const local = breakdown([row('a', 100, { share: 1, measured: true })]);
    expect(mergeBreakdowns(local, [], 'session')).toEqual({ ...local, uncosted: [] });
  });

  it('adds up the costs, and says which computer sent none (an older Switchboard)', () => {
    const mystic = { id: 'mystic', name: 'mystic' };
    const priced = (rows: UsageRow[], cost: number) => breakdown(rows, { totals: { ...breakdown(rows).totals, cost } });
    const local = priced([row('opus', 100, { key: 'claude-opus-5-5', cost: 2 })], 2);
    const studioBreakdown = remote([row('opus', 300, { key: 'claude-opus-5-5', cost: 6 })], { totals: { ...breakdown([row('x', 300)]).totals, cost: 6 } });
    const old = remote([row('opus', 50, { key: 'claude-opus-5-5' })]);
    const merged = mergeBreakdowns(local, [{ computer: studio, breakdown: studioBreakdown }, { computer: mystic, breakdown: old }], 'model');
    expect(merged.totals.cost).toBe(8);
    expect(merged.rows).toHaveLength(1);
    expect(merged.rows[0]!.cost).toBe(8);
    expect(merged.uncosted).toEqual([mystic]);
  });
});

describe('computersToAsk', () => {
  const computer = (id: string, state: Computer['state'], features: string[] = [REMOTE_FEATURE_USAGE_TOKENS]): Computer => ({
    id,
    name: id[0]!.toUpperCase() + id.slice(1),
    address: 'https://example.trycloudflare.com',
    pairedAt: 1,
    state,
    message: null,
    retryAt: null,
    version: state === 'connected' ? '0.0.21' : null,
    features: state === 'connected' ? features : [],
    lastSeen: null,
  });

  it('asks connected computers that answer usage.tokens, and says why the others are not counted', () => {
    const { ask, uncounted } = computersToAsk([computer('studio', 'connected'), computer('old', 'connected', ['attachments']), computer('laptop', 'offline'), computer('mini', 'unpaired'), computer('new', 'connecting')]);
    expect(ask).toEqual([{ id: 'studio', name: 'Studio' }]);
    expect(uncounted.map((u) => u.reason)).toEqual(['Old needs a newer Switchboard.', 'Laptop is offline.', 'Mini is offline.', 'Connecting to New.']);
  });

  it("asks for the plan windows' costs only computers that answer them", () => {
    const { ask, uncounted } = computersToAsk([computer('studio', 'connected', [REMOTE_FEATURE_USAGE_TOKENS, REMOTE_FEATURE_COSTS]), computer('old', 'connected')], REMOTE_FEATURE_COSTS);
    expect(ask).toEqual([{ id: 'studio', name: 'Studio' }]);
    expect(uncounted.map((u) => u.reason)).toEqual(['Old needs a newer Switchboard.']);
  });

  it('says why an asked computer is not counted', () => {
    expect(notCounted(studio, 'no-account').reason).toBe('No profile on Studio signs in to this account.');
    expect(notCounted(studio, 'failed').reason).toBe("Couldn't get the usage from Studio.");
  });
});

describe('addWindowCosts', () => {
  const cost = (kind: string, usd: number, scope: string | null = null, partial = false) => ({ kind, scope, from: 1, usd, partial });

  it("adds the same windows from other computers, and keeps only this computer's windows", () => {
    const local = [cost('session', 2), cost('weekly_all', 10), cost('weekly_scoped', 1, 'Opus')];
    const studio = [cost('session', 3), cost('weekly_all', 5, null, true), cost('weekly_scoped', 4, 'Fable')];
    expect(addWindowCosts(local, [studio, [cost('session', 1)]])).toEqual([cost('session', 6), cost('weekly_all', 15, null, true), cost('weekly_scoped', 1, 'Opus')]);
    expect(addWindowCosts(local, [])).toEqual(local);
  });
});
