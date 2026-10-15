import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { MessageCircleQuestion, NotebookText, Search, X, Zap } from 'lucide-react';
import type { UsageBreakdown, UsageGroup, UsagePeriod, UsageRow } from '@switchboard/protocol/client';
import { useProjects } from '../../state/projectsStore.ts';
import { useUsageView } from '../../state/usageViewStore.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { Button } from '../ui/Button.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { AutoWand } from '../composer/ComposerChips.tsx';
import { ChartCard, ChartTable, LegendItem, RateLine, StackedBars } from './charts.tsx';
import { ModelCell, ScanProgress, ShareBar, useOpenSession, useProjectName } from './LimitsTab.tsx';
import { ShareInfo } from './ShareInfo.tsx';
import { useBreakdown } from './useUsageData.ts';
import {
  bucketLabel,
  cacheHitRate,
  chartTypes,
  dayLabel,
  filterRows,
  foldRows,
  formatShare,
  formatTokens,
  modelName,
  PERIOD_SHORT,
  sumTokens,
  TOKEN_COLOR,
  TOKEN_LABEL,
  TOKEN_TYPES,
} from './usageModel.ts';

const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '0%');

/** The period's totals: all tokens with sessions and turns, each type with its part of the whole, and the cache hit rate. */
function Headline({ data, profileName, period }: { data: UsageBreakdown; profileName: string; period: UsagePeriod }) {
  const total = sumTokens(data.totals.tokens);
  const hit = cacheHitRate(data.totals.tokens);
  const tile = (label: ReactNode, value: string, note: string, key: string) => (
    <div key={key} className="grid min-w-[120px] content-start gap-0.5 border-l border-border px-4 py-1 first:border-l-0" data-usage-tile={key}>
      <p className="flex items-center gap-1.5 text-meta text-muted">{label}</p>
      <p className="text-title font-semibold tabular-nums">{value}</p>
      <p className="text-meta text-muted">{note}</p>
    </div>
  );
  return (
    <section className="flex flex-wrap items-stretch gap-y-3 rounded-xl border border-border bg-card py-3" aria-label="Totals" data-usage-headline>
      <div className="grid min-w-[200px] content-start gap-0.5 px-4">
        <p className="text-meta text-muted">
          {PERIOD_SHORT[period]} · {profileName}
        </p>
        <p className="flex items-baseline gap-1.5">
          <span className="text-display font-semibold tabular-nums" data-usage-total>
            {formatTokens(total)}
          </span>
          <span className="text-body text-muted">tokens</span>
        </p>
        <p className="text-meta text-muted">
          {data.totals.sessions.toLocaleString()} {data.totals.sessions === 1 ? 'session' : 'sessions'} · {data.totals.turns.toLocaleString()} turns
        </p>
      </div>
      {[...TOKEN_TYPES].reverse().map((type) =>
        tile(
          <>
            <span className="size-2.5 rounded-[3px]" style={{ background: TOKEN_COLOR[type] }} aria-hidden />
            {TOKEN_LABEL[type]}
          </>,
          formatTokens(data.totals.tokens[type]),
          type === 'cacheRead' ? `${percent(data.totals.tokens[type], total)} of tokens` : percent(data.totals.tokens[type], total),
          type,
        ),
      )}
      {tile('Cache hit rate', hit === null ? 'None' : `${Math.round(hit * 100)}%`, 'cache read / all input', 'hit')}
    </section>
  );
}

