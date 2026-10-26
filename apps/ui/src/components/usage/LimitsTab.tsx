import { useEffect, useMemo, useState } from 'react';
import { Info, Monitor, Zap } from 'lucide-react';
import type { UsageLimit, UsagePeriod, UsageScan } from '@seshboard/protocol/client';
import { basename } from '../../lib/format.ts';
import { thisComputerName } from '../../lib/platform.ts';
import { useComputers } from '../../state/computersStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { remoteProjectKey } from '../../state/remoteRows.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { ComputerChip } from '../computers/ComputerChip.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { Notice } from '../ui/Notice.tsx';
import { useUsageFor } from '../UsageBand.tsx';
import { usageMessage, visibleLimits, windowCostOf } from '../usageFormat.ts';
import { useCostFormat } from './useCost.ts';
import { useWindowCosts } from './useWindowCosts.ts';
import { ChartCard, ChartTable, LegendItem, PercentLines } from './charts.tsx';
import { ShareInfo } from './ShareInfo.tsx';
import type { MergedRow, Uncounted } from './usageMerge.ts';
import { useBreakdown, useCountedBreakdown, usePlanHistory } from './useUsageData.ts';
import { computersLabel, foldRows, formatShare, historyTooShort, isLow, limitTitle, modelName, percentLeft, PERIOD_SHORT, recordedSince, resetsIn, seriesColor, seriesName, sinceLabel, visibleSeries } from './usageModel.ts';

/** One plan window: what's left in large type, a bar whose used part is hatched (it comes back at the reset), and when. */
function LimitCard({ limit, now, cost, costWhere }: { limit: UsageLimit; now: number; /** The window's estimated cost ("≈$23.14"), when it is shown. */ cost: string | null; /** "on This PC and mystic": whose tokens it counts. */ costWhere: string }) {
  const { name, scope } = limitTitle(limit);
  const left = percentLeft(limit);
  const low = isLow(left);
  const used = 100 - left;
  const reset = limit.resetsAt ? resetsIn(limit.resetsAt, now) : null;
  return (
    <article className="grid min-w-0 gap-2.5 rounded-xl border border-border bg-card p-4" aria-label={`${name}: ${Math.round(left)}% left`} data-usage-limit={limit.kind}>
      <p className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-ui font-semibold text-text">{name}</span>
        <span className="truncate text-meta text-muted">{scope}</span>
      </p>
      <p className="flex items-baseline gap-1.5">
        <span className={`text-display font-semibold tabular-nums ${low ? 'text-caution' : 'text-text'}`} data-usage-left>
          {Math.round(left)}%
        </span>
        <span className="text-body text-muted">left</span>
      </p>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full" role="meter" aria-label={`${name}: ${Math.round(used)}% used`} aria-valuenow={Math.round(used)} aria-valuemin={0} aria-valuemax={100}>
        <span className="hatched h-full" style={{ width: `${used}%` }} />
        {/* A 2px gap between the parts, in the card's colour. */}
        {used > 0 && left > 0 && <span className="h-full w-0.5 shrink-0 bg-card" />}
        <span className={`h-full flex-1 ${low ? 'bg-caution' : 'bg-muted/60'}`} />
      </div>
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-meta text-muted">
        <span>{Math.round(used)}% used, back at the reset</span>
        {reset && (
          <span>
            Resets in <span className="font-semibold text-text">{reset.wait}</span> · {reset.at}
          </span>
        )}
      </p>
      {cost && (
        <p className="text-meta text-muted" data-tooltip={`What this window's tokens ${costWhere} would cost at Anthropic's API prices. Your plan is not billed per token.`} data-usage-limit-cost>
          <span className="font-semibold text-text tabular-nums">{cost}</span> at API prices
        </p>
      )}
    </article>
  );
}

