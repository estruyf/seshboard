import { ArrowUp, ChevronRight, CircleAlert, CircleCheck, Clock, GitPullRequest, LoaderCircle, Waypoints } from 'lucide-react';
import { remoteOverview, workersLine, type RemoteOrchestrator, type RemoteOverviewGroup, type RemoteOverviewRow, type RemoteSessions, type WorkerState } from '@seshboard/protocol/remote-client';
import { Sheet } from './Sheet.tsx';
import { Button } from './ui.tsx';

// The orchestrator (docs/orchestrator.md) on the phone, as on the computer: a bar under an orchestrator's header with
// its one line ("2 working · 1 waiting on you"), which opens the overview: the sessions it started, by what needs you
// first, each a way in. A session it started gets a bar back to it.

/** A started session's state as an icon: waiting on you, working, queued, ready for review or idle. */
function WorkerIcon({ state }: { state: WorkerState }) {
  switch (state) {
    case 'waiting':
      return <CircleAlert className="size-4 shrink-0 text-warn" aria-hidden />;
    case 'working':
      return <LoaderCircle className="size-4 shrink-0 animate-spin text-accent-ink" aria-hidden />;
    case 'queued':
      return <Clock className="size-4 shrink-0 text-faint" aria-hidden />;
    case 'review':
      return <GitPullRequest className="size-4 shrink-0 text-link" aria-hidden />;
    default:
      return <CircleCheck className="size-4 shrink-0 text-faint" aria-hidden />;
  }
}

const GROUP_TONE: Record<WorkerState, string> = { waiting: 'text-warn', working: 'text-accent-ink', queued: 'text-muted', review: 'text-link', idle: 'text-muted' };

/** The overview's groups for an orchestrator, from the list the phone has. */
export const overviewOf = (orchestrator: RemoteOrchestrator, sessions: RemoteSessions): RemoteOverviewGroup[] => remoteOverview(orchestrator, sessions.sessions, sessions.prompts);

/** Under an orchestrator's header: its one line, which opens the overview. */
export function OrchestratorBar({ groups, onOpen }: { groups: readonly RemoteOverviewGroup[]; onOpen: () => void }) {
  const line = workersLine(groups.map((g) => ({ state: g.state, workers: g.rows })));
  const waiting = groups.some((g) => g.state === 'waiting');
  return (
    <div className="border-b border-border bg-sidebar px-3 py-1.5 sm:px-6" data-remote-orchestrator-bar>
      <div className="mx-auto flex w-full max-w-3xl items-center">
        <button type="button" onClick={onOpen} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg text-left pointer-fine:min-h-8" aria-label={`Orchestrator: ${line || 'no sessions yet'}. Show the sessions`} data-remote-orchestrator-open>
          <Waypoints className="size-4 shrink-0 text-pipeline" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-ui">
            <span className="font-semibold text-text">Orchestrator</span>
            <span className={waiting ? 'text-warn' : 'text-muted'} data-remote-orchestrator-line>
              {' · '}
              {line || 'no sessions yet'}
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** In a session an orchestrator started: the way back to it. */
export function BackToOrchestrator({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <div className="border-b border-border bg-sidebar px-3 py-1.5 sm:px-6" data-remote-orchestrator-back>
      <div className="mx-auto flex w-full max-w-3xl items-center">
        <Button variant="quiet" size="md" onClick={onOpen} className="-ml-1 min-w-0 gap-2 px-2!" aria-label={`Back to the orchestrator, ${title}`}>
          <ArrowUp className="size-4 shrink-0" aria-hidden />
          <Waypoints className="size-4 shrink-0 text-pipeline" aria-hidden />
          <span className="min-w-0 truncate">{title}</span>
        </Button>
      </div>
    </div>
  );
}

/**
 * The overview: the orchestrator's sessions by group, what needs you first. A row opens its session; one still in the
 * queue has none yet. A pull request opens on GitHub.
 */
export function OrchestratorSheet({ groups, canOpen, onOpenSession, onClose }: { groups: readonly RemoteOverviewGroup[]; canOpen: (sessionId: string) => boolean; onOpenSession: (sessionId: string) => void; onClose: () => void }) {
  const line = workersLine(groups.map((g) => ({ state: g.state, workers: g.rows })));
  return (
    <Sheet title="Orchestrator" subtitle={line || undefined} onClose={onClose} tall={groups.reduce((n, g) => n + g.rows.length, 0) > 5} hook="orchestrator">
      {groups.length === 0 && <p className="px-1 pb-2 text-ui text-muted">Send a list of tasks. Each one becomes a session that shows here.</p>}
      {groups.map((group) => (
        <section key={group.state} className="pb-2" data-remote-orchestrator-group={group.state}>
          <h3 className={`px-1 pb-1 text-meta font-semibold ${GROUP_TONE[group.state]}`}>
            {group.label} <span className="font-normal text-muted tabular-nums">{group.rows.length}</span>
          </h3>
          <ul role="list" className="-mx-1 flex flex-col">
            {group.rows.map((row) => (
              <WorkerRow key={row.worker.sessionId ?? row.worker.itemId ?? row.title} row={row} state={group.state} open={row.worker.sessionId && canOpen(row.worker.sessionId) ? () => (onClose(), onOpenSession(row.worker.sessionId!)) : null} />
            ))}
          </ul>
        </section>
      ))}
    </Sheet>
  );
}

function WorkerRow({ row, state, open }: { row: RemoteOverviewRow; state: WorkerState; open: (() => void) | null }) {
  const { worker } = row;
  const body = (
    <>
      <span className="flex h-5 items-center">
        <WorkerIcon state={state} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui font-semibold text-text">{row.title}</span>
        {row.branch && <span className="block truncate font-mono text-meta text-muted">{row.branch}</span>}
        {row.note && <span className={`block text-meta [overflow-wrap:anywhere] ${state === 'waiting' ? 'text-warn' : 'text-muted'}`}>{row.note}</span>}
      </span>
    </>
  );
  return (
    <li className="flex min-w-0 items-start gap-1" data-remote-orchestrator-worker={worker.sessionId ?? worker.itemId ?? ''} data-worker-state={state}>
      {open ? (
        <button type="button" onClick={open} className="flex min-h-11 min-w-0 flex-1 items-start gap-2.5 rounded-lg px-1 py-1.5 text-left active:bg-selected pointer-fine:hover:bg-selected" aria-label={`Open ${row.title}`} data-remote-worker-open={worker.sessionId}>
          {body}
        </button>
      ) : (
        <div className="flex min-h-11 min-w-0 flex-1 items-start gap-2.5 px-1 py-1.5">{body}</div>
      )}
      {worker.pr && (
        <a href={worker.pr.url} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex h-6 shrink-0 items-center rounded-full border border-edge px-2 text-meta text-link" title="Open on GitHub" data-remote-worker-pr>
          #{worker.pr.number}
          {worker.pr.state === 'open' ? '' : ` ${worker.pr.state}`}
        </a>
      )}
    </li>
  );
}
