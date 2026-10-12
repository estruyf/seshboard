import { AlertTriangle, ArrowDown, ArrowUp, Ellipsis, FolderPlus, SquarePen } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { AUTO_MODEL, type ProjectDefaults, type ProjectInfo } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { agoText, guessHome, tildify } from '../../lib/format.ts';
import { openProject } from '../../state/projectPageStore.ts';
import { addedProjects, baseOrder, moveRoot } from '../../state/projectList.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { ProfileBadge } from '../profiles/ProfileBadge.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { SidebarToggle } from '../sidebar/SidebarToggle.tsx';
import { useProjectIconEntries } from '../sidebar/ProjectMenu.tsx';
import { Button } from '../ui/Button.tsx';
import { WorktreePill } from '../worktrees/WorktreePill.tsx';

/** Shows a summary of the defaults a project sets, e.g. "Opus · high effort · worktree". */
function describeDefaults(d: ProjectDefaults): string {
  const parts = [
    d.model === AUTO_MODEL ? 'Auto' : d.model,
    d.effort && `${d.effort} effort`,
    d.permissionMode && d.permissionMode !== 'default' && d.permissionMode,
    d.workspace === 'worktree' ? `worktree${d.baseRef === 'head' ? ' from HEAD' : ''}` : d.workspace === 'current' && 'current folder',
    d.branch && `on ${d.branch}`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Global defaults';
}

/** Where a menu opened from the keyboard goes (no pointer position): under the button. */
export const menuPoint = (event: MouseEvent<HTMLElement>) => {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.detail ? { x: event.clientX, y: event.clientY } : { x: rect.left, y: rect.bottom + 4 };
};

function ProjectRow({
  project,
  index,
  total,
  home,
  onMove,
  onIconMenu,
  onMore,
}: {
  project: ProjectInfo;
  index: number;
  total: number;
  home: string | null;
  onMove(delta: -1 | 1): void;
  onIconMenu(event: MouseEvent<HTMLElement>): void;
  onMore(event: MouseEvent<HTMLElement>): void;
}) {
  const startHere = () => {
    useProjects.getState().startIn(project.root);
    useSessions.getState().openNewSession();
  };

  return (
    <li className="rounded-lg border border-border bg-card" data-project-row={project.root}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button type="button" onClick={onIconMenu} data-tooltip="Change icon or name" aria-label={`Change the icon or name of ${project.name}`} aria-haspopup="menu" className="shrink-0 rounded-md hover:opacity-80">
          <ProjectIcon project={project} root={project.root} size={30} />
        </button>
        <button type="button" onClick={() => openProject(project.root)} className="grid min-w-0 flex-1 text-left" data-tooltip={tildify(project.root, home)} data-project-open>
          <span className="truncate text-body font-semibold">{project.name}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted">
            {!project.exists && (
              <span className="flex shrink-0 items-center gap-1 text-warn">
                <AlertTriangle size={11} aria-hidden /> Folder not found ·
              </span>
            )}
            <ProfileBadge profileId={project.profileId} />
            <span className="min-w-0 truncate">
              <span data-defaults-summary>{describeDefaults(project.defaults)}</span>
              {project.sessionCount > 0 && ` · ${project.sessionCount} ${project.sessionCount === 1 ? 'session' : 'sessions'}`}
              {project.lastActivity !== null && `, active ${agoText(project.lastActivity)}`}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {project.exists && (
            <span className="mr-1.5 @max-[640px]:hidden">
              <WorktreePill root={project.root} />
            </span>
          )}
          {/* Names include the project: a screen reader hears "Move Website up", not five rows of "Move up". */}
          <Button variant="quiet" iconOnly icon={<SquarePen size={14} aria-hidden />} onClick={startHere} disabled={!project.exists} data-tooltip="New session in this project" aria-label={`New session in ${project.name}`} />
          <Button variant="quiet" iconOnly icon={<Ellipsis size={14} aria-hidden />} onClick={onMore} aria-haspopup="menu" aria-label={`Options for ${project.name}`} data-project-more-button />
          <Button
            variant="quiet"
            iconOnly
            icon={<ArrowUp size={14} aria-hidden />}
            onClick={() => onMove(-1)}
            disabled={index === 0}
            data-tooltip="Move up in the list"
            aria-label={`Move ${project.name} up`}
            data-move-up
          />
          <Button
            variant="quiet"
            iconOnly
            icon={<ArrowDown size={14} aria-hidden />}
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            data-tooltip="Move down in the list"
            aria-label={`Move ${project.name} down`}
            data-move-down
          />
        </div>
      </div>
    </li>
  );
}

/** Your projects: add, remove and reorder them; each opens its own page (sessions, worktrees, actions, defaults). */
export function ProjectManagerView() {
  const projects = useProjects((s) => s.projects);
  const showAdd = useProjects((s) => s.showAdd);
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const reload = useProjects((s) => s.reload);
  const icons = useProjectIconEntries();
  const list = useMemo(() => addedProjects(projects), [projects]);
  const home = useMemo(() => guessHome(projects.keys()), [projects]);
  const [menu, setMenu] = useState<{ root: string; x: number; y: number; full: boolean } | null>(null);

  // The order last sent, until the list catches up with it: two quick clicks must not both start from the old list.
  const pendingOrder = useRef<string[] | null>(null);
  useEffect(() => {
    const shown = list.map((p) => p.root);
    if (pendingOrder.current?.join('\n') === shown.join('\n')) pendingOrder.current = null;
  }, [list]);
  const move = async (root: string, delta: -1 | 1) => {
    if (!client) return;
    const roots = moveRoot(baseOrder(pendingOrder.current, list.map((p) => p.root)), root, delta);
    pendingOrder.current = roots;
    try {
      await client.call('projects.reorder', { roots });
    } catch {
      pendingOrder.current = null;
    }
    reload();
  };

  // The icon opens only the icon and name choices; ⋯ has everything, removing included.
  const entries: MenuEntry[] = menu ? icons.entries(menu.root, menu, { identity: !menu.full }) : [];

  return (
    <div className="@container flex h-full min-h-0 flex-col" data-project-manager>
      <header className="drag flex h-13 shrink-0 items-center gap-3 border-b border-border px-6">
        <SidebarToggle />
        <h1 className="flex-1 text-title font-semibold">Projects</h1>
        <Button icon={<FolderPlus size={13} aria-hidden />} onClick={() => showAdd(true)} className="no-drag" data-manager-add>
          Add project
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-3xl gap-4 px-6 py-6">
          <p className="text-ui text-muted">
            Projects are the folders you work in with Switchboard. They are listed in the sidebar and the New session view, in this order. Open one for its sessions, worktrees, actions and defaults.
            Removing one only takes it off these lists: nothing on disk changes, and its sessions stay in search and under sessions from other apps.
          </p>
          {list.length === 0 ? (
            <div className="grid justify-items-start gap-2 rounded-lg border border-dashed border-border px-4 py-5" data-no-projects>
              <p className="text-body font-semibold">No projects yet</p>
              <p className="text-ui text-muted">Add the folders you want to start Claude Code sessions in. Folders you have used Claude Code in are suggested.</p>
              <Button variant="primary" onClick={() => showAdd(true)} className="mt-1">
                Add a project
              </Button>
            </div>
          ) : (
            <ul className="grid gap-2" aria-label="Your projects">
              {list.map((project, index) => (
                <ProjectRow
                  key={project.root}
                  project={project}
                  index={index}
                  total={list.length}
                  home={home}
                  onMove={(delta) => void move(project.root, delta)}
                  onIconMenu={(e) => setMenu({ root: project.root, ...menuPoint(e), full: false })}
                  onMore={(e) => setMenu({ root: project.root, ...menuPoint(e), full: true })}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
      {menu && <Menu x={menu.x} y={menu.y} entries={entries} label={menu.full ? 'Project options' : 'Project icon'} onClose={() => setMenu(null)} />}
      {icons.overlays}
    </div>
  );
}
