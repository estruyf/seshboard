import { Target } from 'lucide-react';
import { useRef, useState } from 'react';
import { basename } from '../../lib/format.ts';
import { useFocus } from '../../state/focusGate.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { openRow } from '../../state/useRemoteRows.ts';
import { Button } from '../ui/Button.tsx';
import { Pill } from '../ui/Pill.tsx';
import { Popover } from '../ui/Popover.tsx';
import { FOCUS_DOT, FOCUS_TEXT, focusStateLabel } from './focusLabels.ts';
import { useMinute } from './useMinute.ts';

const TONE = { under: 'muted', at: 'accent', over: 'warn' } as const;

/**
 * The focus limit in the sidebar footer, while it's on: "2 / 3", neutral under the limit, yellow at it,
 * pink over it. A click lists the sessions that count, needs you first, each with Open. `compact` is the
 * minimal sidebar's "2/3", without the icon; its list opens to the right of the rail.
 */
export function FocusCounter({ compact = false }: { compact?: boolean }) {
  const focus = useFocus();
  const projects = useProjects((s) => s.projects);
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const now = useMinute(open !== null);
  if (focus.limit === null) return null;

  const going = `${focus.count} of ${focus.limit} going`;
  const toggle = () => {
    if (open) return setOpen(null);
    const rect = anchor.current?.getBoundingClientRect();
    if (rect) setOpen(compact ? { x: rect.right + 8, y: rect.bottom } : { x: rect.left, y: rect.top - 6 });
  };
  const projectName = (root: string) => projects.get(root)?.name ?? basename(root);

  return (
    <>
      <Pill
        ref={anchor}
        tone={TONE[focus.level]}
        selected={open !== null}
        onClick={toggle}
        icon={compact ? undefined : <Target size={12} className="shrink-0" aria-hidden />}
        aria-label={`Focus limit: ${going}`}
        aria-expanded={open !== null}
        aria-haspopup="dialog"
        data-tooltip={open ? undefined : `Focus limit: ${going}`}
        data-tooltip-placement={compact ? 'right' : undefined}
        data-focus-counter={focus.level}
        className="no-drag font-semibold tabular-nums"
      >
        {compact ? `${focus.count}/${focus.limit}` : `${focus.count} / ${focus.limit}`}
      </Pill>
      {open && (
        <Popover x={open.x} y={open.y} above width={320} onClose={() => setOpen(null)} anchor={anchor} role="dialog" aria-label={`Focus limit, ${going}`} className="py-0!" data-focus-popover>
          <div className="flex items-baseline gap-2 px-3.5 pt-3 pb-1.5">
            <span className="text-ui font-semibold text-text">{going}</span>
            <span className="ml-auto text-meta text-muted">Focus limit · {focus.mode === 'strict' ? 'Strict' : 'Nudge'}</span>
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
                  <Button
                    size="sm"
                    onClick={() => {
                      setOpen(null);
                      openRow(session.id);
                    }}
                    aria-label={`Open ${session.title}`}
                    data-focus-open={session.id}
                  >
                    Open
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-edge px-3.5 py-2 text-meta text-muted">Read a result or settle a session to free a place.</p>
        </Popover>
      )}
    </>
  );
}
