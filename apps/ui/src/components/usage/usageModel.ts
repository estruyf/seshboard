import { safeLocale, type PlanSeries, type TokenCounts, type UsageBucket, type UsageLimit, type UsagePeriod, type UsageRow } from '@switchboard/protocol/client';

/** The periods in their order on screen (and keys 1 to 4). */
export const PERIODS: readonly UsagePeriod[] = ['window', 'day', 'week', 'month'];

export const PERIOD_LABEL: Record<UsagePeriod, string> = { window: 'Current window (5h)', day: '24 hours', week: '7 days', month: '30 days' };
/** The period in a sentence: "7 days · Personal". */
export const PERIOD_SHORT: Record<UsagePeriod, string> = { window: 'Current window', day: '24 hours', week: '7 days', month: '30 days' };

/** The token types, in the order the stacked bars draw them from the baseline up (checked for colour blindness in this order). */
export const TOKEN_TYPES = ['input', 'output', 'cacheWrite', 'cacheRead'] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

export const TOKEN_LABEL: Record<TokenType, string> = { input: 'Uncached input', output: 'Output', cacheWrite: 'Cache write', cacheRead: 'Cache read' };
/** Each type's chart colour, as a CSS value. */
export const TOKEN_COLOR: Record<TokenType, string> = {
  input: 'var(--sb-chart-input)',
  output: 'var(--sb-chart-output)',
  cacheWrite: 'var(--sb-chart-cache-write)',
  cacheRead: 'var(--sb-chart-cache-read)',
};

/** All tokens of the given types. */
export const sumTokens = (t: TokenCounts, types: readonly TokenType[] = TOKEN_TYPES) => types.reduce((sum, type) => sum + t[type], 0);

/** The types a chart shows: cache reads are most of the volume and flatten everything else, so they can be left out. */
export const chartTypes = (withCacheReads: boolean): readonly TokenType[] => (withCacheReads ? TOKEN_TYPES : TOKEN_TYPES.filter((t) => t !== 'cacheRead'));

/** Cache read over all input (uncached, cache write and cache read), 0–1; null without input. */
export function cacheHitRate(t: TokenCounts): number | null {
  const input = t.input + t.cacheWrite + t.cacheRead;
  return input > 0 ? t.cacheRead / input : null;
}

