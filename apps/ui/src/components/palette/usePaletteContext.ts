import { isAbsolutePath } from '@switchboard/protocol/client';
import { useEffect, useMemo, useState } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { basename } from '../../lib/format.ts';
import { findModelOption } from '../../lib/models.ts';
import { isActiveHost, useHosts } from '../../state/hostsStore.ts';
import { useCatchUp } from '../../state/catchUpStore.ts';
import { showOf } from '../../state/catchUpShow.ts';
import { promptLabel } from '../../state/queue.ts';
import { useUnsent } from '../drafts/useUnsent.ts';
import { useQueue } from '../../state/useQueue.ts';
import { useSchedules } from '../../state/schedulesStore.ts';
import { usePaletteBus } from '../../state/paletteBus.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { addedProjects } from '../../state/projectList.ts';
import { useProjectPage } from '../../state/projectPageStore.ts';
import { useCloneEnabled } from '../../state/cloneStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { isQuestionsFolder } from '../../lib/questions.ts';
import { toRows, useSessions } from '../../state/sessionsStore.ts';
import { isActive } from '../../state/sidebarRows.ts';
import { useSidebar } from '../../state/sidebarStore.ts';
import { parentSplit } from '../../state/tiling.ts';
import { neighbour, type Way } from '../../state/tilingGeometry.ts';
import { useTerminals } from '../../state/terminalsStore.ts';
import { useThemes } from '../../state/themeStore.ts';
import { activeComposer, useComposerTargets } from '../../state/composerTargets.ts';
import { draftRoot } from '../../state/drafts.ts';
import { useSavedPrompts } from '../savedPrompts/savedPromptsStore.ts';
import { useProjectActionList } from '../actions/useActions.ts';
import { APP_TERMINAL, appTerminalFolder, ownerSession, terminalOwner } from '../terminal/appTerminal.ts';
import { planGit } from '../git/gitPlan.ts';
import { useReadOnlyFork } from '../../state/githubOriginStore.ts';
import { inWorktree } from '../worktree/branchMenu.ts';
import type { PaletteContext, PaletteGit, PaletteSession, PaletteView } from './paletteContext.ts';
import { useComputers } from '../../state/computersStore.ts';
import { localSessionId } from '../../state/remoteSelection.ts';
import { popoutSession } from '../../state/popoutsStore.ts';

/** The checkout's state for the git commands, read once when the palette opens (null outside git). */
function useGitState(cwd: string | null, busy: boolean, readOnly: boolean): PaletteGit | null {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [git, setGit] = useState<PaletteGit | null>(null);
  useEffect(() => {
    setGit(null);
    if (!client || !cwd) return;
    let cancelled = false;
    Promise.all([
      client.call('worktree.status', { cwd }),
      client.call('git.changes', { cwd, base: 'uncommitted' }),
      client.call('git.github', { cwd }).catch(() => null),
      // gh's list is cached in the engine, so this is quick after the first time.
      client.call('git.prFor', { cwd }).catch(() => ({ pr: null })),
      // A recent read is reused, so this is quick while the git button shows them.
      client.call('git.prChecks', { cwd }).catch(() => ({ checks: null })),
    ]).then(
      ([status, changes, github, { pr }, { checks }]) => {
        if (cancelled) return;
        const plan = planGit(status, busy, readOnly);
        setGit({
          changed: changes.files.length,
          unstaged: changes.files.filter((file) => !file.staged).length,
          hasRemote: status.hasRemote,
          prBlocked: plan.blocked.pr,
          github: github !== null,
          pr: pr?.state === 'open' ? { number: pr.number, url: pr.url } : null,
          pullable: plan.blocked.pull === null,
          failingChecks: checks?.checks.filter((check) => check.bucket === 'fail').length ?? 0,
        });
      },
      () => !cancelled && setGit(null),
    );
    return () => {
      cancelled = true;
    };
  }, [client, cwd, busy, readOnly]);
  return git;
}

/** Where you are, from the stores: what every command's `when()` reads. */
const WAYS: readonly Way[] = ['left', 'right', 'up', 'down'];

