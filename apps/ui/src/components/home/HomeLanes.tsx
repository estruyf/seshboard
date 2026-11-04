import { CircleCheck } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import type { CatchUp, ProjectInfo } from '@seshboard/protocol/client';
import { shortAge } from '../../lib/format.ts';
import { useCatchUp } from '../../state/catchUpStore.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { useSessions, type SessionRowData } from '../../state/sessionsStore.ts';
import { waitingLabel } from '../../state/sidebarRows.ts';
import { reviewLabel } from '../catchUp/catchUpModel.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { agentNameOf } from '../sidebar/rowLabel.ts';
import { workingLabel } from '../transcript/workingLabel.ts';
import { Pill } from '../ui/Pill.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { WorkingPanel } from '../ui/WorkingPanel.tsx';

const open = (id: string) => useSessions.getState().select(id);
const titleOf = (row: SessionRowData) => row.title || 'Untitled session';

/** "project · branch" under a card's title. */
const where = (row: SessionRowData, name: string) => (row.branch ? `${name} · ${row.branch}` : name);

interface LaneContext {
  now: number;
  projects: Map<string, ProjectInfo>;
  nameOf(root: string): string;
}

/** A lane: its heading, and its cards as a list. `hideEmpty`: an empty lane is left out where only two lanes fit. */
function Lane({ id, title, tone, count, empty, hideEmpty = false, children }: { id: 'needs' | 'working' | 'review'; title: string; tone: 'needs-you' | 'working' | 'unread'; count: number; empty: string; hideEmpty?: boolean; children: ReactNode }) {
  return (
    <section aria-labelledby={`home-lane-${id}`} className={`grid min-w-0 content-start gap-2.5 ${hideEmpty && count === 0 ? '@max-[1200px]:hidden' : ''}`} data-home-lane={id}>
      <SectionHeader as="h2" headingId={`home-lane-${id}`} tone={tone} count={count}>
        {title}
      </SectionHeader>
      {count === 0 ? (
        <p className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3.5 py-3 text-ui text-muted" data-home-lane-empty>
          <CircleCheck size={14} className="shrink-0" aria-hidden />
          {empty}
        </p>
      ) : (
        <ul className="grid gap-2.5">{children}</ul>
      )}
    </section>
  );
}

/** A card is a link to its session: a click or ↩ opens it. */
function CardLink({ id, label, className, onOpen, children, ...data }: { id: string; label: string; className: string; onOpen?(): void; children: ReactNode } & Record<`data-${string}`, string>) {
  const onClick = (event: MouseEvent) => {
    event.preventDefault();
    open(id);
    onOpen?.();
  };
  return (
    <li className="grid min-w-0">
      <a href={`#session-${id}`} onClick={onClick} aria-label={label} className={`grid min-w-0 gap-1.5 rounded-xl px-3.5 py-3 text-left ${className}`} {...data}>
        {children}
      </a>
    </li>
  );
}

/** The top line of a card: the project's icon, the title, and how long ago. */
function CardTop({ row, ctx, ageTone = 'text-faint' }: { row: SessionRowData; ctx: LaneContext; ageTone?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ProjectIcon project={ctx.projects.get(row.projectRoot)} root={row.projectRoot} size={18} />
      <span className="min-w-0 flex-1 truncate text-body font-semibold text-text">{titleOf(row)}</span>
      <span className={`shrink-0 text-meta tabular-nums ${ageTone}`}>{shortAge(row.updatedAt, ctx.now)}</span>
    </span>
  );
}