/** "48.2M", "800K", "940": tokens in a few characters. */
export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${trim(n / 1_000_000_000)}B`;
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(Math.round(n));
}
const trim = (n: number) => (n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, ''));

/** "46%", "<1%" for a share above zero that rounds away. */
export function formatShare(share: number): string {
  const percent = share * 100;
  if (percent > 0 && percent < 1) return '<1%';
  return `${Math.round(percent)}%`;
}

/** "Fable" for `claude-fable-5-1`, "Sonnet" for `claude-3-5-sonnet-20241022`: the model's family, as the plan names it. */
export function modelName(model: string | null | undefined): string {
  if (!model) return 'Unknown';
  const family = model
    .split(/[-_]/)
    .find((part) => part !== 'claude' && /^[a-z]+$/i.test(part));
  return family ? family[0]!.toUpperCase() + family.slice(1) : model;
}

/** A limit card's name and what it covers: "Session · 5 hours", "Weekly · all models", "Weekly · Fable · one model". */
export function limitTitle(limit: UsageLimit): { name: string; scope: string } {
  if (limit.kind === 'session') return { name: 'Session', scope: '5 hours' };
  if (limit.kind === 'weekly_all') return { name: 'Weekly', scope: 'all models' };
  if (limit.kind.startsWith('weekly') || limit.group === 'weekly') return limit.scope ? { name: `Weekly · ${limit.scope}`, scope: 'one model' } : { name: 'Weekly', scope: limit.kind.replace(/_/g, ' ') };
  const name = limit.kind.replace(/_/g, ' ');
  return { name: name[0]!.toUpperCase() + name.slice(1), scope: limit.scope ?? '' };
}

/** What is left of a limit, 0–100. */
export const percentLeft = (limit: { percent: number }) => Math.max(0, Math.min(100, 100 - limit.percent));

/** Only a limit with 20% or less left is drawn in the caution colour; otherwise it stays in text colours. */
export const isLow = (left: number) => left <= 20;

/** "Resets in 2h 14m · 19:30", or "Resets in 2d 15h · Thu 09:00" beyond a day. `locale` and `timeZone` are for tests. */
export function resetsIn(resetsAt: number, now: number, locale?: string, timeZone?: string): { wait: string; at: string } {
  locale = safeLocale(locale);
  const minutes = Math.max(0, Math.round((resetsAt - now) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const wait = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  const time = new Date(resetsAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
  const at = days > 0 || minutes >= 24 * 60 ? `${new Date(resetsAt).toLocaleDateString(locale, { weekday: 'short', timeZone })} ${time}` : time;
  return { wait, at };
}

/** A plan window's line colour, in a fixed order: Weekly, a model's weekly, then Session. Never a status colour. */
export function seriesColor(series: { kind: string; scope: string | null }): string {
  if (series.kind === 'session') return 'var(--sb-chart-output)';
  if (series.kind === 'weekly_all') return 'var(--sb-chart-cache-read)';
  return 'var(--sb-chart-input)';
}

/** A plan window's name on its line: "Weekly", "Weekly · Fable", "Session". */
export function seriesName(series: { kind: string; scope: string | null }): string {
  return limitTitle({ kind: series.kind, group: series.kind.startsWith('weekly') ? 'weekly' : series.kind, percent: 0, resetsAt: null, scope: series.scope, severity: 'normal', isActive: true }).name;
}

/** The weekly windows only at 7 and 30 days: the 5-hour session would be a saw blade there. */
export function visibleSeries(period: UsagePeriod, series: readonly PlanSeries[]): PlanSeries[] {
  const weekly = period === 'week' || period === 'month';
  const shown = series.filter((s) => s.points.length > 0 && (!weekly || s.kind !== 'session'));
  // Weekly first, then model weeklies, then Session: the order of the colours.
  const rank = (s: PlanSeries) => (s.kind === 'weekly_all' ? 0 : s.kind === 'session' ? 2 : 1);
  return shown.sort((a, b) => rank(a) - rank(b));
}

/**
 * Whether the % used chart has too little to draw: no readings, or less than a day of them at 7 and 30 days, where a
 * few hours are a pixel at the right edge.
 */
export function historyTooShort(period: UsagePeriod, since: number | null, seriesCount: number, now: number): boolean {
  if (seriesCount === 0 || since === null) return true;
  return (period === 'week' || period === 'month') && now - since < 24 * 3_600_000;
}

/** When the readings start, if that is inside the chart's range: "Oct 12" at 7 and 30 days, "14:30" otherwise. */
export function recordedSince(period: UsagePeriod, since: number | null, from: number, locale?: string, timeZone?: string): string | null {
  locale = safeLocale(locale);
  if (since === null || since <= from) return null;
  return period === 'week' || period === 'month'
    ? new Date(since).toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone })
    : new Date(since).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
}

/** The first `count` rows, and the rest folded into one line with their totals (`cost` undefined when none of them has one). */
export function foldRows<R extends UsageRow>(rows: readonly R[], count: number): { shown: R[]; rest: { count: number; turns: number; tokens: TokenCounts; cost: number | undefined; share: number } | null } {
  if (rows.length <= count) return { shown: [...rows], rest: null };
  const others = rows.slice(count);
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const row of others) for (const type of TOKEN_TYPES) tokens[type] += row.tokens[type];
  return {
    shown: rows.slice(0, count),
    rest: { count: others.length, turns: others.reduce((sum, r) => sum + r.turns, 0), tokens, cost: others.some((r) => r.cost !== undefined) ? others.reduce((sum, r) => sum + (r.cost ?? 0), 0) : undefined, share: others.reduce((sum, r) => sum + r.share, 0) },
  };
}

/** "3 computers": this one and the others counted with it. */
export const computersLabel = (count: number) => `${count} ${count === 1 ? 'computer' : 'computers'}`;

/** Rows whose label, project or model match a filter (case-insensitive), or what `more` says of them (another computer's name). */
export function filterRows<R extends UsageRow>(rows: readonly R[], filter: string, projectName: (root: string) => string, more: (row: R) => ReadonlyArray<string | null | undefined> = () => []): R[] {
  const q = filter.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((r) => [r.label, r.projectRoot ? projectName(r.projectRoot) : '', modelName(r.model), ...more(r)].some((text) => text?.toLowerCase().includes(q)));
}

/** A round top for an axis: 1, 2 or 5 times a power of ten, at or above the largest value. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
}

/**
 * Positions for labels that each want to sit at a height, at least `gap` apart and kept between `min` and `max`, moved
 * as little as they can. In the same order as `wanted`.
 */
export function spreadLabels(wanted: readonly number[], gap: number, min: number, max: number): number[] {
  const order = wanted.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const placed = order.map((o) => Math.max(min, Math.min(max, o.y)));
  for (let k = 1; k < placed.length; k++) placed[k] = Math.max(placed[k]!, placed[k - 1]! + gap);
  // Pushed past the bottom: shift back up from the end, then hold the top.
  if (placed.length) placed[placed.length - 1] = Math.min(placed.at(-1)!, max);
  for (let k = placed.length - 2; k >= 0; k--) placed[k] = Math.min(placed[k]!, placed[k + 1]! - gap);
  for (let k = 0; k < placed.length; k++) placed[k] = Math.max(placed[k]!, k ? placed[k - 1]! + gap : min);
  const out: number[] = [];
  order.forEach((o, k) => (out[o.i] = placed[k]!));
  return out;
}

/** The height of each type's part in a stacked bar, from the baseline up, in units of the value. */
export function stackOf(bucket: UsageBucket, types: readonly TokenType[]): Array<{ type: TokenType; from: number; to: number }> {
  let at = 0;
  return types.flatMap((type) => {
    const value = bucket.tokens[type];
    if (value <= 0) return [];
    const part = { type, from: at, to: at + value };
    at += value;
    return [part];
  });
}

/** A bucket's label on the axis: the hour ("14:00") or the weekday ("Mon"; the date at 30 days). */
export function bucketLabel(start: number, bucket: 'hour' | 'day', period: UsagePeriod, locale?: string, timeZone?: string): string {
  locale = safeLocale(locale);
  if (bucket === 'hour') return new Date(start).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
  if (period === 'month') return new Date(start).toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone });
  return new Date(start).toLocaleDateString(locale, { weekday: 'short', timeZone });
}

/** A local day key (`2026-10-12`) as "Mon Oct 12". */
export function dayLabel(key: string, locale?: string): string {
  locale = safeLocale(locale);
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return key;
  return new Date(y, m - 1, d).toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** When the current window started, as a time ("14:30"). */
export function sinceLabel(from: number, locale?: string, timeZone?: string): string {
  locale = safeLocale(locale);
  return new Date(from).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
}

/**
 * The narrowest a breakdown table can be with every column at its smallest (a track's px, or the minimum of its
 * minmax), the 12px gaps and the rows' 16px padding: below it the card scrolls sideways instead of the cells running
 * out of their rows.
 */
export function tableMinWidth(columns: ReadonlyArray<{ width: string }>): number {
  const smallest = (track: string) => Number(/(\d+)px/.exec(track)?.[1] ?? 0);
  return columns.reduce((sum, c) => sum + smallest(c.width), 0) + 12 * (columns.length - 1) + 32;
}
