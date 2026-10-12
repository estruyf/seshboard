import { describe, expect, it } from 'vitest';
import type { PlanSeries, UsageRow } from '@switchboard/protocol/client';
import {
  bucketLabel,
  cacheHitRate,
  chartTypes,
  filterRows,
  foldRows,
  formatShare,
  formatTokens,
  isLow,
  limitTitle,
  modelName,
  niceMax,
  percentLeft,
  PERIODS,
  resetsIn,
  seriesColor,
  stackOf,
  sumTokens,
  visibleSeries,
} from './usageModel.ts';

const tokens = { input: 1_600_000, output: 1_900_000, cacheWrite: 3_100_000, cacheRead: 41_600_000 };

function row(label: string, share: number, extra: Partial<UsageRow> = {}): UsageRow {
  return { key: label, label, sessionId: label, projectRoot: '/work/app', model: 'claude-fable-5-1', sessions: 1, turns: 10, fastTurns: 0, tokens, largestContext: 1000, share, measured: false, ...extra };
}

describe('usage periods and tokens', () => {
  it('orders the periods as on screen', () => {
    expect(PERIODS).toEqual(['window', 'day', 'week', 'month']);
  });

  it('totals without cache reads leave the largest part out', () => {
    expect(sumTokens(tokens)).toBe(48_200_000);
    expect(sumTokens(tokens, chartTypes(false))).toBe(6_600_000);
    expect(chartTypes(false)).toEqual(['input', 'output', 'cacheWrite']);
    expect(chartTypes(true)).toEqual(['input', 'output', 'cacheWrite', 'cacheRead']);
  });

  it('works out the cache hit rate over all input', () => {
    expect(cacheHitRate(tokens)).toBeCloseTo(41.6 / 46.3);
    expect(cacheHitRate({ input: 0, output: 5, cacheWrite: 0, cacheRead: 0 })).toBeNull();
  });

  it('writes token counts and shares short', () => {
    expect(formatTokens(48_200_000)).toBe('48.2M');
    expect(formatTokens(800_000)).toBe('800K');
    expect(formatTokens(1_000_000)).toBe('1M');
    expect(formatTokens(940)).toBe('940');
    expect(formatShare(0.456)).toBe('46%');
    expect(formatShare(0.001)).toBe('<1%');
    expect(formatShare(0)).toBe('0%');
  });

  it('names models by family', () => {
    expect(modelName('claude-fable-5-1')).toBe('Fable');
    expect(modelName('claude-3-5-sonnet-20241022')).toBe('Sonnet');
    expect(modelName(null)).toBe('Unknown');
  });
});

describe('limits', () => {
  const limit = (kind: string, percent: number, scope: string | null = null) => ({ kind, group: kind.startsWith('weekly') ? 'weekly' : kind, percent, resetsAt: null, scope, severity: 'normal', isActive: true });

  it('names each card and its scope', () => {
    expect(limitTitle(limit('session', 38))).toEqual({ name: 'Session', scope: '5 hours' });
    expect(limitTitle(limit('weekly_all', 52))).toEqual({ name: 'Weekly', scope: 'all models' });
    expect(limitTitle(limit('weekly_scoped', 82, 'Fable'))).toEqual({ name: 'Weekly · Fable', scope: 'one model' });
  });

  it('uses the caution colour only at 20% or less left', () => {
    expect(isLow(percentLeft(limit('session', 79)))).toBe(false);
    expect(isLow(percentLeft(limit('session', 80)))).toBe(true);
    expect(isLow(percentLeft(limit('weekly_all', 82)))).toBe(true);
    expect(isLow(percentLeft(limit('weekly_all', 120)))).toBe(true);
  });

  it('says when a window comes back', () => {
    const now = Date.UTC(2026, 9, 12, 17, 16);
    expect(resetsIn(Date.UTC(2026, 9, 12, 19, 30), now, 'en-GB', 'UTC')).toEqual({ wait: '2h 14m', at: '19:30' });
    expect(resetsIn(Date.UTC(2026, 9, 15, 9, 0), now, 'en-GB', 'UTC')).toEqual({ wait: '2d 15h', at: 'Thu 09:00' });
  });

  it('shows only weekly lines at 7 and 30 days, in the fixed colour order', () => {
    const series: PlanSeries[] = [
      { kind: 'session', scope: null, points: [{ at: 1, percent: 10 }], resets: [] },
      { kind: 'weekly_scoped', scope: 'Fable', points: [{ at: 1, percent: 10 }], resets: [] },
      { kind: 'weekly_all', scope: null, points: [{ at: 1, percent: 10 }], resets: [] },
    ];
    expect(visibleSeries('week', series).map((s) => s.kind)).toEqual(['weekly_all', 'weekly_scoped']);
    expect(visibleSeries('day', series).map((s) => s.kind)).toEqual(['weekly_all', 'weekly_scoped', 'session']);
    expect(series.map(seriesColor)).toEqual(['var(--sb-chart-output)', 'var(--sb-chart-input)', 'var(--sb-chart-cache-read)']);
  });
});

describe('breakdown', () => {
  it('folds the rest into one line with its totals', () => {
    const rows = [row('a', 0.4), row('b', 0.2), row('c', 0.2), row('d', 0.1), row('e', 0.05), row('f', 0.03), row('g', 0.02)];
    const { shown, rest } = foldRows(rows, 5);
    expect(shown.map((r) => r.label)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(rest).toMatchObject({ count: 2, turns: 20 });
    expect(rest!.share).toBeCloseTo(0.05);
    expect(rest!.tokens.cacheRead).toBe(83_200_000);
    expect(foldRows(rows.slice(0, 3), 5).rest).toBeNull();
  });

  it('filters rows by title, project and model', () => {
    const rows = [row('Usage view', 0.5), row('Scene presets', 0.5, { projectRoot: '/work/demo-time', model: 'claude-sonnet-5-5' })];
    const name = (root: string) => root.split('/').pop()!;
    expect(filterRows(rows, 'demo', name).map((r) => r.label)).toEqual(['Scene presets']);
    expect(filterRows(rows, 'SONNET', name).map((r) => r.label)).toEqual(['Scene presets']);
    expect(filterRows(rows, ' ', name)).toHaveLength(2);
  });
});

describe('charts', () => {
  it('picks a round axis top', () => {
    expect(niceMax(1_870_000)).toBe(2_000_000);
    expect(niceMax(76)).toBe(100);
    expect(niceMax(0)).toBe(1);
  });

  it('stacks the shown types from the baseline up, skipping empty ones', () => {
    const bucket = { start: 0, turns: 1, tokens: { input: 2, output: 3, cacheWrite: 0, cacheRead: 10 } };
    expect(stackOf(bucket, chartTypes(false))).toEqual([
      { type: 'input', from: 0, to: 2 },
      { type: 'output', from: 2, to: 5 },
    ]);
  });

  it('labels hours and days', () => {
    const at = Date.UTC(2026, 9, 12, 14);
    expect(bucketLabel(at, 'hour', 'day', 'en-GB', 'UTC')).toBe('14:00');
    expect(bucketLabel(at, 'day', 'week', 'en-GB', 'UTC')).toBe('Mon');
    expect(bucketLabel(at, 'day', 'month', 'en-GB', 'UTC')).toBe('12 Oct');
  });
});
