import { useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react';
import type { PlanSeries, UsageBucket, UsagePeriod } from '@switchboard/protocol/client';
import { bucketLabel, formatTokens, niceMax, seriesColor, seriesName, spreadLabels, stackOf, sumTokens, TOKEN_COLOR, TOKEN_LABEL, TOKEN_TYPES, type TokenType } from './usageModel.ts';

/** The width of an element, following resizes. */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** A legend entry: a swatch in the series colour, the name in text colours (never the series colour). */
export function LegendItem({ color, label, dim = false, dashed = false }: { color: string; label: string; dim?: boolean; dashed?: boolean }) {
  return (
    <span className={`flex items-center gap-1.5 whitespace-nowrap ${dim ? 'text-faint opacity-60' : 'text-muted'}`}>
      {dashed ? (
        <svg width="14" height="8" aria-hidden className="shrink-0">
          <line x1="0" y1="4" x2="14" y2="4" stroke={color} strokeWidth="2" strokeDasharray="4 2" />
        </svg>
      ) : (
        <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} aria-hidden />
      )}
      {label}
    </span>
  );
}

/** The floating box a chart shows on hover: a title line, then one row per series. */
function ChartTooltip({ x, y, width, title, rows }: { x: number; y: number; width: number; title: string; rows: Array<{ color: string; label: string; value: string; dashed?: boolean }> }) {
  // Beside the pointer, flipped to the left near the right edge.
  const left = x + 220 > width ? Math.max(0, x - 216) : x + 16;
  return (
    <div className="pointer-events-none absolute z-10 grid min-w-[180px] gap-1 rounded-lg border overlay px-3 py-2 text-ui" style={{ left, top: Math.max(0, y) }} data-chart-tooltip>
      <p className="text-meta text-muted">{title}</p>
      {rows.map((row) => (
        <p key={row.label} className="flex items-center gap-2">
          <LegendItem color={row.color} label={row.label} dashed={row.dashed} />
          <span className="ml-auto pl-3 font-semibold tabular-nums text-text">{row.value}</span>
        </p>
      ))}
    </div>
  );
}

/**
 * A chart's card: its title and subtitle, legend and controls on the right, and a "Show as table" switch that swaps
 * the chart for the same numbers as a table (for screen readers, and to read exact values).
 */
export function ChartCard({ title, subtitle, legend, controls, table, children, className = '', ...rest }: { title: string; subtitle?: ReactNode; legend?: ReactNode; controls?: ReactNode; table: ReactNode; children: ReactNode; className?: string; [data: `data-${string}`]: unknown }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`grid min-w-0 content-start gap-3 rounded-xl border border-border bg-card p-4 ${className}`} aria-label={title} {...rest}>
      <header className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="text-ui font-semibold text-text">{title}</h2>
        {subtitle && <p className="min-w-0 truncate text-meta text-muted">{subtitle}</p>}
        <div className="ml-auto flex flex-wrap items-center gap-3 text-meta">
          {legend}
          {controls}
          <button type="button" className="text-meta text-link hover:underline" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)} data-chart-table-toggle>
            {asTable ? 'Show as chart' : 'Show as table'}
          </button>
        </div>
      </header>
      {asTable ? <div className="max-h-80 overflow-auto">{table}</div> : children}
    </section>
  );
}

