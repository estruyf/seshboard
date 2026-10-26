import { Brain, ChevronDown, ChevronLeft, ChevronRight, Ellipsis, FolderGit2, GitBranch, Plus, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ProjectInfo, WorktreeStatus } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { tildify } from '../../lib/format.ts';
import { useHomeFolder } from '../../state/homeStore.ts';
import { PROJECT_TABS, switchProject, useProjectPage, type ProjectTab } from '../../state/projectPageStore.ts';
import { addedProjects } from '../../state/projectList.ts';
import { neighbourProject } from '../../state/projectsNav.ts';
import { formatKeys } from '../../lib/shortcuts.ts';
import { useMultipleProfiles, useProfile } from '../../state/profilesStore.ts';
import { ProfileDot } from '../profiles/ProfileBadge.tsx';
import { ProjectSwitcher } from './ProjectSwitcher.tsx';
import { useBranchesOf } from '../../state/branchesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useWorktreesOf } from '../../state/worktreesStore.ts';
import { useProjectActionList } from '../actions/useActions.ts';
import { Menu } from '../Menu.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { useProjectIconEntries } from '../sidebar/ProjectMenu.tsx';
import { SidebarToggle } from '../sidebar/SidebarToggle.tsx';
import { Button } from '../ui/Button.tsx';
import { BranchesTab } from '../branches/BranchesTab.tsx';
import { CountBadge } from '../ui/Pill.tsx';
import { WorktreesTab } from '../worktrees/WorktreesTab.tsx';
import { TriggersTab } from '../triggers/TriggersTab.tsx';
import { useTriggers } from '../../state/triggersStore.ts';
import { MemoryTab } from '../memory/MemoryTab.tsx';
import { useMemoryList } from '../memory/useMemoryList.ts';
import { guardMemoryEdits } from '../../state/memoryStore.ts';
import { goInHistory, useNavHistory } from '../../state/navHistoryStore.ts';
import { settingsOrigin } from '../../state/navHistory.ts';
import { settingsSectionLabel } from '../SettingsView.tsx';
import { menuPoint } from './menuPoint.ts';
import { ProjectActionsTab, ProjectSettingsTab, ProjectOverview, ProjectSessions, useProjectSessionRows } from './ProjectTabs.tsx';

const TAB_LABEL: Record<ProjectTab, string> = { overview: 'Overview', sessions: 'Sessions', triggers: 'Triggers', worktrees: 'Worktrees', branches: 'Branches', memory: 'Memory', actions: 'Actions', settings: 'Settings' };

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

/** "· ● Personal" in the header's line, with more than one Claude profile. */
function ProjectProfile({ profileId }: { profileId: string | null }) {
  const multiple = useMultipleProfiles();
  const profile = useProfile(profileId);
  if (!multiple || !profile) return null;
  return (
    <>
      <span className="text-faint">·</span>
      <span className="flex shrink-0 items-center gap-1" data-tooltip={`Claude profile: ${profile.name}`}>
        <ProfileDot color={profile.color} />
        {profile.name}
      </span>
    </>
  );
}

/**
 * Projects › <project> (or Settings › <page> › <project> when a Settings page opened it): a project's own page. The header says where it is (path, branch, upstream) with Open in
 * editor and New session; tabs below hold its Overview, Sessions, Worktrees, Branches, Memory, Actions and Settings. The tab you
 * leave a project on is the one it opens on next time (while the app runs).
 */
