import { useMemo, type MouseEvent } from 'react';
import { User, Users } from 'lucide-react';
import { isMine, type Computer, type Contract, type RemoteSession, type RemoteSessions, type RpcClient } from '@seshboard/protocol/client';
import { shortAge } from '../../lib/format.ts';
import { useComputers } from '../../state/computersStore.ts';
import { offlineLine, remoteRowStatus, scopeOf, startedByOf, type ComputerScope } from '../../state/remoteRows.ts';
import { waitingLabel } from '../../state/sidebarRows.ts';
import { agentNameOf } from '../sidebar/rowLabel.ts';
import { StatusIcon } from '../sidebar/StatusIcon.tsx';
import { Button } from '../ui/Button.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { WorkingPanel } from '../ui/WorkingPanel.tsx';
import { computerOverview, overviewSummary, type WaitingSession } from './computerOverview.ts';
import { inBackground } from './computerSessions.ts';
import { ComputerPrompt } from './ComputerPrompt.tsx';
import { respondRemote } from './remoteActions.ts';

const SCOPE_LABEL: Record<ComputerScope, string> = { mine: 'Mine', all: 'All' };

/** Opens a session of the computer here, as its sidebar row does: in the active pane, or beside it with ⌥. */
function openOn(computerId: string, sessionId: string, event?: MouseEvent): void {
  useComputers.getState().openSession({ computerId, sessionId }, { beside: event?.altKey ?? false });
}

const titleOf = (session: Pick<RemoteSession, 'title'>) => session.title || 'Untitled session';
const where = (session: Pick<RemoteSession, 'projectName' | 'branch'>) => (session.branch ? `${session.projectName} · ${session.branch}` : session.projectName);

/**
 * The body of a paired computer's page (`ComputerView`): what needs you there, with its prompts to answer from here,
 * what is working, and its recent sessions by project, through its chip's Mine / All filter (which the page can
 * switch too). An offline computer shows its last list, dimmed, and nothing in it can be answered.
 */
