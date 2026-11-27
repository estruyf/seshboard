import { basename } from '../../lib/format.ts';
import { useFocus } from '../../state/focusGate.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { openRow } from '../../state/useRemoteRows.ts';
import { Button } from '../ui/Button.tsx';
import { FOCUS_DOT, FOCUS_TEXT, focusStateLabel } from './focusLabels.ts';
import { useMinute } from './useMinute.ts';

/** Running on the nav rail in the focus limit's tones: muted under the limit, the accent ink at it, pink over it. */
export const FOCUS_RAIL_TEXT = { under: 'text-muted', at: 'text-accent-ink', over: 'text-warn' } as const;

/**
 * What the focus limit counts, in the panel under Running: how many are going out of how many, then the sessions that
 * count, needs you first, each with Open. Nothing while the limit is off, but a line saying so.
 */
export function FocusList() {
  const focus = useFocus();
  const projects = useProjects((s) => s.projects);
  const now = useMinute(true);
  if (focus.limit === null) return <p className="px-3.5 py-2 text-ui text-muted">The focus limit is off. Turn it on in Settings › Focus.</p>;

  const going = `${focus.count} of ${focus.limit} going`;
  const projectName = (root: string) => projects.get(root)?.name ?? basename(root);
  return (
    <div className="grid" data-focus-list={focus.level}>
      <div className="flex items-baseline gap-2 px-3.5 pt-1 pb-1.5">
        <span className="text-ui font-semibold text-text" data-focus-going>
          {going}
        </span>
        <span className="ml-auto text-meta text-muted">{focus.mode === 'strict' ? 'Strict' : 'Nudge'}</span>
      </div>
      {focus.sessions.length === 0 ? (
        <p className="px-3.5 pb-2 text-ui text-muted">Nothing is going right now.</p>
      ) : (
        <ul className="grid pb-1">
          {focus.sessions.map((session) => (
            <li key={session.id} className="flex min-w-0 items-center gap-2.5 px-3.5 py-1.5" data-focus-session={session.id} data-focus-state={session.state}>
              <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${FOCUS_DOT[session.state]}`} />
              <span className="grid min-w-0 flex-1">
                {/* Where it runs only in the tooltip: the state is what the line is for. */}
                <span className="truncate text-ui text-text" data-tooltip={session.remote ? `${session.title}\nOn ${session.remote.computerName}` : session.external ? `${session.title}\nStarted outside Seshboard` : session.title}>
                  {session.title}
                </span>
                <span className="truncate text-meta text-muted">
                  {projectName(session.projectRoot)} · <span className={FOCUS_TEXT[session.state]}>{focusStateLabel(session, now)}</span>
                </span>
              </span>
              <Button size="sm" onClick={() => openRow(session.id)} aria-label={`Open ${session.title}`} data-focus-open={session.id}>
                Open
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="px-3.5 py-2 text-meta text-muted">Read a result or settle a session to free a place.</p>
    </div>
  );
}