/** While the first read of the transcripts runs: how far it is. Numbers appear as it goes. */
export function ScanProgress({ scan }: { scan: UsageScan }) {
  const percent = scan.total ? (scan.done / scan.total) * 100 : 0;
  return (
    <section className="grid gap-2 rounded-xl border border-border bg-card p-4" aria-label="Reading transcripts" data-usage-scan>
      <p className="flex flex-wrap items-baseline gap-x-2 text-ui">
        <span className="font-semibold">Reading transcripts</span>
        <span className="text-meta text-muted">first time only, then it reads what's new</span>
        {scan.total > 0 && (
          <span className="ml-auto text-meta text-muted tabular-nums">
            {scan.done.toLocaleString()} of {scan.total.toLocaleString()}
          </span>
        )}
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-selected" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} aria-label="Transcripts read">
        <span className="block h-full rounded-full bg-muted" style={{ width: `${percent}%` }} />
      </div>
    </section>
  );
}

/** A Share (est.) bar and its percentage. */
export function ShareBar({ share, compact = false }: { share: number; compact?: boolean }) {
  return (
    <span className="flex items-center justify-end gap-2.5">
      <span className={`h-1.5 ${compact ? 'w-12' : 'w-20'} overflow-hidden rounded-full bg-selected`} aria-hidden>
        <span className="block h-full rounded-full bg-text/75" style={{ width: `${Math.min(100, share * 100)}%` }} />
      </span>
      <span className="w-9 text-right tabular-nums">{formatShare(share)}</span>
    </span>
  );
}

/** A session row's model, with a bolt when some of its turns ran in fast mode. */
export function ModelCell({ model, fastTurns }: { model: string | null; fastTurns: number }) {
  return (
    <span className="flex items-center gap-1">
      {modelName(model)}
      {fastTurns > 0 && (
        <span data-tooltip={`Fast mode turns: ${fastTurns}`} aria-label={`${fastTurns} fast mode turns`} role="img" className="text-accent-ink">
          <Zap size={12} aria-hidden />
        </span>
      )}
    </span>
  );
}

/** Opens a session from a usage row, here or on another computer, when it is still in that list. */
export function useOpenSession() {
  const sessions = useSessions((s) => s.sessions);
  const lists = useComputers((s) => s.lists);
  return (row: MergedRow) => {
    const id = row.sessionId;
    if (!id) return null;
    if (row.computer) {
      // Another computer's session, while its list there has it.
      const computerId = row.computer.id;
      return lists.get(computerId)?.sessions.some((s) => s.id === id) ? () => useComputers.getState().openSession({ computerId, sessionId: id }) : null;
    }
    return sessions.has(id) ? () => useSessions.getState().select(id) : null;
  };
}

/** The project a row belongs to, for its icon and name. */
export function useProjectName() {
  const projects = useProjects((s) => s.projects);
  return (root: string | null) => (root ? (projects.get(root)?.name ?? basename(root)) : 'Unknown folder');
}

/** The name of a row's project: this computer's, or another computer's, which comes without its folder. */
export function rowProjectName(row: MergedRow, nameOf: (root: string | null) => string): string {
  return row.remoteProject ? (row.remoteProject.name ?? 'Unknown folder') : nameOf(row.projectRoot);
}

/** A row's project icon; another computer's carries the computer badge. */
export function RowProjectIcon({ row, size }: { row: MergedRow; size: number }) {
  const projects = useProjects((s) => s.projects);
  if (row.computer) return row.remoteProject?.id ? <ProjectIcon project={undefined} root={remoteProjectKey(row.computer.id, row.remoteProject.id)} name={row.remoteProject.name ?? undefined} size={size} remote /> : null;
  return row.projectRoot ? <ProjectIcon project={projects.get(row.projectRoot)} root={row.projectRoot} size={size} /> : null;
}

/** The chip of the computer a row's tokens were used on, when that is another computer. */
export function RowComputer({ row }: { row: MergedRow }) {
  return row.computer ? <ComputerChip name={row.computer.name} data-usage-row-computer={row.computer.id} /> : null;
}

/** Why paired computers' tokens aren't in the numbers: offline, an older Seshboard, another account, or no account here. */
export function NotCounted({ uncounted, noAccount, inline = false }: { uncounted: readonly Uncounted[]; noAccount: boolean; inline?: boolean }) {
  if (!noAccount && uncounted.length === 0) return null;
  const text = noAccount ? "This profile isn't signed in to a claude.ai account, so other computers can't be matched to it." : `Not counted: ${uncounted.map((u) => u.reason).join(' ')}`;
  return (
    <Notice icon={<Monitor size={14} aria-hidden />} inline={inline} data-tooltip={inline ? text : undefined} data-usage-uncounted>
      {text}
    </Notice>
  );
}