export function ProjectPage({ list, narrow = false, onShowList }: { list: readonly ProjectInfo[]; narrow?: boolean; onShowList?(): void }) {
  const root = useProjectPage((s) => s.root);
  const tab = useProjectPage((s) => s.tab);
  const setTab = useProjectPage((s) => s.setTab);
  const projects = useProjects((s) => s.projects);
  const project = root ? projects.get(root) : undefined;
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const home = useHomeFolder();
  const [isGitRepo, setIsGitRepo] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<ProjectTab, HTMLButtonElement>());
  const icons = useProjectIconEntries();
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);
  const [switcher, setSwitcher] = useState<{ x: number; y: number } | null>(null);
  const nameRef = useRef<HTMLButtonElement>(null);
  const allProjects = useMemo(() => addedProjects(projects), [projects]);
  // Opened from a page of Settings (Memory's list of projects), the breadcrumb leads back there instead of to Projects.
  const fromSettings = useNavHistory((s) => settingsOrigin(s.history, root));

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
  const triggerCount = useTriggers((s) => s.triggers.filter((t) => t.projectRoot === root).length);
  // Claude Code writes memory on its own: the count is read again whenever another tab is picked.
  const reloadMemory = memory.reload;
  useEffect(() => reloadMemory(), [tab, reloadMemory]);
  const counts: Partial<Record<ProjectTab, number>> = {
    sessions: sessions.length,
    triggers: triggerCount,
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

  const previous = neighbourProject(list, root, -1);
  const next = neighbourProject(list, root, 1);
  const go = (target: ProjectInfo | null) => target && guardMemoryEdits(() => switchProject(target.root));
  return (
    <div className="@container flex h-full min-h-0 flex-col" data-project-page={root}>
      <header className="drag shrink-0 border-b border-border px-6 pt-3">
        {/* Opened from a page of Settings (Memory's list of projects): the way back there. */}
        {fromSettings && (
          <nav aria-label="Breadcrumb" className="no-drag -mt-1 mb-1 flex items-center gap-0.5 text-ui text-muted">
            <Button variant="quiet" size="sm" icon={<ChevronLeft size={13} aria-hidden />} onClick={() => goInHistory(-1)} data-project-breadcrumb-settings data-project-breadcrumb-settings-page={fromSettings}>
              Settings › {settingsSectionLabel(fromSettings)}
            </Button>
          </nav>
        )}
        <div className="flex min-w-0 items-center gap-3">
          {narrow && (
            <>
              <SidebarToggle />
              <Button variant="quiet" iconOnly icon={<ChevronLeft size={16} aria-hidden />} aria-label="Show projects" onClick={onShowList} className="no-drag -mr-1" data-project-show-list />
            </>
          )}
          <ProjectIcon project={project} root={root} size={34} />
          <div className="grid min-w-0 flex-1">
            <button
              ref={nameRef}
              type="button"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setSwitcher((open) => (open ? null : { x: rect.left, y: rect.bottom + 4 }));
              }}
              aria-haspopup="dialog"
              aria-expanded={!!switcher}
              aria-label={`${project.name}, switch project`}
              className="no-drag flex min-w-0 items-center gap-1.5 justify-self-start rounded-md text-left hover:text-text"
              data-project-switcher-button
            >
              <h1 className="truncate text-hero leading-tight font-semibold" data-project-name>
                {project.name}
              </h1>
              <ChevronDown size={15} className={`shrink-0 text-muted transition-transform ${switcher ? 'rotate-180' : ''}`} aria-hidden />
            </button>
            <p className="flex min-w-0 items-center gap-1.5 text-meta text-muted" data-project-meta>
              <span className="truncate font-mono" data-tooltip={root}>
                {tildify(root, home)}
              </span>
              <ProjectProfile profileId={project.profileId} />
              {status?.branch && (
                <>
                  <span className="text-faint">·</span>
                  <GitBranch size={11} className="shrink-0" aria-hidden />
                  <span className="shrink-0 font-mono">{status.branch}</span>
                </>
              )}
            </p>
          </div>
          <div className="no-drag flex shrink-0 items-center gap-1">
            {!narrow && (
              <>
                <Button
                  variant="quiet"
                  iconOnly
                  icon={<ChevronLeft size={15} aria-hidden />}
                  disabled={!previous}
                  onClick={() => go(previous)}
                  aria-label={previous ? `Previous project: ${previous.name}` : 'Previous project'}
                  data-tooltip={previous ? `${previous.name} (${formatKeys('alt+arrowup')})` : undefined}
                  data-project-previous
                />
                <Button
                  variant="quiet"
                  iconOnly
                  icon={<ChevronRight size={15} aria-hidden />}
                  disabled={!next}
                  onClick={() => go(next)}
                  aria-label={next ? `Next project: ${next.name}` : 'Next project'}
                  data-tooltip={next ? `${next.name} (${formatKeys('alt+arrowdown')})` : undefined}
                  data-project-next
                  className="mr-2"
                />
              </>
            )}
            <Button variant="primary" icon={<Plus size={13} aria-hidden />} shortcut="session.new" kbdHideNarrow disabled={!project.exists} onClick={startHere} data-project-new-session>
              New session
            </Button>
            <Button
              variant="quiet"
              iconOnly
              icon={<Ellipsis size={15} aria-hidden />}
              aria-label={`Options for ${project.name}`}
              aria-haspopup="menu"
              aria-expanded={!!moreMenu}
              onClick={(e) => setMoreMenu(menuPoint(e))}
              data-project-more
            />
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
                {id === 'triggers' && <Zap size={13} aria-hidden />}
                {TAB_LABEL[id]}
                {count !== undefined && <CountBadge count={count} />}
              </button>
            );
          })}
        </div>
      </header>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div role="tabpanel" id="project-tab-panel" aria-labelledby={`project-tab-${tab}`} className={`mx-auto px-6 py-5 ${tab === 'worktrees' || tab === 'branches' || tab === 'memory' ? 'max-w-6xl' : tab === 'triggers' ? 'max-w-5xl' : 'max-w-3xl'}`}>
          {/* Switching projects keeps focus where it was; this heading says which project the panel now shows. */}
          <h2 className="sr-only" aria-live="polite" data-project-panel-heading>
            {project.name}, {TAB_LABEL[tab]}
          </h2>
          {tab === 'overview' ? (
            <ProjectOverview project={project} />
          ) : tab === 'sessions' ? (
            <ProjectSessions root={root} name={project.name} />
          ) : tab === 'triggers' ? (
            <TriggersTab root={root} />
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
      {moreMenu && <Menu x={moreMenu.x} y={moreMenu.y} entries={icons.entries(root, moreMenu, { identity: true })} label={`${project.name} options`} onClose={() => setMoreMenu(null)} />}
      {switcher && <ProjectSwitcher list={allProjects} current={root} x={switcher.x} y={switcher.y} anchor={nameRef} onClose={() => setSwitcher(null)} />}
      {icons.overlays}
    </div>
  );
}
