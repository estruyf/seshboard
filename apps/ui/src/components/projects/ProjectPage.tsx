import { Brain, ChevronRight, FolderGit2, FolderOpen, GitBranch, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { WorktreeStatus } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { guessHome, tildify } from '../../lib/format.ts';
import { PROJECT_TABS, useProjectPage, type ProjectTab } from '../../state/projectPageStore.ts';
import { useBranchesOf } from '../../state/branchesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useWorktreesOf } from '../../state/worktreesStore.ts';
import { useProjectActionList } from '../actions/useActions.ts';
import { Menu } from '../Menu.tsx';
import { useOpenIn } from '../OpenInButton.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { useProjectIconEntries } from '../sidebar/ProjectMenu.tsx';
import { SidebarToggle } from '../sidebar/SidebarToggle.tsx';
import { Button } from '../ui/Button.tsx';
import { BranchesTab } from '../branches/BranchesTab.tsx';
import { CountBadge } from '../ui/Pill.tsx';
import { WorktreesTab } from '../worktrees/WorktreesTab.tsx';
import { MemoryTab } from '../memory/MemoryTab.tsx';
import { useMemoryList } from '../memory/useMemoryList.ts';
import { guardMemoryEdits } from '../../state/memoryStore.ts';
import { goInHistory, useNavHistory } from '../../state/navHistoryStore.ts';
import { settingsSectionLabel } from '../SettingsView.tsx';
import { menuPoint } from './ProjectManagerView.tsx';
import { ProjectActionsTab, ProjectSettingsTab, ProjectOverview, ProjectSessions, useProjectSessionRows } from './ProjectTabs.tsx';

const TAB_LABEL: Record<ProjectTab, string> = { overview: 'Overview', sessions: 'Sessions', worktrees: 'Worktrees', branches: 'Branches', memory: 'Memory', actions: 'Actions', settings: 'Settings' };

/** Where the project's own checkout stands (branch, upstream, changes); null outside git or until read. */
function useCheckoutStatus(root: string, isGitRepo: boolean): WorktreeStatus | null {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [status, setStatus] = useState<WorktreeStatus | null>(null);
  useEffect(() => {
    setStatus(null);
    if (!client || !isGitRepo) return;
    let cancelled = false;
    client.call('worktree.status', { cwd: root }).then(
      (s) => !cancelled && setStatus(s),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [client, root, isGitRepo]);
  return status;
}

/**
 * Projects › <project> (or Settings › <page> › <project> when a Settings page opened it): a project's own page. The header says where it is (path, branch, upstream) with Open in
 * editor and New session; tabs below hold its Overview, Sessions, Worktrees, Branches, Memory, Actions and Settings. The tab you
 * leave a project on is the one it opens on next time (while the app runs).
 */
export function ProjectPage() {
  const root = useProjectPage((s) => s.root);
  const tab = useProjectPage((s) => s.tab);
  const setTab = useProjectPage((s) => s.setTab);
  const projects = useProjects((s) => s.projects);
  const project = root ? projects.get(root) : undefined;
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const openIn = useOpenIn();
  const home = useMemo(() => guessHome(projects.keys()), [projects]);
  const [isGitRepo, setIsGitRepo] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<ProjectTab, HTMLButtonElement>());
  const icons = useProjectIconEntries();
  const [iconMenu, setIconMenu] = useState<{ x: number; y: number } | null>(null);
  // Opened from a page of Settings (Memory's list of projects), the breadcrumb leads back there instead of to Projects.
  const fromSettings = useNavHistory((s) => {
    const { entries, index } = s.history;
    const here = entries[index];
    const before = entries[index - 1];
    return here?.view === 'project' && here.root === root && before?.view === 'settings' ? before.section : null;
  });

  useEffect(() => {
    setIsGitRepo(false);
    if (!client || !root || !project?.exists) return;
    let cancelled = false;
    void client.call('projects.inspect', { path: root }).then((r) => !cancelled && setIsGitRepo(r.isGitRepo), () => {});
    return () => {
      cancelled = true;
    };
  }, [client, root, project?.exists]);

  const status = useCheckoutStatus(root ?? '', isGitRepo && !!root);
  const sessions = useProjectSessionRows(root ?? '');
  const worktrees = useWorktreesOf(root);
  const branches = useBranchesOf(isGitRepo ? root : null);
  const { actions } = useProjectActionList(root);
  const memory = useMemoryList(project?.exists ? root : null);
  // Claude Code writes memory on its own: the count is read again whenever another tab is picked.
  const reloadMemory = memory.reload;
  useEffect(() => reloadMemory(), [tab, reloadMemory]);
  const counts: Partial<Record<ProjectTab, number>> = {
    sessions: sessions.length,
    worktrees: worktrees.list ? worktrees.list.worktrees.filter((w) => !w.isMain).length : undefined,
    branches: branches.list ? branches.list.branches.filter((b) => b.local).length : undefined,
    memory: memory.list?.memories.length,
    actions: actions.length,
  };

  // Back to the top when the tab or project changes. (A block body: scrollTo returns a promise in Chromium now,
  // and an effect may only return its cleanup.)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [root, tab]);

  if (!root || !project) {
    return (
      <div className="@container flex h-full min-h-0 flex-col" data-project-page>
        <header className="drag flex h-13 shrink-0 items-center gap-3 border-b border-border px-6">
          <SidebarToggle />
          <h1 className="flex-1 text-title font-semibold">Project</h1>
        </header>
        <div className="mx-auto grid max-w-3xl justify-items-start gap-3 px-6 py-8">
          <p className="text-ui text-muted">This project is no longer in your list.</p>
          <Button onClick={() => useSessions.getState().setView('projects')}>Show projects</Button>
        </div>
      </div>
    );
  }

  const startHere = () => {
    useProjects.getState().startIn(root);
    useSessions.getState().openNewSession();
  };
  // Arrow keys move between tabs and show them, as in any tab list; one Tab stop.
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = PROJECT_TABS.indexOf(tab);
    const next =
      event.key === 'ArrowRight' ? PROJECT_TABS[(index + 1) % PROJECT_TABS.length] : event.key === 'ArrowLeft' ? PROJECT_TABS[(index - 1 + PROJECT_TABS.length) % PROJECT_TABS.length] : event.key === 'Home' ? PROJECT_TABS[0] : event.key === 'End' ? PROJECT_TABS.at(-1) : null;
    if (!next) return;
    event.preventDefault();
    guardMemoryEdits(() => {
      setTab(next);
      tabRefs.current.get(next)?.focus();
    });
  };

  const upstream = status?.upstream;
  return (
    <div className="@container flex h-full min-h-0 flex-col" data-project-page={root}>
      <header className="drag shrink-0 border-b border-border px-6 pt-2.5">
        <div className="flex h-8 items-center gap-1">
          <SidebarToggle />
          <nav aria-label="Breadcrumb" className="no-drag flex items-center gap-0.5 text-ui text-muted">
            {fromSettings ? (
              <>
                <Button variant="quiet" size="sm" onClick={() => goInHistory(-1)} data-project-breadcrumb-settings>
                  Settings
                </Button>
                <ChevronRight size={13} className="text-faint" aria-hidden />
                <Button variant="quiet" size="sm" onClick={() => goInHistory(-1)} data-project-breadcrumb-settings-page={fromSettings}>
                  {settingsSectionLabel(fromSettings)}
                </Button>
              </>
            ) : (
              <Button variant="quiet" size="sm" onClick={() => useSessions.getState().setView('projects')} data-project-breadcrumb>
                Projects
              </Button>
            )}
            <ChevronRight size={13} className="text-faint" aria-hidden />
          </nav>
        </div>
        <div className="mt-1.5 flex min-w-0 items-center gap-3">
          {/* The icon opens its choices (image, emoji, letter) and the name, as on the Projects list. */}
          <button
            type="button"
            onClick={(e) => setIconMenu(menuPoint(e))}
            data-tooltip="Change icon or name"
            aria-label={`Change the icon or name of ${project.name}`}
            aria-haspopup="menu"
            aria-expanded={!!iconMenu}
            className="no-drag shrink-0 rounded-lg hover:opacity-80"
            data-project-icon-button
          >
            <ProjectIcon project={project} root={root} size={34} />
          </button>
          <div className="grid min-w-0 flex-1">
            <h1 className="truncate text-hero leading-tight font-semibold" data-project-name>
              {project.name}
            </h1>
            <p className="flex min-w-0 items-center gap-1.5 font-mono text-meta text-muted" data-project-meta>
              <span className="truncate" data-tooltip={root}>
                {tildify(root, home)}
              </span>
              {status?.branch && (
                <>
                  <span className="text-faint">·</span>
                  <GitBranch size={11} className="shrink-0" aria-hidden />
                  <span className="shrink-0">{status.branch}</span>
                </>
              )}
              {upstream && (
                <>
                  <span className="text-faint">·</span>
                  <span className="shrink-0">{upstream}</span>
                </>
              )}
            </p>
          </div>
          <div className="no-drag flex shrink-0 items-center gap-2">
            <Button icon={<FolderOpen size={13} aria-hidden />} disabled={!project.exists} onClick={() => void openIn(root).catch(() => {})} data-project-open-editor>
              Open in editor
            </Button>
            <Button variant="primary" icon={<Plus size={13} aria-hidden />} shortcut="session.new" disabled={!project.exists} onClick={startHere} data-project-new-session>
              New session
            </Button>
          </div>
        </div>
        {/* The row, not the tabs, overlaps the header's border by 1px: overflow-x-auto clips on both axes, so a tab
            hanging out of the row would make it scroll vertically. */}
        <div role="tablist" aria-label={`${project.name} sections`} className="no-drag -mb-px mt-3 flex gap-1 overflow-x-auto [scrollbar-width:none]" onKeyDown={onTabKey}>
          {PROJECT_TABS.map((id) => {
            const active = id === tab;
            const count = counts[id];
            return (
              <button
                key={id}
                ref={(el) => {
                  if (el) tabRefs.current.set(id, el);
                  else tabRefs.current.delete(id);
                }}
                type="button"
                role="tab"
                id={`project-tab-${id}`}
                aria-selected={active}
                aria-controls="project-tab-panel"
                tabIndex={active ? 0 : -1}
                onClick={() => guardMemoryEdits(() => setTab(id))}
                className={`flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-3 text-ui ${active ? 'border-accent-ink font-semibold text-text' : 'border-transparent text-muted hover:text-text'}`}
                data-project-tab={id}
              >
                {id === 'worktrees' && <FolderGit2 size={13} aria-hidden />}
                {id === 'branches' && <GitBranch size={13} aria-hidden />}
                {id === 'memory' && <Brain size={13} aria-hidden />}
                {TAB_LABEL[id]}
                {count !== undefined && <CountBadge count={count} />}
              </button>
            );
          })}
        </div>
      </header>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div role="tabpanel" id="project-tab-panel" aria-labelledby={`project-tab-${tab}`} className={`mx-auto px-6 py-5 ${tab === 'worktrees' || tab === 'branches' || tab === 'memory' ? 'max-w-6xl' : 'max-w-3xl'}`}>
          {tab === 'overview' ? (
            <ProjectOverview root={root} status={status} />
          ) : tab === 'sessions' ? (
            <ProjectSessions root={root} name={project.name} />
          ) : tab === 'worktrees' ? (
            // Keyed by project: its picks start from that project's suggestions.
            <WorktreesTab key={root} root={root} name={project.name} scrollRef={scrollRef} />
          ) : tab === 'branches' ? (
            <BranchesTab key={root} root={root} name={project.name} scrollRef={scrollRef} />
          ) : tab === 'memory' ? (
            <MemoryTab key={root} root={root} />
          ) : tab === 'actions' ? (
            <ProjectActionsTab root={root} />
          ) : (
            <ProjectSettingsTab project={project} isGitRepo={isGitRepo} />
          )}
        </div>
      </div>
      {iconMenu && <Menu x={iconMenu.x} y={iconMenu.y} entries={icons.entries(root, iconMenu, { identity: true })} label="Project icon" onClose={() => setIconMenu(null)} />}
      {icons.overlays}
    </div>
  );
}
