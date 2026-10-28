import { AlertTriangle, GripVertical, Plus, Search, Settings, X } from 'lucide-react';
import { memo, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import type { ProjectInfo } from '@seshboard/protocol/client';
import { contextMenuPoint, isContextMenuKey } from '../../lib/contextMenu.ts';
import { shortAge, tildify } from '../../lib/format.ts';
import { keysFor, spokenKeys } from '../../lib/shortcuts.ts';
import { useHomeFolder } from '../../state/homeStore.ts';
import { openProject, useProjectPage } from '../../state/projectPageStore.ts';
import { canReorder, moveProject, projectActivity, worktreeHint, type ProjectActivity } from '../../state/projectsNav.ts';
import { useProfile } from '../../state/profilesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { rowStatus } from '../../state/sidebarRows.ts';
import { useListedRows } from '../../state/useQueue.ts';
import { useWorktreeRows } from '../../state/worktreesStore.ts';
import { Menu } from '../Menu.tsx';
import { ProfileDot } from '../profiles/ProfileBadge.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { useQueueDrag } from '../queue/useQueueDrag.ts';
import { useProjectIconEntries } from '../sidebar/ProjectMenu.tsx';
import { SidebarToggle } from '../sidebar/SidebarToggle.tsx';
import { Button } from '../ui/Button.tsx';
import { CountBadge } from '../ui/Pill.tsx';
import { Kbd } from '../ui/Kbd.tsx';

const MIME = 'application/x-seshboard-project';
/** How close to the list's top or bottom edge a drag scrolls it, and how far per event. */
const EDGE_PX = 36;
const SCROLL_STEP = 12;

/** "Personal · 4 can go": the profile (with more than one) and the worktree hint. */
function RowMeta({ project }: { project: ProjectInfo }) {
  const profile = useProfile(project.profileId);
  const { rows } = useWorktreeRows(project.exists ? project.root : null);
  const others = rows.filter((r) => r.group !== 'main');
  const hint = worktreeHint(others.length, others.filter((r) => r.group === 'safe').length);
  if (!project.exists) {
    return (
      <span className="flex min-w-0 items-center gap-1 text-meta text-warn">
        <AlertTriangle size={11} aria-hidden /> Folder not found
      </span>
    );
  }
  if (!profile && !hint) return null;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted" data-project-row-meta>
      {profile && <ProfileDot color={profile.color} />}
      <span className="min-w-0 truncate">{[profile?.name, hint].filter(Boolean).join(' · ')}</span>
    </span>
  );
}

const ACTIVITY_DOT: Record<Exclude<ProjectActivity, null>, string> = { working: 'bg-accent-ink', 'needs-you': 'bg-warn animate-pulse' };
const ACTIVITY_LABEL: Record<Exclude<ProjectActivity, null>, string> = { working: 'Working', 'needs-you': 'Needs you' };

interface RowProps {
  project: ProjectInfo;
  selected: boolean;
  activity: ProjectActivity;
  now: number;
  home: string | null;
  /** Searching: no dragging, and the row says why. */
  locked: boolean;
  dragging: boolean;
  mark: 'before' | 'after' | null;
  drag: ReturnType<ReturnType<typeof useQueueDrag>['props']> | null;
  onOpen(root: string): void;
  onMenu(root: string, at: { x: number; y: number; above: boolean }): void;
  onKeyDown(event: KeyboardEvent<HTMLDivElement>, root: string): void;
}