/** Which sessions used the current window: the top five and the rest folded into one line. */
function WindowSessions({ profileId }: { profileId: string }) {
  const { data, counted, uncounted, noAccount } = useCountedBreakdown(profileId, 'window', 'session');
  const nameOf = useProjectName();
  const open = useOpenSession();
  const { shown, rest } = useMemo(() => foldRows(data?.rows ?? [], 5), [data]);
  const cost = useCostFormat();
  // Session, model, cost (while it shows) and share.
  const cols = cost ? 'grid-cols-[minmax(0,1fr)_auto_auto_auto]' : 'grid-cols-[minmax(0,1fr)_auto_auto]';
  return (
    <section className="grid min-w-0 content-start rounded-xl border border-border bg-card" aria-label="What used this window" data-usage-window>
      <header className="flex flex-wrap items-baseline gap-x-2 px-4 pt-4 pb-3">
        <h2 className="text-ui font-semibold">What used this window</h2>
        {data && (
          <p className="text-meta text-muted">
            since {sinceLabel(data.from)} · {data.totals.sessions} {data.totals.sessions === 1 ? 'session' : 'sessions'}
            {counted.length > 0 && ` · ${computersLabel(counted.length + 1)}`}
          </p>
        )}
      </header>
      {(noAccount || uncounted.length > 0) && (
        <div className="px-4 pb-2">
          <NotCounted uncounted={uncounted} noAccount={noAccount} inline />
        </div>
      )}
      <div className={`grid ${cols} items-center gap-x-4 border-b border-border px-4 pb-2 text-meta tracking-wide text-muted uppercase`}>
        <span>Session</span>
        <span className="w-14">Model</span>
        {cost && <span className="w-16 text-right">Cost (est.)</span>}
        <ShareInfo className="w-24 text-right uppercase hover:text-text" data-usage-share-header>
          Share (est.)
        </ShareInfo>
      </div>
      {data && data.rows.length === 0 && <p className="px-4 py-3 text-ui text-muted">Nothing used this window yet.</p>}
      {shown.map((row) => {
        const onOpen = open(row);
        return (
          <button
            key={row.key}
            type="button"
            disabled={!onOpen}
            onClick={onOpen ?? undefined}
            className={`grid ${cols} items-center gap-x-4 border-b border-border px-4 py-2 text-left text-ui enabled:hover:bg-border/45`}
            data-usage-row={row.sessionId ?? row.key}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <RowProjectIcon row={row} size={20} />
              <span className="grid min-w-0">
                <span className="truncate font-medium text-text">{row.label}</span>
                <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted">
                  <span className="truncate">{rowProjectName(row, nameOf)}</span>
                  <RowComputer row={row} />
                </span>
              </span>
            </span>
            <span className="w-14 text-muted">
              <ModelCell model={row.model} fastTurns={row.fastTurns} />
            </span>
            {cost && <span className="w-16 text-right text-muted tabular-nums">{cost(row.cost)}</span>}
            <span className="w-24">
              <ShareBar share={row.share} compact />
            </span>
          </button>
        );
      })}
      {rest && (
        <p className={`grid ${cols} gap-x-4 border-b border-border px-4 py-2 text-ui text-muted`}>
          <span>{rest.count} more</span>
          <span className="w-14" />
          {cost && <span className="w-16 text-right tabular-nums">{cost(rest.cost)}</span>}
          <span className="w-24 text-right tabular-nums">{formatShare(rest.share)}</span>
        </p>
      )}
      <p className="flex gap-2 px-4 py-3 text-meta text-muted">
        <Info size={13} className="mt-px shrink-0 text-link" aria-hidden />
        <span>
          Shares come from token counts, so they are estimates. Claude doesn't report usage per session.{' '}
          <ShareInfo className="text-link hover:underline">How it's counted</ShareInfo>
        </span>
      </p>
    </section>
  );
}

