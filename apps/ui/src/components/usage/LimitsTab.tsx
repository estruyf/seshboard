import { useEffect, useMemo, useState } from 'react';
import { Info, Zap } from 'lucide-react';
import type { UsageLimit, UsagePeriod, UsageRow, UsageScan } from '@switchboard/protocol/client';
import { basename } from '../../lib/format.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { useUsageFor } from '../UsageBand.tsx';
import { usageMessage, visibleLimits } from '../usageFormat.ts';
import { ChartCard, ChartTable, LegendItem, PercentLines } from './charts.tsx';
import { ShareInfo } from './ShareInfo.tsx';
import { useBreakdown, usePlanHistory } from './useUsageData.ts';
import { foldRows, formatShare, isLow, limitTitle, modelName, percentLeft, PERIOD_SHORT, resetsIn, seriesColor, seriesName, sinceLabel, visibleSeries } from './usageModel.ts';

/** One plan window: what's left in large type, a bar whose used part is hatched (it comes back at the reset), and when. */
function LimitCard({ limit, now }: { limit: UsageLimit; now: number }) {
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

/** Opens a session from a usage row, when it is still in the list. */
export function useOpenSession() {
  const sessions = useSessions((s) => s.sessions);
  return (id: string | null) => (id && sessions.has(id) ? () => useSessions.getState().select(id) : null);
}

/** The project a row belongs to, for its icon and name. */
export function useProjectName() {
  const projects = useProjects((s) => s.projects);
  return (root: string | null) => (root ? (projects.get(root)?.name ?? basename(root)) : 'Unknown folder');
}

/** Which sessions used the current window: the top five and the rest folded into one line. */
function WindowSessions({ profileId }: { profileId: string }) {
  const data = useBreakdown(profileId, 'window', 'session');
  const projects = useProjects((s) => s.projects);
  const nameOf = useProjectName();
  const open = useOpenSession();
  const { shown, rest } = useMemo(() => foldRows(data?.rows ?? [], 5), [data]);
  return (
    <section className="grid min-w-0 content-start rounded-xl border border-border bg-card" aria-label="What used this window" data-usage-window>
      <header className="flex flex-wrap items-baseline gap-x-2 px-4 pt-4 pb-3">
        <h2 className="text-ui font-semibold">What used this window</h2>
        {data && (
          <p className="text-meta text-muted">
            since {sinceLabel(data.from)} · {data.totals.sessions} {data.totals.sessions === 1 ? 'session' : 'sessions'}
          </p>
        )}
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 border-b border-border px-4 pb-2 text-meta tracking-wide text-muted uppercase">
        <span>Session</span>
        <span className="w-14">Model</span>
        <ShareInfo className="w-24 text-right uppercase hover:text-text" data-usage-share-header>
          Share (est.)
        </ShareInfo>
      </div>
      {data && data.rows.length === 0 && <p className="px-4 py-3 text-ui text-muted">Nothing used this window yet.</p>}
      {shown.map((row: UsageRow) => {
        const onOpen = open(row.sessionId);
        return (
          <button
            key={row.key}
            type="button"
            disabled={!onOpen}
            onClick={onOpen ?? undefined}
            className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 border-b border-border px-4 py-2 text-left text-ui enabled:hover:bg-border/45"
            data-usage-row={row.sessionId ?? row.key}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              {row.projectRoot && <ProjectIcon project={projects.get(row.projectRoot)} root={row.projectRoot} size={20} />}
              <span className="grid min-w-0">
                <span className="truncate font-medium text-text">{row.label}</span>
                <span className="truncate text-meta text-muted">{nameOf(row.projectRoot)}</span>
              </span>
            </span>
            <span className="w-14 text-muted">
              <ModelCell model={row.model} fastTurns={row.fastTurns} />
            </span>
            <span className="w-24">
              <ShareBar share={row.share} compact />
            </span>
          </button>
        );
      })}
      {rest && (
        <p className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-border px-4 py-2 text-ui text-muted">
          <span>{rest.count} more</span>
          <span className="tabular-nums">{formatShare(rest.share)}</span>
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
  const series = useMemo(() => visibleSeries(period, history?.series ?? []), [period, history]);
  const range = useMemo(() => {
    const to = now;
    const session = entry?.usage?.limits.find((l) => l.kind === 'session');
    const hours = period === 'window' ? 5 : period === 'day' ? 24 : period === 'week' ? 24 * 7 : 24 * 30;
    const from = period === 'window' && session?.resetsAt && session.resetsAt > now ? session.resetsAt - 5 * 3_600_000 : to - hours * 3_600_000;
    return { from, to };
  }, [period, now, entry]);
  const weeklyOnly = period === 'week' || period === 'month';

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
            <LimitCard key={`${limit.kind}:${limit.scope ?? ''}`} limit={limit} now={now} />
          ))}
        </div>
      )}
      <div className="grid items-start gap-4 min-[1200px]:grid-cols-[minmax(0,1.4fr)_minmax(380px,1fr)]">
        <ChartCard
          title="% used over time"
          subtitle={`${period === 'window' ? 'current window' : `last ${PERIOD_SHORT[period]}`}${weeklyOnly ? ' · the 5h session shows at 24 hours and less' : ''}`}
          legend={series.length >= 2 ? series.map((s) => <LegendItem key={`${s.kind}:${s.scope ?? ''}`} color={seriesColor(s)} label={seriesName(s)} dashed={s.kind === 'session'} />) : null}
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
          {series.length === 0 ? (
            <div className="grid h-[300px] place-content-center justify-items-center gap-1 rounded-lg border border-dashed border-edge text-center" data-usage-history-empty>
              <p className="text-ui font-semibold">History starts now</p>
              <p className="text-ui text-muted">Switchboard records your plan % each time it checks. The chart fills in from today.</p>
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