/** Tokens per hour (5 hours, 24 hours) or day, stacked by type. Cache reads are left out by default. */
function TokensChart({ data, period }: { data: UsageBreakdown; period: UsagePeriod }) {
  const [mode, setMode] = useState<'all' | 'without'>('without');
  const types = chartTypes(mode === 'all');
  const per = data.bucket === 'hour' ? 'hour' : 'day';
  return (
    <ChartCard
      title={`Tokens per ${per}`}
      legend={[...TOKEN_TYPES].reverse().map((type) => (
        <LegendItem key={type} color={TOKEN_COLOR[type]} label={TOKEN_LABEL[type]} dim={!types.includes(type)} />
      ))}
      controls={
        <SegmentedControl<'all' | 'without'>
          mode="radio"
          size="sm"
          label="Tokens shown"
          value={mode}
          onChange={setMode}
          segments={[
            { value: 'all', label: 'All tokens', data: { 'data-usage-cache-reads': 'all' } },
            { value: 'without', label: 'Without cache reads', tooltip: 'Cache reads are most of the tokens and hide everything else', data: { 'data-usage-cache-reads': 'without' } },
          ]}
        />
      }
      table={
        <ChartTable
          caption={`Tokens per ${per}`}
          head={[per === 'hour' ? 'Hour' : 'Day', ...[...TOKEN_TYPES].reverse().map((t) => TOKEN_LABEL[t]), 'Total']}
          rows={data.buckets.map((b) => [bucketLabel(b.start, data.bucket, period), ...[...TOKEN_TYPES].reverse().map((t) => formatTokens(b.tokens[t])), formatTokens(sumTokens(b.tokens))])}
        />
      }
      data-usage-chart
    >
      <StackedBars buckets={data.buckets} types={types} bucket={data.bucket} period={period} />
    </ChartCard>
  );
}

interface Column {
  head: ReactNode;
  /** Grid track. */
  width: string;
  align?: 'right';
  cell(row: UsageRow): ReactNode;
  /** The column's value in the "N more" line, when it adds up. */
  total?(rest: Folded): ReactNode;
}

type Folded = NonNullable<ReturnType<typeof foldRows>['rest']>;

const num = (n: number) => n.toLocaleString();

/** The Auto routing row's name: the calls Haiku made to pick a model for new sessions (they leave no transcript). */
function AutoRoutingName({ model }: { model: string | null }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5" data-usage-auto-routing>
      <AutoWand />
      <span className="truncate font-medium">Auto routing</span>
      <span className="shrink-0 text-meta font-normal text-faint">· {modelName(model)}</span>
    </span>
  );
}

/** The Side questions row's name: what Ask about this session used to answer (its fork leaves no transcript). */
function SideQuestionsName({ model }: { model: string | null }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5" data-usage-side-questions>
      <MessageCircleQuestion size={14} aria-hidden className="shrink-0 text-link" />
      <span className="truncate font-medium">Side questions</span>
      <span className="shrink-0 text-meta font-normal text-faint">· {modelName(model)}</span>
    </span>
  );
}

/** The Catch-up summaries row's name: the calls Haiku made to write the briefings on finished turns (no transcript either). */
function CatchUpSummariesName({ model }: { model: string | null }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5" data-usage-catchup-summaries>
      <NotebookText size={13} className="shrink-0 text-muted" aria-hidden />
      <span className="truncate font-medium">Catch-up summaries</span>
      <span className="shrink-0 text-meta font-normal text-faint">· {modelName(model)}</span>
    </span>
  );
}

/** The name of a row whose tokens left no transcript (Auto routing, Side questions, Catch-up summaries), or null for any other row. */
function apartName(r: UsageRow): ReactNode | null {
  if (r.autoRouting) return <AutoRoutingName model={r.model} />;
  if (r.sideQuestions) return <SideQuestionsName model={r.model} />;
  if (r.catchUpSummaries) return <CatchUpSummariesName model={r.model} />;
  return null;
}