/** Needs you: what each session waits for (the oldest request), pink, longest wait first. */
export function NeedsLane({ rows, ctx }: { rows: readonly SessionRowData[]; ctx: LaneContext }) {
  const permissions = useHosts((s) => s.permissions);
  const asks = new Map<string, { toolName: string; title: string | null }>();
  for (const p of permissions.values()) if (!asks.has(p.sessionId)) asks.set(p.sessionId, p);
  return (
    <Lane id="needs" title="Needs you" tone="needs-you" count={rows.length} empty="Nothing is waiting for you." hideEmpty>
      {rows.map((row) => {
        const ask = asks.get(row.id);
        const waiting = waitingLabel(ask?.toolName ?? null);
        return (
          <CardLink key={row.id} id={row.id} label={`${titleOf(row)}: ${waiting}`} className="border border-warn/55 bg-card ring-4 ring-warn/10 hover:bg-border/45" data-home-needs={row.id}>
            <CardTop row={row} ctx={ctx} ageTone="text-warn" />
            <span className="truncate text-meta text-muted">{where(row, ctx.nameOf(row.projectRoot))}</span>
            <span className="truncate text-ui text-warn">{waiting}</span>
            {ask?.title && <span className="truncate text-ui text-muted">{ask.title}</span>}
          </CardLink>
        );
      })}
    </Lane>
  );
}

/** Working: what Claude is doing now in each, with the line under a reply ("Using Edit"), the one you set going last first. */
export function WorkingLane({ rows, ctx }: { rows: readonly SessionRowData[]; ctx: LaneContext }) {
  const hosts = useHosts((s) => s.hosts);
  const streaming = useHosts((s) => s.streaming);
  return (
    <Lane id="working" title="Working" tone="working" count={rows.length} empty="Claude isn't working on anything.">
      {rows.map((row) => {
        const host = hosts.get(row.id);
        const said = workingLabel({ waiting: false, compacting: host?.compacting === true, block: streaming.get(row.id) });
        // Without a turn streaming here (Claude Code elsewhere), what runs in the background, or who works on it.
        const label = said !== 'Working' ? said : (row.live?.background?.[0] ?? `${agentNameOf(row.summary ?? { provider: host?.provider ?? null })} is working`);
        return (
          <CardLink key={row.id} id={row.id} label={`${titleOf(row)}: ${label}`} className="bg-text/6 hover:bg-text/10" data-home-working={row.id}>
            <CardTop row={row} ctx={ctx} />
            <span className="truncate text-meta text-muted">{where(row, ctx.nameOf(row.projectRoot))}</span>
            <span className="flex min-w-0 items-center gap-2 text-ui text-muted">
              <WorkingPanel />
              <span className="truncate">{label}</span>
            </span>
          </CardLink>
        );
      })}
    </Lane>
  );
}

const filesText = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;

/**
 * To review: finished sessions you haven't read, newest first, with the first line of what the catch-up says Claude
 * did, its review time and the files changed. Review opens the session with its catch-up in full.
 */
export function ReviewLane({ rows, total, ctx, onAll }: { rows: readonly SessionRowData[]; total: number; ctx: LaneContext; onAll(): void }) {
  const cards = useCatchUp((s) => s.cards);
  const show = (card: CatchUp | undefined) => card && useCatchUp.getState().setCollapsed(card, false);
  return (
    <Lane id="review" title="To review" tone="unread" count={total} empty="Nothing to review.">
      {rows.map((row) => {
        const card = cards.get(row.id);
        const did = card?.did[0] ?? (row.error ? 'Stopped with an error.' : where(row, ctx.nameOf(row.projectRoot)));
        const time = card ? reviewLabel(card) : null;
        const files = card?.signals.diff?.files ?? 0;
        return (
          <CardLink key={row.id} id={row.id} label={[titleOf(row), did, time].filter(Boolean).join('. ')} onOpen={() => show(card)} className="bg-text/6 hover:bg-text/10" data-home-review={row.id}>
            <CardTop row={row} ctx={ctx} />
            <span className="line-clamp-2 text-ui text-text">{did}</span>
            <span className="flex min-w-0 items-center gap-1.5">
              {time && <Pill tone="muted">{time}</Pill>}
              {files > 0 && <Pill tone="muted">{filesText(files)}</Pill>}
              <span className="flex-1" />
              <span className="shrink-0 text-ui font-semibold text-accent-ink" aria-hidden>
                Review
              </span>
            </span>
          </CardLink>
        );
      })}
      {total > rows.length && (
        <li>
          <button type="button" onClick={onAll} className="rounded px-0.5 text-ui font-semibold text-accent-ink hover:underline" data-home-review-all>
            All {total} to review…
          </button>
        </li>
      )}
    </Lane>
  );
}
