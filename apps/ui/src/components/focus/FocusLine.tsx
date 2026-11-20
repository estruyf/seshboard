import { ChevronDown, Target } from 'lucide-react';
import { useState } from 'react';
import { basename } from '../../lib/format.ts';
import type { FocusSummary } from '../../state/focusGate.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { openRow } from '../../state/useRemoteRows.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';
import { FOCUS_DOT, FOCUS_TEXT, focusStateLabel } from './focusLabels.ts';

/**
 * One line above the message box in New session, at the focus limit: how many are going, and what Start does now.
 * What counts is in the column beside the box; when stacked there is no such column, so `expandable` adds Show, which
 * opens the list under the line. The polite live region stays on the page under the limit too, so that reaching it is
 * announced.
 */
export function FocusLine({ focus, now, queues, expandable }: { focus: FocusSummary; now: number; /** Start adds to the queue here (not for a quick question or a pipeline). */ queues: boolean; expandable: boolean }) {
  const projects = useProjects((s) => s.projects);
  const [shown, setShown] = useState(false);
  const atLimit = focus.limit !== null && focus.count >= focus.limit;
  const line = `${focus.count} of ${focus.limit} ${focus.limit === 1 ? 'session' : 'sessions'} going.`;
  const after = queues ? 'Start puts this in the queue.' : '';
  return (
    <>
      <div role="status" aria-live="polite" className="shrink-0 empty:hidden">
        {atLimit && (
          <Notice
            tone="accent"
            role="note"
            icon={<Target size={14} aria-hidden />}
            className="flex-nowrap items-center!"
            data-focus-line={focus.mode}
            actions={
              <>
                {expandable && (
                  <Button variant="quiet" size="sm" aria-expanded={shown} onClick={() => setShown((open) => !open)} data-focus-line-show>
                    {shown ? 'Hide' : 'Show'}
                    <ChevronDown size={12} aria-hidden className={shown ? 'rotate-180' : ''} />
                  </Button>
                )}
                <Button variant="quiet" size="sm" onClick={() => useSessions.getState().openSettings('focus')} data-focus-change-limit>
                  Change limit
                </Button>
              </>
            }
          >
            {/* A narrow box drops the middle sentence first: what Start does matters more. */}
            <div className="@container/focus-line min-w-0">
              <p className="truncate" data-tooltip={`${line} Your focus limit. ${after}`.trim()}>
                <b className="font-semibold">{line}</b> <span className="text-muted @max-[400px]/focus-line:hidden">Your focus limit.</span> <span className="text-muted">{after}</span>
              </p>
            </div>
          </Notice>
        )}
      </div>
      {atLimit && expandable && shown && (
        <ul className="grid shrink-0 grid-cols-[minmax(0,1fr)] px-1" data-focus-line-list>
          {focus.sessions.map((session) => (
            <li key={session.id}>
              <button type="button" onClick={() => openRow(session.id)} className="flex h-8 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-left hover:bg-border/45" data-focus-session={session.id}>
                <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${FOCUS_DOT[session.state]}`} />
                <ProjectIcon project={projects.get(session.projectRoot)} root={session.projectRoot} size={16} />
                <span className="min-w-0 flex-1 truncate text-ui text-text">
                  {session.title}
                  <span className="text-faint"> · {projects.get(session.projectRoot)?.name ?? basename(session.projectRoot)}</span>
                </span>
                <span className={`shrink-0 text-meta ${FOCUS_TEXT[session.state]}`}>{focusStateLabel(session, now)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