/** The columns for each grouping. Numbers are right-aligned in tabular figures. */
function useColumns(groupBy: UsageGroup): Column[] {
  const projects = useProjects((s) => s.projects);
  const nameOf = useProjectName();
  const share: Column = {
    head: (
      <ShareInfo className="w-full text-right uppercase hover:text-text" data-usage-share-header>
        Share (est.)
      </ShareInfo>
    ),
    width: '128px',
    align: 'right',
    cell: (r) => <ShareBar share={r.share} />,
    total: (rest) => formatShare(rest.share),
  };
  const tokens: Column[] = [
    { head: 'Turns', width: '52px', align: 'right', cell: (r) => num(r.turns), total: (rest) => num(rest.turns) },
    { head: 'Output', width: '64px', align: 'right', cell: (r) => formatTokens(r.tokens.output), total: (rest) => formatTokens(rest.tokens.output) },
    { head: 'Cache write', width: '84px', align: 'right', cell: (r) => formatTokens(r.tokens.cacheWrite), total: (rest) => formatTokens(rest.tokens.cacheWrite) },
    { head: 'Cache read', width: '84px', align: 'right', cell: (r) => formatTokens(r.tokens.cacheRead), total: (rest) => formatTokens(rest.tokens.cacheRead) },
  ];
  const largest: Column = { head: 'Largest context', width: '76px', align: 'right', cell: (r) => formatTokens(r.largestContext) };
  // The Auto routing row counts picks, Side questions questions and the catch-up row summaries, not sessions.
  const sessions: Column = {
    head: 'Sessions',
    width: '72px',
    align: 'right',
    cell: (r) =>
      r.autoRouting
        ? `${num(r.autoRouting.picks)} ${r.autoRouting.picks === 1 ? 'pick' : 'picks'}`
        : r.sideQuestions
          ? `${num(r.sideQuestions.asked)} ${r.sideQuestions.asked === 1 ? 'question' : 'questions'}`
        : r.catchUpSummaries
          ? `${num(r.catchUpSummaries.calls)} ${r.catchUpSummaries.calls === 1 ? 'summary' : 'summaries'}`
          : num(r.sessions),
  };
  if (groupBy === 'session') {
    return [
      {
        head: 'Session',
        width: 'minmax(160px,2fr)',
        cell: (r) =>
          apartName(r) ?? (
            <span className="flex min-w-0 items-center gap-2.5">
              {r.projectRoot && <ProjectIcon project={projects.get(r.projectRoot)} root={r.projectRoot} size={18} />}
              <span className="truncate font-medium">{r.label}</span>
            </span>
          ),
      },
      { head: 'Project', width: 'minmax(90px,1fr)', cell: (r) => <span className="truncate text-muted">{r.autoRouting || r.sideQuestions || r.catchUpSummaries ? '' : nameOf(r.projectRoot)}</span> },
      { head: 'Model', width: '72px', cell: (r) => <ModelCell model={r.model} fastTurns={r.fastTurns} /> },
      ...tokens,
      largest,
      share,
    ];
  }
  if (groupBy === 'project') {
    return [
      {
        head: 'Project',
        width: 'minmax(180px,2fr)',
        cell: (r) =>
          apartName(r) ?? (
            <span className="flex min-w-0 items-center gap-2.5">
              {r.projectRoot && <ProjectIcon project={projects.get(r.projectRoot)} root={r.projectRoot} size={18} />}
              <span className="truncate font-medium">{nameOf(r.projectRoot)}</span>
            </span>
          ),
      },
      sessions,
      ...tokens,
      largest,
      share,
    ];
  }
  if (groupBy === 'model') {
    return [
      {
        head: 'Model',
        width: 'minmax(160px,2fr)',
        cell: (r) =>
          apartName(r) ?? (
            <span className="flex items-center gap-1.5 font-medium">
              {modelName(r.model)}
              {r.byAuto ? (
                <span className="shrink-0 text-meta font-normal text-muted" data-tooltip="Sessions Auto started on this model" data-usage-by-auto>
                  · {num(r.byAuto)} by Auto
                </span>
              ) : null}
              <span className="truncate font-mono text-meta font-normal text-faint">{r.model}</span>
              {r.fastTurns > 0 && (
                <span data-tooltip="Fast mode turns" className="flex items-center gap-0.5 text-meta font-normal text-muted">
                  <Zap size={12} className="text-accent-ink" aria-hidden />
                  {num(r.fastTurns)}
                </span>
              )}
            </span>
          ),
      },
      sessions,
      ...tokens,
      { head: 'Cache hit', width: '72px', align: 'right', cell: (r) => (cacheHitRate(r.tokens) === null ? '' : `${Math.round(cacheHitRate(r.tokens)! * 100)}%`) },
      share,
    ];
  }
  return [{ head: 'Day', width: 'minmax(160px,2fr)', cell: (r) => <span className="font-medium">{dayLabel(r.label)}</span> }, sessions, ...tokens, largest, share];
}

const ROW_HEIGHT = 44;