/** A table for a chart's numbers, in the app's table style. */
export function ChartTable({ caption, head, rows }: { caption: string; head: string[]; rows: Array<Array<string | number>> }) {
  return (
    <table className="w-full text-ui tabular-nums">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="text-left text-meta text-muted">
          {head.map((h, i) => (
            <th key={h} scope="col" className={`px-2 py-1 font-medium ${i > 0 ? 'text-right' : ''}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r} className="border-t border-border">
            {row.map((cell, i) => (
              <td key={i} className={`px-2 py-1 ${i > 0 ? 'text-right' : ''}`}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A top-rounded rectangle: bars are rounded at their data end only, anchored square to the baseline. */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

const AXIS = 'var(--sb-faint)';
const GRID = 'var(--sb-border)';

/**
 * Tokens per hour or day as stacked bars, one part per shown type from the baseline up, with a 2px gap between
 * parts and a 4px rounded top. Hovering a bar shows every type for it, also the ones left out of the bars.
 */
export function StackedBars({ buckets, types, bucket, period, height = 220 }: { buckets: UsageBucket[]; types: readonly TokenType[]; bucket: 'hour' | 'day'; period: UsagePeriod; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const [hover, setHover] = useState<number | null>(null);
  const left = 44;
  const bottom = 22;
  const top = 8;
  const plotW = Math.max(0, width - left - 4);
  const plotH = height - bottom - top;
  const max = niceMax(Math.max(0, ...buckets.map((b) => sumTokens(b.tokens, types))));
  const slot = buckets.length ? plotW / buckets.length : 0;
  const barW = Math.max(2, Math.min(68, slot * 0.62));
  const y = (value: number) => top + plotH - (value / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.max(1, Math.ceil(buckets.length / Math.max(1, Math.floor(plotW / 56))));
  const hovered = hover !== null ? buckets[hover] : null;
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Tokens per ${bucket}, ${buckets.length} ${bucket}s`} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={width - 4} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth="1" />
              <text x={left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill={AXIS}>
                {formatTokens(t)}
              </text>
            </g>
          ))}
          {buckets.map((b, i) => {
            const cx = left + slot * i + slot / 2;
            const parts = stackOf(b, types);
            return (
              <g key={b.start}>
                {hover === i && <rect x={cx - slot / 2 + 2} y={top} width={slot - 4} height={plotH} rx="4" fill="var(--sb-selected)" />}
                {parts.map((part, p) => {
                  const y0 = y(part.from);
                  const y1 = y(part.to);
                  // A 2px gap in the card's colour between stacked parts.
                  const h = Math.max(0, y0 - y1 - (p > 0 ? 2 : 0));
                  if (h <= 0) return null;
                  const yTop = y1;
                  return p === parts.length - 1 ? (
                    <path key={part.type} d={topRounded(cx - barW / 2, yTop, barW, h, 4)} fill={TOKEN_COLOR[part.type]} />
                  ) : (
                    <rect key={part.type} x={cx - barW / 2} y={yTop} width={barW} height={h} fill={TOKEN_COLOR[part.type]} />
                  );
                })}
                {i % labelEvery === 0 && (
                  <text x={cx} y={height - 6} textAnchor="middle" fontSize="11" fill={hover === i ? 'var(--sb-text)' : AXIS} fontWeight={hover === i ? 600 : 400}>
                    {bucketLabel(b.start, bucket, period)}
                  </text>
                )}
                {/* The hit target is the whole column, bigger than the bar. */}
                <rect x={cx - slot / 2} y={top} width={slot} height={plotH + bottom} fill="transparent" onMouseEnter={() => setHover(i)} data-usage-bar={i} />
              </g>
            );
          })}
        </svg>
      )}
      {hovered && hover !== null && (
        <ChartTooltip
          x={left + slot * hover + slot / 2 + barW / 2}
          y={8}
          width={width}
          title={`${bucket === 'hour' ? new Date(hovered.start).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : new Date(hovered.start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${formatTokens(sumTokens(hovered.tokens))} tokens`}
          rows={[...TOKEN_TYPES].reverse().map((type) => ({ color: TOKEN_COLOR[type], label: TOKEN_LABEL[type], value: formatTokens(hovered.tokens[type]) }))}
        />
      )}
    </div>
  );
}

/** Where a line stands at a moment: its last reading at or before it. */
function valueAt(series: PlanSeries, at: number): number | null {
  let found: number | null = null;
  for (const point of series.points) {
    if (point.at > at) break;
    found = point.percent;
  }
  return found;
}

/** Ticks along a time axis: local midnights for days, round hours otherwise. */
function timeTicks(from: number, to: number, days: boolean): number[] {
  const ticks: number[] = [];
  const start = new Date(from);
  if (days) {
    start.setHours(0, 0, 0, 0);
    if (start.getTime() < from) start.setDate(start.getDate() + 1);
    for (const d = start; d.getTime() <= to; d.setDate(d.getDate() + 1)) ticks.push(d.getTime());
    return ticks;
  }
  const span = (to - from) / 3_600_000;
  const step = span > 12 ? 3 : 1;
  start.setMinutes(0, 0, 0);
  if (start.getTime() < from) start.setHours(start.getHours() + 1);
  while (start.getHours() % step !== 0) start.setHours(start.getHours() + 1);
  for (const d = start; d.getTime() <= to; d.setHours(d.getHours() + step)) ticks.push(d.getTime());
  return ticks;
}

