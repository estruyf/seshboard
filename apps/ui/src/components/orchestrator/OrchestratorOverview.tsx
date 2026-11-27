import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, CircleAlert, CircleCheck, Clock, GitPullRequest, LoaderCircle, Waypoints } from 'lucide-react';
import { remoteOrchestratorOf, remoteOrchestratorOfWorker, remoteOverview, workersLine, type OrchestratorInfo, type OrchestratorWorker, type SessionUpdateView, type WorkerState } from '@seshboard/protocol/client';
import { useCatchUp } from '../../state/catchUpStore.ts';
import { orchestratorInfo, orchestratorOfWorker, overviewGroups } from '../../state/orchestrator.ts';
import { useComputers } from '../../state/computersStore.ts';
import { useOrchestrators } from '../../state/orchestratorStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useAllSessionRows } from '../../state/worktreesStore.ts';
import { Pill } from '../ui/Pill.tsx';
import { openWebLink } from '../../state/browserActions.ts';

/** The orchestrator's own icon, in the colour pipelines use for work Seshboard hands out. */
export function OrchestratorIcon({ size = 13, className = '' }: { size?: number; className?: string }) {
  return <Waypoints size={size} className={`shrink-0 text-pipeline ${className}`} aria-hidden />;
}

/** A started session's state as an icon: waiting on you, working, queued, ready for review or idle. */
function WorkerIcon({ state }: { state: WorkerState }) {
  switch (state) {
    case 'waiting':
      return <CircleAlert size={15} className="shrink-0 animate-pulse text-warn" aria-hidden />;
    case 'working':
      return <LoaderCircle size={15} className="shrink-0 animate-spin text-accent-ink" aria-hidden />;
    case 'queued':
      return <Clock size={15} className="shrink-0 text-faint" aria-hidden />;
    case 'review':
      return <GitPullRequest size={15} className="shrink-0 text-link" aria-hidden />;
    default:
      return <CircleCheck size={15} className="shrink-0 text-faint" aria-hidden />;
  }
}

const GROUP_TONE: Record<WorkerState, string> = { waiting: 'text-warn', working: 'text-accent-ink', queued: 'text-muted', review: 'text-link', idle: 'text-muted' };

/**
 * The overview above an orchestrator's conversation (docs/orchestrator.md): the sessions it started, grouped by what
 * needs you first, each with what it did or asks and a way in. It folds to its one line.
 */
export function OrchestratorOverview({ sessionId }: { sessionId: string }) {
  const info = useOrchestrators((s) => orchestratorInfo(s.orchestrators, sessionId));
  if (!info) return null;
  return (
    <div className="mx-auto max-h-[45%] w-full max-w-3xl shrink-0 overflow-y-auto px-6 pt-3 @max-[860px]:px-4">
      <OverviewCard info={info} />
    </div>
  );
}

function OverviewCard({ info }: { info: OrchestratorInfo }) {
  const rows = useAllSessionRows();
  const cards = useCatchUp((s) => s.cards);
  const groups = useMemo(() => overviewGroups(info, rows, cards), [info, rows, cards]);
  return <OverviewCardView sessionId={info.sessionId} groups={groups} onOpen={(id) => useSessions.getState().select(id)} />;
}

/**
 * The overview of an orchestrator on another computer (docs/orchestrator.md), from that computer's list: the same card,
 * and Open goes to the session there.
 */
export function RemoteOrchestratorOverview({ computerId, sessionId }: { computerId: string; sessionId: string }) {
  const list = useComputers((s) => s.lists.get(computerId));
  const orchestrator = remoteOrchestratorOf(list?.orchestrators, sessionId);
  const groups = useMemo(() => (orchestrator && list ? remoteOverview(orchestrator, list.sessions, list.prompts) : null), [orchestrator, list]);
  if (!groups) return null;
  return (
    <div className="mx-auto max-h-[45%] w-full max-w-3xl shrink-0 overflow-y-auto px-6 pt-3 @max-[860px]:px-4">
      <OverviewCardView sessionId={sessionId} groups={groups} onOpen={(id) => useComputers.getState().openSession({ computerId, sessionId: id })} canOpen={(id) => Boolean(list?.sessions.some((s) => s.id === id))} />
    </div>
  );
}

/** A row of the card: the title its orchestrator gave it, its branch, and what it asks or did. */
interface CardRow {
  worker: Pick<OrchestratorWorker, 'sessionId' | 'itemId' | 'pr'>;
  title: string;
  branch: string | null;
  note: string | null;
}

/** The card itself, for an orchestrator here or on another computer: `onOpen` opens a started session where it runs. */
function OverviewCardView({ sessionId, groups, onOpen, canOpen = () => true }: { sessionId: string; groups: ReadonlyArray<{ state: WorkerState; label: string; rows: readonly CardRow[] }>; onOpen: (sessionId: string) => void; canOpen?: (sessionId: string) => boolean }) {
  const [open, setOpen] = useState(true);
  const line = workersLine(groups.map((g) => ({ state: g.state, workers: g.rows })));
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className="@container rounded-xl border border-border bg-card px-4 py-3 @max-[560px]:px-3" aria-label="Orchestrator overview" data-orchestrator-overview={sessionId}>
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-2 text-left"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-tooltip={open ? 'Hide the sessions' : 'Show the sessions'}
        data-orchestrator-toggle
      >
        <OrchestratorIcon size={15} />
        <h2 className="shrink-0 text-ui font-semibold text-text">Orchestrator</h2>
        <span className="min-w-0 flex-1 truncate text-meta text-muted tabular-nums" data-orchestrator-line>
          {line || 'No sessions yet'}
        </span>
        <Chevron size={14} className="shrink-0 text-faint" aria-hidden />
      </button>
      {open && groups.length === 0 && <p className="mt-2 text-meta text-muted">Send a list of tasks. Each one becomes a session that shows here.</p>}
      {open &&
        groups.map((group) => (
          <div key={group.state} className="mt-2.5" data-orchestrator-group={group.state}>
            <h3 className={`text-meta font-semibold ${GROUP_TONE[group.state]}`}>
              {group.label} <span className="font-normal text-muted tabular-nums">{group.rows.length}</span>
            </h3>
            <ul role="list" className="mt-0.5 flex flex-col">
              {group.rows.map((row) => (
                <WorkerRow key={row.worker.sessionId ?? row.worker.itemId ?? row.title} row={row} state={group.state} onOpen={row.worker.sessionId && canOpen(row.worker.sessionId) ? onOpen : null} />
              ))}
            </ul>
          </div>
        ))}
    </section>
  );
}