/** Where the period's tokens went, grouped by session, project, model or day. */
function Breakdown({ data, profileId, period, onModel, model }: { data: UsageBreakdown; profileId: string; period: UsagePeriod; onModel(model: string): void; model: string | null }) {
  const groupBy = useUsageView((s) => s.groupBy);
  const setGroupBy = useUsageView((s) => s.setGroupBy);
  const [filter, setFilter] = useState('');
  const [all, setAll] = useState(false);
  const columns = useColumns(groupBy);
  const nameOf = useProjectName();
  const open = useOpenSession();
  const filtered = useMemo(() => filterRows(data.rows, filter, (root) => nameOf(root)), [data.rows, filter, nameOf]);
  // A filter shows every match; otherwise the top five, then "N more".
  const { shown, rest } = useMemo(() => (all || filter.trim() ? { shown: filtered, rest: null } : foldRows(filtered, 5)), [filtered, all, filter]);
  const template = columns.map((c) => c.width).join(' ');
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtual = shown.length > 40;
  const virtualizer = useVirtualizer({ count: shown.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_HEIGHT, overscan: 8 });
  const noun = groupBy === 'session' ? 'sessions' : groupBy === 'project' ? 'projects' : groupBy === 'model' ? 'models' : 'days';

  const rowAction = (row: UsageRow) => (row.autoRouting || row.sideQuestions || row.catchUpSummaries ? null : groupBy === 'session' ? open(row.sessionId) : groupBy === 'model' && row.model ? () => onModel(row.model!) : null);
  const renderRow = (row: UsageRow, style?: CSSProperties) => {
    const action = rowAction(row);
    const selected = groupBy === 'model' && row.model === model;
    return (
      <div
        key={row.key}
        role="row"
        tabIndex={action ? 0 : undefined}
        onClick={action ?? undefined}
        onKeyDown={action ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), action()) : undefined}
        aria-selected={groupBy === 'model' ? selected : undefined}
        style={{ gridTemplateColumns: template, ...style }}
        className={`grid items-center gap-x-3 border-b border-border px-4 text-ui ${action ? 'cursor-pointer hover:bg-border/45' : ''} ${selected ? 'bg-selected' : ''}`}
        data-usage-row={row.sessionId ?? row.key}
      >
        {columns.map((c, i) => (
          <span key={i} role="cell" className={`flex min-w-0 items-center py-2.5 ${c.align === 'right' ? 'justify-end text-right tabular-nums' : ''}`}>
            {c.cell(row)}
          </span>
        ))}
      </div>
    );
  };

  return (
    <section className="grid min-w-0 rounded-xl border border-border bg-card" aria-label="Breakdown" data-usage-breakdown={groupBy}>
      <header className="flex flex-wrap items-center gap-3 px-4 py-3">
        <h2 className="text-ui font-semibold">Breakdown</h2>
        <SegmentedControl<UsageGroup>
          mode="radio"
          label="Group by"
          value={groupBy}
          onChange={(value) => {
            setGroupBy(value);
            setAll(false);
          }}
          segments={(['session', 'project', 'model', 'day'] as const).map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1), data: { 'data-usage-group': value } }))}
        />
        <label className="ml-auto flex h-8 w-64 max-w-full min-w-0 items-center gap-2 rounded-lg border border-edge bg-bg px-2.5 text-ui focus-within:border-accent-ink">
          <Search size={13} className="shrink-0 text-muted" aria-hidden />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              // Esc clears the filter first; the view goes back on the next one.
              if (e.key === 'Escape' && filter) {
                e.preventDefault();
                setFilter('');
              }
            }}
            placeholder={`Filter ${noun}`}
            aria-label={`Filter ${noun}`}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint"
            data-usage-filter
          />
          {filter && <Button variant="quiet" size="sm" iconOnly icon={<X size={12} aria-hidden />} aria-label="Clear filter" onClick={() => setFilter('')} />}
        </label>
      </header>
      {/* Narrow windows scroll the table sideways rather than squeezing its numbers. */}
      <div role="table" aria-label={`Tokens by ${groupBy}`} aria-rowcount={shown.length + 1} className="min-w-0 overflow-x-auto">
        <div className="min-w-[900px]">
        <div role="row" style={{ gridTemplateColumns: template }} className="grid items-end gap-x-3 border-b border-border px-4 pb-2 text-meta tracking-wide text-muted uppercase">
          {columns.map((c, i) => (
            <span key={i} role="columnheader" className={c.align === 'right' ? 'text-right' : ''}>
              {c.head}
            </span>
          ))}
        </div>
        {shown.length === 0 && <p className="px-4 py-3 text-ui text-muted">{filter ? 'Nothing matches the filter.' : 'No tokens in this period.'}</p>}
        {virtual ? (
          <div ref={scrollRef} className="max-h-[560px] overflow-y-auto" data-usage-virtual>
            <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((item) => renderRow(shown[item.index]!, { position: 'absolute', top: 0, left: 0, right: 0, height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }))}
            </div>
          </div>
        ) : (
          shown.map((row) => renderRow(row))
        )}
        {rest && (
          <button
            type="button"
            onClick={() => setAll(true)}
            style={{ gridTemplateColumns: template }}
            className="grid w-full items-center gap-x-3 px-4 py-2.5 text-left text-ui text-muted hover:bg-border/45"
            data-usage-more
          >
            {columns.map((c, i) => (
              <span key={i} className={c.align === 'right' ? 'text-right tabular-nums' : ''}>
                {i === 0 ? `${rest.count} more ${noun}` : (c.total?.(rest) ?? '')}
              </span>
            ))}
          </button>
        )}
        </div>
      </div>
      {model && groupBy === 'model' && <ModelPanel profileId={profileId} period={period} model={model} />}
    </section>
  );
}