/** The Limits tab: a card per plan window, % used over time, and which sessions used the current window. */
export function LimitsTab({ profileId, period }: { profileId: string; period: UsagePeriod }) {
  const entry = useUsageFor(profileId);
  const history = usePlanHistory(profileId, period);
  const scan = useBreakdown(profileId, 'window', 'session')?.scan ?? null;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const limits = entry?.usage ? visibleLimits(entry.usage.limits) : [];
  const cost = useCostFormat();
  const priced = useWindowCosts(profileId, cost !== null && limits.length > 0);
  const windowCosts = priced.windows;
  // Which computers the cards' costs count, once others are paired.
  const costWhere = priced.counted.length > 0 ? `on ${[thisComputerName(), ...priced.counted.map((c) => c.name)].join(' and ')}` : 'on this computer';
  const series = useMemo(() => visibleSeries(period, history?.series ?? []), [period, history]);
  const range = useMemo(() => {
    const to = now;
    const session = entry?.usage?.limits.find((l) => l.kind === 'session');
    const hours = period === 'window' ? 5 : period === 'day' ? 24 : period === 'week' ? 24 * 7 : 24 * 30;
    const from = period === 'window' && session?.resetsAt && session.resetsAt > now ? session.resetsAt - 5 * 3_600_000 : to - hours * 3_600_000;
    return { from, to };
  }, [period, now, entry]);
  const weeklyOnly = period === 'week' || period === 'month';
  const since = history?.since ?? null;
  const tooShort = historyTooShort(period, since, series.length, now);
  const startedAt = recordedSince(period, since, range.from);

  return (
    <>
      {scan && <ScanProgress scan={scan} />}
      {limits.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-4 text-ui text-muted" data-tooltip={entry?.error ?? undefined} data-usage-status>
          {usageMessage(entry)}
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
          {limits.map((limit) => (
            <LimitCard key={`${limit.kind}:${limit.scope ?? ''}`} limit={limit} now={now} costWhere={costWhere} cost={cost && windowCostOf(limit, windowCosts) ? cost(windowCostOf(limit, windowCosts)!.usd) : null} />
          ))}
        </div>
      )}
      <div className="grid items-start gap-4 min-[1200px]:grid-cols-[minmax(0,1.4fr)_minmax(380px,1fr)]">
        <ChartCard
          title="% used over time"
          subtitle={`${period === 'window' ? 'current window' : `last ${PERIOD_SHORT[period]}`}${startedAt && !tooShort ? ` · recorded since ${startedAt}` : ''}${weeklyOnly ? ' · the 5h session shows at 24 hours and less' : ''}`}
          legend={series.length >= 2 && !tooShort ? series.map((s) => <LegendItem key={`${s.kind}:${s.scope ?? ''}`} color={seriesColor(s)} label={seriesName(s)} dashed={s.kind === 'session'} />) : null}
          table={
            <ChartTable
              caption="% used over time"
              head={['Time', ...series.map(seriesName)]}
              rows={[...new Set(series.flatMap((s) => s.points.map((p) => p.at)))]
                .sort((a, b) => a - b)
                .map((at) => [new Date(at).toLocaleString(), ...series.map((s) => {
                  const p = s.points.find((point) => point.at === at);
                  return p ? `${Math.round(p.percent)}%` : '';
                })])}
            />
          }
          data-usage-history
        >
          {tooShort ? (
            <div className="grid h-[300px] place-content-center justify-items-center gap-1 rounded-lg border border-dashed border-edge px-8 text-center" data-usage-history-empty>
              <p className="text-ui font-semibold">History starts now</p>
              <p className="max-w-[48ch] text-balance text-ui text-muted">
                {series.length === 0 || since === null
                  ? 'Seshboard records your plan % each time it checks. The chart fills in from today.'
                  : `Seshboard has recorded your plan % since ${recordedSince('day', since, 0)}. This chart fills in over the next days. Pick 24 hours to see it now.`}
              </p>
            </div>
          ) : (
            <PercentLines series={series} from={range.from} to={range.to} period={period} />
          )}
        </ChartCard>
        <WindowSessions profileId={profileId} />
      </div>
    </>
  );
}
