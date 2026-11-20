import { ChevronRight, Ellipsis, Plus } from 'lucide-react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { ProjectState, SidebarListRow } from '../../state/sidebarRows.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { ComputerChip } from '../computers/ComputerChip.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { Button } from '../ui/Button.tsx';

/** The state dot of a session or a folded project's part, in its status colour. */
export const STATE_DOT: Record<ProjectState, string> = { 'needs-you': 'bg-warn', working: 'bg-accent-ink', review: 'bg-unread', open: 'bg-faint' };

export function StateDot({ state, className = '' }: { state: ProjectState; className?: string }) {
  return <span className={`size-2 shrink-0 rounded-full ${STATE_DOT[state]} ${className}`} aria-hidden data-state-dot={state} />;
}

/**
 * A project's header while the sidebar groups by project: a chevron, its icon, its name and how many sessions it holds.
 * Under the pointer (or with focus inside) the count gives way to New session in the project and its menu. It is a
 * treeitem: ← folds it, → unfolds it, a click or the chevron folds it, ⌥-click folds every project.
 */
export function ProjectGroupRow({
  row,
  tabbable,
  onToggle,
  onMenu,
}: {
  row: Extract<SidebarListRow, { kind: 'project' }>;
  tabbable: boolean;
  onToggle(key: string, all: boolean): void;
  /** The project's menu at a point, or null for a project on another computer, which has none here. */
  onMenu: ((key: string, at: { x: number; y: number }) => void) | null;
}) {
  const project = useProjects((s) => (row.remote ? undefined : s.projects.get(row.key)));
  const local = !row.remote;
  const below = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom + 2 };
  };
  const newHere = () => {
    useProjects.getState().startIn(row.key);
    useSessions.getState().openNewSession();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle(row.key, false);
    } else if (onMenu && ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu')) {
      event.preventDefault();
      onMenu(row.key, below(event.currentTarget));
    }
  };
  return (
    <div className={`flex h-full items-end ${row.first ? '' : 'pt-1'}`}>
      <div
        role="treeitem"
        aria-level={1}
        aria-expanded={row.open}
        aria-label={`${row.name}, ${row.count} ${row.count === 1 ? 'session' : 'sessions'}${row.open ? '' : ', folded'}`}
        tabIndex={tabbable ? 0 : -1}
        onClick={(event: MouseEvent) => onToggle(row.key, event.altKey)}
        onKeyDown={onKeyDown}
        onContextMenu={
          onMenu
            ? (event) => {
                event.preventDefault();
                onMenu(row.key, { x: event.clientX, y: event.clientY });
              }
            : undefined
        }
        className="group/project flex h-8 w-full cursor-default items-center gap-2 rounded-lg pr-1.5 pl-2.5 select-none hover:bg-text/5 focus-visible:bg-text/5"
        data-sidebar-project={row.key}
        data-sidebar-project-folded={row.open ? undefined : true}
      >
        <ChevronRight size={13} className={`shrink-0 text-faint transition-transform ${row.open ? 'rotate-90' : ''}`} aria-hidden />
        <ProjectIcon project={project} root={row.key} size={18} name={row.remote ? row.name : undefined} remote={row.remote?.computerId ?? false} />
        <span className="min-w-0 flex-1 truncate text-body font-semibold text-text">{row.name}</span>
        {row.remote && <ComputerChip name={row.remote.computerName} computerId={row.remote.computerId} offline={row.remote.offline} />}
        {/* The count, or the project's two buttons while the pointer is on the row or focus is inside it. */}
        <span className={`shrink-0 pr-1 text-ui text-faint tabular-nums ${local ? 'group-hover/project:hidden group-focus-within/project:hidden' : ''}`} data-sidebar-project-count>
          {row.count}
        </span>
        {local && (
          <span className="hidden shrink-0 items-center gap-0.5 group-hover/project:flex group-focus-within/project:flex">
            <Button
              variant="quiet"
              size="sm"
              iconOnly
              tabIndex={-1}
              icon={<Plus size={14} aria-hidden />}
              aria-label={`New session in ${row.name}`}
              data-tooltip={`New session in ${row.name}`}
              data-sidebar-project-new
              onClick={(event) => {
                event.stopPropagation();
                newHere();
              }}
            />
            {onMenu && (
              <Button
                variant="quiet"
                size="sm"
                iconOnly
                tabIndex={-1}
                icon={<Ellipsis size={14} aria-hidden />}
                aria-label={`${row.name} options`}
                aria-haspopup="menu"
                data-sidebar-project-menu
                onClick={(event) => {
                  event.stopPropagation();
                  onMenu(row.key, below(event.currentTarget));
                }}
              />
            )}
          </span>
        )}
      </div>
    </div>
  );
}

/** Under a folded project: what is in it, each part with its state's dot ("● 1 needs you  ● 2 working"). */
export function ProjectSummaryLine({ row }: { row: Extract<SidebarListRow, { kind: 'project-summary' }> }) {
  return (
    <p className="flex h-full min-w-0 items-start gap-2.5 pr-3 pl-[2.375rem] text-meta text-faint" data-sidebar-project-summary={row.key}>
      {row.parts.map((part) => (
        <span key={part.state} className={`flex shrink-0 items-center gap-1 ${part.state === 'needs-you' ? 'font-medium text-warn' : ''}`}>
          <StateDot state={part.state} className="size-1.5" />
          {part.text}
        </span>
      ))}
    </p>
  );
}