/** One model: its tokens, sessions, fast mode turns, largest context, and its cache hit rate over the period. */
function ModelPanel({ profileId, period, model }: { profileId: string; period: UsagePeriod; model: string }) {
  const data = useBreakdown(profileId, period, 'session', model);
  if (!data) return null;
  const hit = cacheHitRate(data.totals.tokens);
  const input = data.totals.tokens.input + data.totals.tokens.cacheRead + data.totals.tokens.cacheWrite;
  const points = data.buckets.map((b) => cacheHitRate(b.tokens));
  return (
    <section className="m-4 mt-3 grid gap-3 rounded-lg border border-edge p-4" aria-label={`${modelName(model)} details`} data-usage-model-panel={model}>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-title font-semibold">{modelName(model)}</h3>
        <p className="text-meta text-muted">
          {PERIOD_SHORT[period]} · {formatTokens(sumTokens(data.totals.tokens))} tokens · {data.totals.sessions} {data.totals.sessions === 1 ? 'session' : 'sessions'}
        </p>
        <p className="ml-auto text-ui text-muted">
          Cache hit rate <span className="ml-1 text-title font-semibold text-text tabular-nums">{hit === null ? 'None' : `${Math.round(hit * 100)}%`}</span>
        </p>
      </header>
      <p className="flex flex-wrap gap-x-5 text-ui text-muted">
        <span className="flex items-center gap-1" data-tooltip="Fast mode turns">
          <Zap size={12} className="text-accent-ink" aria-hidden />
          {num(data.totals.fastTurns)} fast mode turns
        </span>
        <span>Largest context {formatTokens(data.totals.largestContext)}</span>
        <span>Avg turn {formatTokens(data.totals.turns ? input / data.totals.turns : 0)}</span>
      </p>
      <RateLine points={points} labels={data.buckets.map((b) => bucketLabel(b.start, data.bucket, period))} format={(v) => `${Math.round(v * 100)}%`} />
    </section>
  );
}

/** The Tokens tab: totals, tokens per hour or day, and the breakdown. */
export function TokensTab({ profileId, profileName, period }: { profileId: string; profileName: string; period: UsagePeriod }) {
  const groupBy = useUsageView((s) => s.groupBy);
  const data = useBreakdown(profileId, period, groupBy);
  const [model, setModel] = useState<string | null>(null);
  if (!data) return <p className="text-ui text-muted">Loading usage…</p>;
  return (
    <>
      {data.scan && <ScanProgress scan={data.scan} />}
      <Headline data={data} profileName={profileName} period={period} />
      <TokensChart data={data} period={period} />
      <Breakdown data={data} profileId={profileId} period={period} model={model} onModel={(m) => setModel(model === m ? null : m)} />
    </>
  );
}