function WorkerRow({ row, state, onOpen }: { row: CardRow; state: WorkerState; onOpen: ((sessionId: string) => void) | null }) {
  const { worker } = row;
  const sessionId = worker.sessionId;
  return (
    <li className="flex min-w-0 items-start gap-2.5 rounded-lg px-1.5 py-1" data-orchestrator-worker={sessionId ?? worker.itemId ?? ''} data-worker-state={state}>
      <span className="flex h-5 items-center">
        <WorkerIcon state={state} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="min-w-0 truncate text-ui font-semibold text-text">{row.title}</span>
          {row.branch && <span className="min-w-0 truncate font-mono text-meta text-muted">{row.branch}</span>}
          {worker.pr && (
            <Pill tone={worker.pr.state === 'open' ? 'link' : 'muted'} onClick={() => openWebLink(worker.pr!.url)} data-tooltip="Open on GitHub" data-worker-pr>
              #{worker.pr.number}
              {worker.pr.state === 'open' ? '' : ` ${worker.pr.state}`}
            </Pill>
          )}
        </div>
        {row.note && <p className={`mt-0.5 text-meta [overflow-wrap:anywhere] select-text ${state === 'waiting' ? 'text-warn' : 'text-muted'}`}>{row.note}</p>}
      </div>
      {sessionId && onOpen && (
        <span className="flex h-5 shrink-0 items-center">
          <button type="button" className="text-ui text-link hover:underline" onClick={() => onOpen(sessionId)} aria-label={`Open ${row.title}`} data-worker-open={sessionId}>
            Open
          </button>
        </span>
      )}
    </li>
  );
}

/** In a started session's header, before its state: its orchestrator, as the way back to it. */
export function OrchestratorCrumb({ sessionId }: { sessionId: string }) {
  const parent = useOrchestrators((s) => orchestratorOfWorker(s.orchestrators, sessionId));
  const title = useSessions((s) => (parent ? (s.sessions.get(parent.sessionId)?.title ?? null) : null));
  if (!parent) return null;
  return (
    <button
      type="button"
      className="no-drag flex min-w-0 shrink items-center gap-1 truncate text-muted hover:text-text hover:underline @max-[860px]:hidden"
      onClick={() => useSessions.getState().select(parent.sessionId)}
      data-tooltip="Back to the orchestrator"
      data-orchestrator-crumb={parent.sessionId}
    >
      <OrchestratorIcon size={11} />
      <span className="truncate">{title ?? 'Orchestrator'} ›</span>
    </button>
  );
}

/** In the header of a session an orchestrator on another computer started: its orchestrator, as the way back. */
export function RemoteOrchestratorCrumb({ computerId, sessionId }: { computerId: string; sessionId: string }) {
  const list = useComputers((s) => s.lists.get(computerId));
  const parent = remoteOrchestratorOfWorker(list?.orchestrators, sessionId);
  const title = parent ? (list?.sessions.find((s) => s.id === parent.sessionId)?.title ?? null) : null;
  if (!parent || title === null) return null;
  return (
    <button
      type="button"
      className="no-drag flex min-w-0 shrink items-center gap-1 truncate text-muted hover:text-text hover:underline @max-[860px]:hidden"
      onClick={() => useComputers.getState().openSession({ computerId, sessionId: parent.sessionId })}
      data-tooltip="Back to the orchestrator"
      data-orchestrator-crumb={parent.sessionId}
    >
      <OrchestratorIcon size={11} />
      <span className="truncate">{title} ›</span>
    </button>
  );
}

const UPDATE_WORDS: Record<SessionUpdateView['end'], string> = { finished: 'finished its turn', failed: 'failed', waiting: 'waits for you' };
const UPDATE_STATE: Record<SessionUpdateView['end'], WorkerState> = { finished: 'idle', failed: 'waiting', waiting: 'waiting' };

/**
 * In an orchestrator's conversation, what Seshboard told it about one of its sessions: a quiet row, not one of your
 * prompts, with the session's name as the way in.
 */
export function SessionUpdateNote({ update }: { update: SessionUpdateView }) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-meta text-muted" data-session-update={update.sessionId} data-update-end={update.end}>
      <span className="flex h-4 items-center">
        <WorkerIcon state={UPDATE_STATE[update.end]} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="[overflow-wrap:anywhere]">
          <button type="button" className="text-ui font-semibold text-text hover:underline" onClick={() => useSessions.getState().select(update.sessionId)} data-update-open={update.sessionId}>
            {update.title}
          </button>{' '}
          {UPDATE_WORDS[update.end]}
        </p>
        {update.lines.map((line, i) => (
          <p key={i} className="[overflow-wrap:anywhere] select-text">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