export function usePaletteContext(): PaletteContext {
  const connection = useEngineConnection();
  const connected = connection.status === 'connected';
  const mainView = useSessions((s) => s.view);
  const selectedId = useSessions((s) => s.selectedId);
  const sessions = useSessions((s) => s.sessions);
  const live = useSessions((s) => s.live);
  const layout = useSessions((s) => s.layout);
  const paneCount = useSessions((s) => s.paneIds.length);
  const settingsSection = useSessions((s) => s.settingsSection);
  const hosts = useHosts((s) => s.hosts);
  const permissions = useHosts((s) => s.permissions);
  const models = useHosts((s) => s.models);
  const projects = useProjects((s) => s.projects);
  const projectFilter = useProjects((s) => s.filter);
  const questionsDir = useProjects((s) => s.questionsDir);
  const cloneEnabled = useCloneEnabled();
  const prefs = usePreferences((s) => s.prefs);
  const themes = useThemes((s) => s.themes);
  const activeTheme = useThemes((s) => s.active.entry.id);
  const queue = useQueue();
  const scheduleCount = useSchedules((s) => s.schedules.length);
  const unsent = useUnsent().length;
  const digest = usePaletteBus((s) => s.digest);
  const newSessionInfo = usePaletteBus((s) => s.newSessionInfo);
  const openFor = useTerminals((s) => s.openFor);
  const maximizedFor = useTerminals((s) => s.maximizedFor);
  const dock = useTerminals((s) => s.dock);
  const terminals = useTerminals((s) => s.terminals);
  const activeTerminals = useTerminals((s) => s.active);
  const sidebar = useSidebar((s) => s.state);
  const boxes = useComposerTargets((s) => s.boxes);
  const editors = useHosts((s) => s.editors);
  const computers = useComputers((s) => s.status?.computers);

  const pageRoot = useProjectPage((s) => s.root);
  const view: PaletteView = mainView === 'new' ? 'new-session' : mainView === 'settings' ? 'settings' : mainView === 'projects' ? 'projects' : mainView === 'project' ? 'project' : mainView === 'usage' ? 'usage' : mainView === 'remote' ? 'home' : selectedId ? 'session' : 'home';
  // A session on another computer in the active pane has none of a local one's commands; the panes' commands stay.
  const id = view === 'session' ? localSessionId(selectedId) : null;

  const catchUps = useCatchUp((s) => s.cards);
  const collapsedCatchUps = useCatchUp((s) => s.collapsed);
  const session = useMemo<PaletteSession | null>(() => {
    if (!id) return null;
    const row = toRows(sessions, live, hosts).find((r) => r.id === id);
    const host = hosts.get(id);
    const active = isActiveHost(host) ? host : null;
    const summary = sessions.get(id) ?? null;
    const cwd = active?.cwd ?? summary?.cwd ?? live.get(id)?.cwd ?? null;
    const waitingOn = [...permissions.values()].filter((p) => p.sessionId === id);
    const ownDigest = digest?.sessionId === id ? digest : null;
    return {
      id,
      title: row?.title ?? 'New session',
      indexed: summary !== null,
      pinned: summary?.pinned ?? false,
      archived: row ? !isActive(row, Date.now(), prefs.archiveAfterDays) : false,
      cwd,
      projectRoot: summary?.projectRoot ?? live.get(id)?.projectRoot ?? null,
      isWorktree: Boolean(summary?.worktree || (cwd && inWorktree(cwd))),
      host: active
        ? { state: active.state, contextTokens: active.contextTokens, supportsEffort: findModelOption(models, active.model)?.supportsEffort ?? true }
        : null,
      running: active?.state === 'running' || active?.state === 'needs-you',
      waiting: waitingOn.length === 0 ? null : waitingOn.some((p) => p.toolName === 'AskUserQuestion') ? 'question' : 'permission',
      catchUp: showOf({ card: catchUps.get(id) ?? null, enabled: prefs.catchUpSummaries, summary, host, live: live.get(id) ?? null, permissions: waitingOn, collapsed: collapsedCatchUps }),
      prompts: ownDigest?.prompts.length ?? 0,
      hasReply: !!ownDigest?.lastReply,
    };
  }, [id, sessions, live, hosts, permissions, models, digest, catchUps, collapsedCatchUps, prefs.catchUpSummaries]);

  // A quick question has no project (no actions, no "New session in …") and no git.
  const question = isQuestionsFolder(session?.projectRoot ?? session?.cwd, questionsDir);
  const git = useGitState(question ? null : (session?.cwd ?? null), session?.running ?? false, useReadOnlyFork(id));
  const projectRoot = question ? null : (session?.projectRoot ?? null);
  const { actions } = useProjectActionList(projectRoot);

  const added = useMemo(() => addedProjects(projects), [projects]);
  // The saved prompts of the message box on screen: its project's, else only the ones for every project.
  const composer = activeComposer(boxes, view === 'session' ? 'session' : view === 'new-session' ? 'new' : 'other', selectedId);
  const promptRoot = composer ? (view === 'new-session' ? draftRoot(composer.key) : projectRoot) : null;
  const { prompts: savedPrompts } = useSavedPrompts(promptRoot && !isQuestionsFolder(promptRoot, questionsDir) ? promptRoot : null);
  const currentRoot = view === 'project' && pageRoot ? pageRoot : projectRoot && isAbsolutePath(projectRoot) ? projectRoot : projectFilter;
  // ⌘J's panel: the session's, or outside a session the window's own, which starts in the project on screen.
  const owner = terminalOwner(view, id);
  const terminalCwd = owner === APP_TERMINAL ? appTerminalFolder(view, { projectRoot: pageRoot, newSessionCwd: activeComposer(boxes, 'new', null)?.cwd ?? null }) : (session?.cwd ?? null);
  const activeTerminal = owner ? (terminals.get(activeTerminals.get(owner) ?? '') ?? [...terminals.values()].filter((t) => t.sessionId === ownerSession(owner)).at(-1)) : undefined;

  return {
    popout: popoutSession !== null,
    view,
    connected,
    session,
    git: session?.cwd && !question ? git : null,
    terminal: {
      owner,
      cwd: terminalCwd,
      open: owner !== null && openFor.has(owner),
      maximized: owner !== null && maximizedFor.has(owner),
      dock,
      action: owner && activeTerminal?.kind === 'action' && activeTerminal.sessionId === ownerSession(owner) ? { running: activeTerminal.exitCode === null } : null,
    },
    split: paneCount > 1,
    splitDirection: paneCount > 1 && selectedId ? (parentSplit(layout, selectedId)?.split.direction ?? null) : null,
    paneWays: paneCount > 1 && selectedId ? WAYS.filter((way) => neighbour(layout, selectedId, way) !== null) : [],
    focusLimit: prefs.focusLimit,
    notifications: prefs.notifications.enabled,
    sounds: prefs.sounds.enabled,
    queue: { count: queue.entries.length, readyCount: queue.readyCount, firstReady: queue.firstReady ? { id: queue.firstReady.item.id, prompt: promptLabel(queue.firstReady.item.prompt, 40) } : null },
    schedules: scheduleCount,
    unsent,
    projectCount: added.length,
    projects: added.map((p) => ({ root: p.root, name: p.name })),
    currentProject: currentRoot ? { root: currentRoot, name: projects.get(currentRoot)?.name ?? basename(currentRoot) } : null,
    actions: actions.map((a) => ({ id: a.id, name: a.name, shortcut: a.shortcut ?? null, icon: a.icon })),
    canEditActions: !!projectRoot && isAbsolutePath(projectRoot),
    colorScheme: prefs.colorScheme,
    themes: themes.map((t) => ({ id: t.id, name: t.file.name })),
    themeId: activeTheme,
    sidebarStyle: prefs.sidebarStyle,
    sidebar,
    settingsSection,
    newSession: view === 'new-session' ? newSessionInfo : null,
    questionsDir,
    composer,
    prompts: composer ? savedPrompts.map((p) => ({ id: p.id, name: p.name, scope: p.scope })) : [],
    canContinueInVSCode: editors.some((e) => e.id === 'vscode'),
    cloneEnabled,
    computers: (computers ?? []).filter((c) => c.state === 'connected').map((c) => ({ id: c.id, name: c.name })),
  };
}