const ProjectRow = memo(function ProjectRow({ project, selected, activity, now, home, locked, dragging, mark, drag, onOpen, onMenu, onKeyDown }: RowProps) {
  const openMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    onMenu(project.root, contextMenuPoint(event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : null, rect, window.innerHeight));
  };
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      id={`project-option-${encodeURIComponent(project.root)}`}
      onClick={() => onOpen(project.root)}
      onContextMenu={openMenu}
      onKeyDown={(e) => {
        if (isContextMenuKey(e)) {
          e.preventDefault();
          const rect = e.currentTarget.getBoundingClientRect();
          onMenu(project.root, contextMenuPoint(null, rect, window.innerHeight));
          return;
        }
        onKeyDown(e, project.root);
      }}
      data-tooltip={locked ? 'Clear the search to reorder' : tildify(project.root, home)}
      className={`group/project relative flex h-13 shrink-0 cursor-default items-center gap-2.5 rounded-lg pr-2 pl-3 outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
        selected ? 'bg-selected shadow-[inset_2px_0_0_var(--color-accent-ink)]' : 'hover:bg-border/45'
      } ${dragging ? 'opacity-60 shadow-lg' : ''}`}
      data-project-row={project.root}
      data-selected={selected || undefined}
      {...(drag ?? {})}
    >
      {mark && <span aria-hidden className={`absolute inset-x-2 h-0.5 rounded-full bg-accent-ink ${mark === 'before' ? '-top-px' : '-bottom-px'}`} data-project-drop={mark} />}
      {/* The grip only shows on hover: the whole row drags, the grip says it can. */}
      {drag && <GripVertical size={12} className="absolute left-0 shrink-0 cursor-grab text-faint opacity-0 group-hover/project:opacity-100" aria-hidden data-project-grip />}
      <ProjectIcon project={project} root={project.root} size={26} />
      <span className="grid min-w-0 flex-1" data-project-open>
        <span className={`truncate text-body ${selected ? 'font-semibold' : ''}`}>{project.name}</span>
        <RowMeta project={project} />
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {activity && (
          <span role="img" aria-label={ACTIVITY_LABEL[activity]} data-tooltip={ACTIVITY_LABEL[activity]} className={`size-2 rounded-full ${ACTIVITY_DOT[activity]}`} data-project-activity={activity} />
        )}
        {/* The time gives way to the gear on hover (and while the row has focus). */}
        {project.lastActivity !== null && <span className="text-meta text-muted tabular-nums group-focus-within/project:hidden group-hover/project:hidden">{shortAge(project.lastActivity, now)}</span>}
        <span className="hidden group-focus-within/project:flex group-hover/project:flex">
          <Button
            variant="quiet"
            size="sm"
            iconOnly
            tabIndex={-1}
            icon={<Settings size={14} aria-hidden />}
            aria-label={`Settings for ${project.name}`}
            data-tooltip="Settings"
            onClick={(e) => {
              e.stopPropagation();
              openProject(project.root, 'settings');
            }}
            data-project-row-settings={project.root}
          />
        </span>
      </span>
    </div>
  );
});

/**
 * The list on the left of the Projects view: "Projects", a count and +, "Find a project", one row per project in the
 * saved order, and "Drag to reorder · ⌥↑↓ to switch". A click opens the project on the tab it was left on; the gear,
 * on its Settings. Dragging reorders (off while searching); right-click opens the row menu (Rename…, Remove…).
 */