const timeOf = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
const dayTimeOf = (at: number) => `${new Date(at).toLocaleDateString(undefined, { weekday: 'short' })} ${timeOf(at)}`;

/**
 * Plan % used over time, one 2px line per window (the Session line dashed, so it stays apart from Weekly for
 * colour-blind readers), a dashed marker at each reset, the window's name and value at each line's end, and a
 * crosshair that shows every line's value.
 */
export function PercentLines({ series, from, to, period, height = 300 }: { series: PlanSeries[]; from: number; to: number; period: UsagePeriod; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const [hoverAt, setHoverAt] = useState<number | null>(null);
  const left = 40;
  // Room for the end labels ("Weekly · Opus 82%").
  const right = 140;
  const top = 22;
  const bottom = 22;
  const plotW = Math.max(0, width - left - right);
  const plotH = height - top - bottom;
  const x = (at: number) => left + ((at - from) / Math.max(1, to - from)) * plotW;
  const y = (percent: number) => top + plotH - (Math.max(0, Math.min(100, percent)) / 100) * plotH;
  const days = period === 'week' || period === 'month';
  const ticks = timeTicks(from, to, days);
  const labelEvery = Math.max(1, Math.ceil(ticks.length / Math.max(1, Math.floor(plotW / 64))));
  // Weekly resets are named; within a day, the session's.
  // One marker per moment: windows that reset together (Weekly and a model's weekly) share it, under the first's name.
  const resets: Array<{ at: number; name: string }> = [];
  for (const s of series) {
    for (const at of s.resets) {
      if (at < from || at > to || resets.some((r) => Math.abs(r.at - at) < 30 * 60_000)) continue;
      resets.push({ at, name: seriesName(s) });
    }
  }
  // Each line's points in range, and its end label nudged clear of the others (Weekly and Session often sit close).
  const ends = series.map((s) => ({ s, points: s.points.filter((p) => p.at >= from && p.at <= to) })).filter((l) => l.points.length);
  const labelY = spreadLabels(ends.map((l) => y(l.points.at(-1)!.percent)), 14, top, top + plotH);
  const onMove = (event: MouseEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const at = from + ((event.clientX - box.left) / box.width) * (to - from);
    setHoverAt(Math.max(from, Math.min(to, at)));
  };
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHoverAt(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Plan used over time: ${series.map((s) => `${seriesName(s)} ${Math.round(s.points.at(-1)?.percent ?? 0)}% used`).join(', ')}`} className="block overflow-visible">
          {[0, 50, 100].map((p) => (
            <g key={p}>
              <line x1={left} x2={left + plotW} y1={y(p)} y2={y(p)} stroke={GRID} strokeWidth="1" />
              <text x={left - 8} y={y(p)} dy="0.32em" textAnchor="end" fontSize="11" fill={AXIS}>
                {p}%
              </text>
            </g>
          ))}
          {ticks.map((t, i) =>
            i % labelEvery === 0 ? (
              <text key={t} x={x(t)} y={height - 4} textAnchor="middle" fontSize="11" fill={AXIS}>
                {days ? (period === 'month' ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : new Date(t).toLocaleDateString(undefined, { weekday: 'short' })) : timeOf(t)}
              </text>
            ) : null,
          )}
          {resets.map((r) => (
            <g key={`${r.name}:${r.at}`}>
              <line x1={x(r.at)} x2={x(r.at)} y1={top} y2={top + plotH} stroke={AXIS} strokeWidth="1" strokeDasharray="3 3" />
              <text x={x(r.at) + 6} y={top - 8} fontSize="11" fill="var(--sb-muted)">
                {r.name} reset · {days ? dayTimeOf(r.at) : timeOf(r.at)}
              </text>
            </g>
          ))}
          {ends.map(({ s, points }, i) => {
            const last = points.at(-1)!;
            return (
              <g key={`${s.kind}:${s.scope ?? ''}`} data-usage-line={s.kind}>
                <polyline
                  points={points.map((p) => `${x(p.at)},${y(p.percent)}`).join(' ')}
                  fill="none"
                  stroke={seriesColor(s)}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={s.kind === 'session' ? '6 4' : undefined}
                />
                {/* A ring in the card's colour keeps the end dot clear of lines it overlaps. */}
                <circle cx={x(last.at)} cy={y(last.percent)} r="4" fill={seriesColor(s)} stroke="var(--sb-card)" strokeWidth="2" />
                <text x={x(last.at) + 10} y={labelY[i]} dy="0.32em" fontSize="12" fill="var(--sb-text)">
                  {seriesName(s)} {Math.round(last.percent)}%
                </text>
              </g>
            );
          })}
          {hoverAt !== null && (
            <g pointerEvents="none">
              <line x1={x(hoverAt)} x2={x(hoverAt)} y1={top} y2={top + plotH} stroke="var(--sb-muted)" strokeWidth="1" />
              {series.map((s) => {
                const v = valueAt(s, hoverAt);
                return v === null ? null : <circle key={`${s.kind}:${s.scope ?? ''}`} cx={x(hoverAt)} cy={y(v)} r="4" fill={seriesColor(s)} stroke="var(--sb-card)" strokeWidth="2" />;
              })}
            </g>
          )}
          <rect x={left} y={top} width={plotW} height={plotH} fill="transparent" onMouseMove={onMove} data-usage-crosshair />
        </svg>
      )}
      {hoverAt !== null && (
        <ChartTooltip
          x={x(hoverAt)}
          y={top + 24}
          width={width}
          title={days ? dayTimeOf(hoverAt) : timeOf(hoverAt)}
          rows={series.flatMap((s) => {
            const v = valueAt(s, hoverAt);
            return v === null ? [] : [{ color: seriesColor(s), label: seriesName(s), value: `${Math.round(v)}% used`, dashed: s.kind === 'session' }];
          })}
        />
      )}
    </div>
  );
}

/** A small line of one value over buckets (a model's daily cache hit rate), 0–100%. */
export function RateLine({ points, labels, height = 140, format }: { points: Array<number | null>; labels: string[]; height?: number; format: (v: number) => string }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const [hover, setHover] = useState<number | null>(null);
  const left = 40;
  const top = 8;
  const bottom = 22;
  const plotW = Math.max(0, width - left - 16);
  const plotH = height - top - bottom;
  const known = points.filter((p): p is number => p !== null);
  const low = known.length ? Math.max(0, Math.floor((Math.min(...known) * 100 - 5) / 10) * 10) / 100 : 0;
  const x = (i: number) => left + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => top + plotH - ((v - low) / Math.max(0.01, 1 - low)) * plotH;
  const path = points.flatMap((p, i) => (p === null ? [] : [`${x(i)},${y(p)}`])).join(' ');
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Cache hit rate per ${labels.length > 1 ? 'day' : 'period'}`} className="block overflow-visible">
          {[low, (low + 1) / 2, 1].map((v) => (
            <g key={v}>
              <line x1={left} x2={left + plotW} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth="1" />
              <text x={left - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize="11" fill={AXIS}>
                {Math.round(v * 100)}%
              </text>
            </g>
          ))}
          <polyline points={path} fill="none" stroke="var(--sb-text)" strokeWidth="2" strokeLinejoin="round" />
          {labels.map((label, i) => (
            <g key={i}>
              <text x={x(i)} y={height - 4} textAnchor="middle" fontSize="11" fill={AXIS}>
                {label}
              </text>
              <rect x={x(i) - plotW / Math.max(1, points.length) / 2} y={top} width={plotW / Math.max(1, points.length)} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          ))}
          {hover !== null && points[hover] !== null && <circle cx={x(hover)} cy={y(points[hover]!)} r="4" fill="var(--sb-text)" stroke="var(--sb-card)" strokeWidth="2" />}
        </svg>
      )}
      {hover !== null && points[hover] !== null && (
        <ChartTooltip x={x(hover)} y={top} width={width} title={labels[hover] ?? ''} rows={[{ color: 'var(--sb-text)', label: 'Cache hit rate', value: format(points[hover]!) }]} />
      )}
    </div>
  );
}