export function ComputerOverviewBody({ client, computer, list }: { client: RpcClient<Contract> | null; computer: Computer; list: RemoteSessions }) {
  const scope = useComputers((s) => scopeOf(s.scopes, computer.id));
  const overview = useMemo(() => computerOverview(list, computer, scope), [list, computer, scope]);
  const connected = computer.state === 'connected' && !!client;
  const now = Date.now();
  const empty = overview.needs.length === 0 && overview.working.length === 0 && overview.recent.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className={`mx-auto grid w-full max-w-3xl grid-cols-[minmax(0,1fr)] gap-7 px-6 pt-4 pb-12 ${connected ? '' : 'opacity-55'}`} data-computer-overview={computer.id}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 text-ui text-muted" data-computer-summary>
            {connected ? overviewSummary(overview, computer.name) : computer.state === 'offline' ? `${offlineLine(computer.name, computer.lastSeen, now)} Its last list:` : `Its last list from ${computer.name}:`}
          </p>
          <SegmentedControl
            mode="radio"
            size="sm"
            label={`Sessions on ${computer.name}`}
            value={scope}
            onChange={(next) => useComputers.getState().setScope(computer.id, next)}
            segments={(['mine', 'all'] as const).map((value) => ({
              value,
              label: SCOPE_LABEL[value],
              icon: value === 'mine' ? <User size={12} aria-hidden /> : <Users size={12} aria-hidden />,
              tooltip: value === 'mine' ? 'Started from here, or that you sent a message to from here' : 'Everyone’s sessions there',
              data: { 'data-computer-page-scope': value },
            }))}
          />
        </div>

        {overview.needs.length > 0 && (
          <section aria-labelledby={`computer-needs-${computer.id}`} className="grid gap-2">
            <SectionHeader as="h2" headingId={`computer-needs-${computer.id}`} tone="needs-you" count={overview.needs.length}>
              Needs you
            </SectionHeader>
            {/* The longest wait as its card, to answer here; the others as rows, so the page stays a page (and one card has the keys). */}
            {overview.needs.map((waiting, i) => (
              <Waiting key={waiting.session.id} computer={computer} waiting={waiting} client={connected && i === 0 ? client : null} now={now} />
            ))}
          </section>
        )}

        {overview.working.length > 0 && (
          <section aria-labelledby={`computer-working-${computer.id}`} className="grid gap-2">
            <SectionHeader as="h2" headingId={`computer-working-${computer.id}`} tone="working" count={overview.working.length}>
              Working
            </SectionHeader>
            <div className="grid grid-cols-2 items-start gap-2 @max-[640px]:grid-cols-1">
              {overview.working.map((session) => (
                <Working key={session.id} computerId={computer.id} session={session} now={now} />
              ))}
            </div>
          </section>
        )}

        {overview.recent.length > 0 && (
          <section aria-labelledby={`computer-recent-${computer.id}`} className="grid gap-3">
            <SectionHeader as="h2" headingId={`computer-recent-${computer.id}`}>
              Recent
            </SectionHeader>
            {overview.recent.map((project) => (
              <div key={project.projectId} className="grid gap-0.5" data-computer-recent-project={project.projectId}>
                <p className="truncate px-2 pb-0.5 text-meta font-medium text-muted">{project.projectName}</p>
                {project.sessions.map((session) => (
                  <Recent key={session.id} computer={computer} session={session} scope={scope} now={now} />
                ))}
              </div>
            ))}
            {overview.more > 0 && <p className="px-2 text-meta text-faint">{overview.more} more in the sidebar.</p>}
          </section>
        )}

        {empty && (
          <p className="text-center text-ui text-muted" data-computer-empty>
            {overview.fromOthers > 0 ? `None of the sessions on ${computer.name} are yours yet.` : connected ? `No sessions on ${computer.name} yet. Start one here, and Claude runs there.` : `No sessions on ${computer.name}.`}
          </p>
        )}

        {scope === 'mine' && overview.fromOthers > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-text/6 px-3 py-2" data-computer-page-others>
            <span className="min-w-0 truncate text-ui text-muted">
              +{overview.fromOthers} from others on {computer.name}
            </span>
            <Button size="sm" variant="quiet" onClick={() => useComputers.getState().setScope(computer.id, 'all')}>
              Show
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A session waiting for you. With `client` (the longest wait, while connected): its title and where, then the card of
 * its oldest prompt to answer here. Otherwise a row with what it waits for and Open.
 */
function Waiting({ computer, waiting, client, now }: { computer: Computer; waiting: WaitingSession; client: RpcClient<Contract> | null; now: number }) {
  const { session, prompts } = waiting;
  const first = prompts[0];
  const age = <span className="shrink-0 text-meta text-warn tabular-nums">{shortAge(first?.createdAt ?? session.updatedAt, now)}</span>;
  if (client && first) {
    return (
      <div className="grid gap-1.5" data-computer-page-needs={session.id}>
        <div className="flex items-center gap-2 px-1">
          <button type="button" onClick={(e) => openOn(computer.id, session.id, e)} className="min-w-0 flex-1 truncate rounded text-left text-ui font-semibold hover:underline" data-computer-page-open>
            {titleOf(session)}
          </button>
          <span className="shrink-0 truncate text-meta text-muted">{where(session)}</span>
        </div>
        <ComputerPrompt key={first.requestId} prompt={first} respond={(decision) => respondRemote(client, computer.id, first, decision)} />
        {prompts.length > 1 && <p className="px-1 text-meta text-muted">{prompts.length - 1} more in the session.</p>}
      </div>
    );
  }
  return (
    <article className="flex min-w-0 items-center gap-3 rounded-xl border border-warn/55 bg-card px-3 py-2 ring-4 ring-warn/10" data-computer-page-needs={session.id}>
      <span className="grid min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-body font-semibold">{titleOf(session)}</span>
          {age}
        </span>
        <span className="truncate text-meta text-muted">
          <span className="text-warn">{waitingLabel(first?.toolName ?? null)}</span> · {where(session)}
        </span>
      </span>
      <Button onClick={(e) => openOn(computer.id, session.id, e)} aria-label={`Open ${titleOf(session)}`} data-computer-page-open>
        Open
      </Button>
    </article>
  );
}

/** A session Claude works in there (or that runs a task in the background), as Home's Working cards. */
function Working({ computerId, session, now }: { computerId: string; session: RemoteSession; now: number }) {
  const background = inBackground(session);
  return (
    <button type="button" onClick={(e) => openOn(computerId, session.id, e)} className="grid gap-1 rounded-xl border border-border bg-card p-3 text-left hover:bg-border/45" data-computer-page-working={session.id}>
      <span className="truncate text-body font-semibold">{titleOf(session)}</span>
      <span className="truncate text-meta text-muted">{where(session)}</span>
      <span className={`flex min-w-0 items-center gap-2 text-ui ${background ? 'text-ok' : 'text-accent-ink'}`}>
        {!background && <WorkingPanel />}
        <span className="truncate">{session.background?.[0]?.description ?? (background ? 'Running in the background' : `${agentNameOf({ provider: session.provider ?? null })} is working`)}</span>
        <span className="ml-auto shrink-0 text-meta text-faint tabular-nums">{shortAge(session.workingSince ?? session.updatedAt, now)}</span>
      </span>
    </button>
  );
}

/** A recent session's row: its state, title, branch (and who started it, for someone else's in All) and age. */
function Recent({ computer, session, scope, now }: { computer: Computer; session: RemoteSession; scope: ComputerScope; now: number }) {
  const status = remoteRowStatus(session, false);
  const theirs = scope === 'all' && !isMine(session.id, session.parentId, computer);
  return (
    <button type="button" onClick={(e) => openOn(computer.id, session.id, e)} className="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-border/45" data-computer-page-recent={session.id}>
      <span className="flex w-3.5 shrink-0 justify-center">
        <StatusIcon status={status} agent={agentNameOf({ provider: session.provider ?? null })} />
      </span>
      <span className="grid min-w-0 flex-1">
        <span className={`truncate text-body ${status === 'unread' ? 'font-semibold' : ''}`}>{titleOf(session)}</span>
        {(session.branch || theirs) && (
          <span className="truncate text-meta text-muted">
            {session.branch && <span className="font-mono">{session.branch}</span>}
            {session.branch && theirs && ' · '}
            {theirs && <span className="text-remote">{startedByOf(session, computer)}</span>}
          </span>
        )}
      </span>
      <span className="shrink-0 text-meta text-faint tabular-nums">{shortAge(session.updatedAt, now)}</span>
    </button>
  );
}