export function ProjectList({
  list,
  shown,
  query,
  onQuery,
  searchRef,
  onPicked,
  onSave,
  onKeyMove,
  announcement,
}: {
  /** Every project, in order. */
  list: readonly ProjectInfo[];
  /** The ones the search keeps. */
  shown: readonly ProjectInfo[];
  query: string;
  onQuery(query: string): void;
  searchRef: RefObject<HTMLInputElement | null>;
  /** A project was opened from the list (closes it over a narrow view). */
  onPicked?(): void;
  onSave(order: string[]): void;
  /** ⌥⇧↑ ⌥⇧↓ on a row. */
  onKeyMove(root: string, delta: -1 | 1): void;
  announcement: string;
}) {
  const root = useProjectPage((s) => s.root);
  const showAdd = useProjects((s) => s.showAdd);
  const home = useHomeFolder();
  const rows = useListedRows();
  const activity = useMemo(() => projectActivity(rows, rowStatus), [rows]);
  const icons = useProjectIconEntries();
  const [menu, setMenu] = useState<{ root: string; x: number; y: number; above: boolean } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const reorder = canReorder(query);
  const drag = useQueueDrag({
    mime: MIME,
    ids: () => list.map((p) => p.root),
    move: (id, to) => {
      const order = list.map((p) => p.root);
      onSave(moveProject(order, order.indexOf(id), to));
    },
  });
  const now = Date.now();

  const open = (target: string) => {
    openProject(target);
    onPicked?.();
  };
  const focusRow = (target: string) => listRef.current?.querySelector<HTMLElement>(`[data-project-row=${JSON.stringify(target)}]`)?.focus();

  // ↑ ↓ Home End move through the list and open what they land on (selection follows focus); ↩ opens it too.
  const onRowKey = (event: KeyboardEvent<HTMLDivElement>, at: string) => {
    if (event.altKey && event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      if (!reorder) return;
      event.preventDefault();
      onKeyMove(at, event.key === 'ArrowUp' ? -1 : 1);
      requestAnimationFrame(() => focusRow(at));
      return;
    }
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const index = shown.findIndex((p) => p.root === at);
    const next = event.key === 'ArrowDown' ? shown[index + 1] : event.key === 'ArrowUp' ? shown[index - 1] : event.key === 'Home' ? shown[0] : event.key === 'End' ? shown.at(-1) : null;
    if (next) {
      event.preventDefault();
      openProject(next.root, useProjectPage.getState().tab);
      requestAnimationFrame(() => focusRow(next.root));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open(at);
    }
  };

  // The list scrolls by itself while a drag is near its top or bottom edge.
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || !event.dataTransfer.types.includes(MIME)) return;
    const rect = el.getBoundingClientRect();
    if (event.clientY < rect.top + EDGE_PX) el.scrollBy({ top: -SCROLL_STEP });
    else if (event.clientY > rect.bottom - EDGE_PX) el.scrollBy({ top: SCROLL_STEP });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar" data-project-list>
      <div className="drag flex h-13 shrink-0 items-center gap-2 px-4">
        <SidebarToggle />
        <h2 className="text-title font-semibold">Projects</h2>
        <CountBadge count={list.length} />
        <span className="flex-1" />
        <Button variant="quiet" iconOnly icon={<Plus size={15} aria-hidden />} aria-label="Add a project folder" onClick={() => showAdd(true)} className="no-drag" data-manager-add />
      </div>
      <div className="px-3 pb-2">
        <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-bg px-2.5 text-ui focus-within:border-accent-ink/60">
          <Search size={13} className="shrink-0 text-faint" aria-hidden />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.preventDefault();
                onQuery('');
              } else if (e.key === 'ArrowDown' && shown[0]) {
                e.preventDefault();
                focusRow(shown.some((p) => p.root === root) ? root! : shown[0].root);
              } else if (e.key === 'Enter' && shown[0]) {
                e.preventDefault();
                open(shown[0].root);
              }
            }}
            placeholder="Find a project"
            aria-label="Find a project"
            aria-controls="project-listbox"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint"
            data-project-search
          />
          {query ? (
            <Button variant="quiet" size="sm" iconOnly icon={<X size={12} aria-hidden />} aria-label="Clear the search" onClick={() => onQuery('')} className="-mr-1" />
          ) : (
            <Kbd shortcut="projects.find" aria-hidden />
          )}
        </label>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" onDragOver={onDragOver}>
        {list.length > 0 && shown.length === 0 && <p className="px-3 py-2 text-ui text-muted">No project matches “{query}”.</p>}
        <div ref={listRef} role="listbox" id="project-listbox" aria-label="Projects" className="grid gap-0.5">
          {shown.map((project) => (
            <ProjectRow
              key={project.root}
              project={project}
              selected={project.root === root}
              activity={activity.get(project.root) ?? null}
              now={now}
              home={home}
              locked={!reorder}
              dragging={drag.dragging === project.root}
              mark={drag.markFor(project.root)}
              drag={reorder ? drag.props(project.root) : null}
              onOpen={open}
              onMenu={(at, point) => setMenu({ root: at, ...point })}
              onKeyDown={onRowKey}
            />
          ))}
        </div>
      </div>
      <p className="shrink-0 border-t border-border px-4 py-2 text-meta text-faint" data-project-list-footer>
        {reorder ? 'Drag to reorder · ' : ''}
        <Kbd shortcut="projects.switch" aria-hidden />
        <Kbd keys="arrowdown" aria-hidden className="ml-0.5" />
        <span className="sr-only">{spokenKeys(keysFor('projects.switch'))}</span> to switch
      </p>
      <p role="status" aria-live="polite" className="sr-only" data-project-announcement>
        {announcement}
      </p>
      {menu && <Menu x={menu.x} y={menu.y} above={menu.above} entries={icons.entries(menu.root, menu)} label={`${list.find((p) => p.root === menu.root)?.name ?? ''} options`} onClose={() => setMenu(null)} />}
      {icons.overlays}
    </div>
  );
}
