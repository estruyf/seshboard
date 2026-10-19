import { useEffect } from 'react';
import { NewSessionView } from './components/newSession/NewSessionView.tsx';
import { HomeView } from './components/home/HomeView.tsx';
import { TooltipLayer } from './components/ui/Tooltip.tsx';
import { ToastLayer } from './components/ui/Toast.tsx';
import { FocusGateDialog } from './components/focus/FocusGateDialog.tsx';
import { useSessionShortcuts } from './components/session/useSessionShortcuts.ts';
import { useOverlayShortcuts } from './components/palette/useOverlayShortcuts.ts';
import { otherModalOpen, overlayOpen } from './lib/modalGuards.ts';
import { LinkError } from './components/LinkError.tsx';
import { QuitPrompt } from './components/QuitPrompt.tsx';
import { ArchiveDraftDialog } from './components/drafts/ArchiveDraftDialog.tsx';
import { UnsentList } from './components/drafts/UnsentList.tsx';
import { useDraftsSync } from './state/useDraftsSync.ts';
import { useCompanionSync } from './state/useCompanionSync.ts';
import { AddContextDialogHost } from './components/composer/AddContextDialog.tsx';
import { CommandPalette } from './components/palette/CommandPalette.tsx';
import { PaletteDialogs } from './components/palette/PaletteDialogs.tsx';
import { ClaudeInstallDialog } from './components/updates/ClaudeInstallDialog.tsx';
import { SearchDialog } from './components/search/SearchDialog.tsx';
import { CloneProjectDialog } from './components/clone/CloneProjectDialog.tsx';
import { useClone, useCloneSync } from './state/cloneStore.ts';
import { AddProjectDialog } from './components/projects/AddProjectDialog.tsx';
import { BackupDialogs } from './components/backup/BackupDialogs.tsx';
import { ProjectManagerView } from './components/projects/ProjectManagerView.tsx';
import { ProjectPage } from './components/projects/ProjectPage.tsx';
import { useProjectPage } from './state/projectPageStore.ts';
import { useWorktreesSync } from './state/worktreesStore.ts';
import { SettingsView } from './components/SettingsView.tsx';
import { useUsageSync } from './components/UsageBand.tsx';
import { UsageView } from './components/usage/UsageView.tsx';
import { SessionHud } from './components/sidebar/SessionHud.tsx';
import { EngineStalledNotice } from './components/EngineStalledNotice.tsx';
import { SidebarShell } from './components/sidebar/SidebarShell.tsx';
import { SplitPanes } from './components/split/SplitPanes.tsx';
import { useReadyReport } from './engine/useReadyReport.ts';
import { useLaterSync } from './state/laterStore.ts';
import { useSchedulesSync } from './state/schedulesStore.ts';
import { useCatchUpSync } from './state/useCatchUpSync.ts';
import { useUpNextSync } from './state/upNextStore.ts';
import { useModsSync } from './state/useModsSync.ts';
import { useSavedPromptsSync } from './components/savedPrompts/savedPromptsStore.ts';
import { useLimitsSync } from './state/limitsStore.ts';
import { useAskSync } from './state/askStore.ts';
import { useSidebarSectionsSync } from './state/sidebarSectionsStore.ts';
import { useQueueToasts } from './state/useQueue.ts';
import { useLinksSync } from './state/linksStore.ts';
import { useNavHistorySync } from './state/navHistoryStore.ts';
import { useSessions, type MainView } from './state/sessionsStore.ts';
import { useOverlay } from './state/overlayStore.ts';
import { usePreferencesSync } from './state/preferencesStore.ts';
import { useThemesSync } from './state/themeStore.ts';
import { ThemeImportDialogs } from './components/theme/ThemeImport.tsx';
import { useProfilesSync } from './state/profilesStore.ts';
import { useProjects, useProjectsSync } from './state/projectsStore.ts';
import { goToAdjacentSession, goToNextNeedsYou } from './state/sessionNav.ts';
import { useSidebar, useSidebarSync } from './state/sidebarStore.ts';
import { useTerminalsSync } from './state/terminalsStore.ts';
import { AppTerminalFrame } from './components/terminal/AppTerminalFrame.tsx';
import { terminalOwner, type TerminalView } from './components/terminal/appTerminal.ts';
import { useUpdatesSync } from './state/updatesStore.ts';
import { useClaudeUpdateSync } from './state/claudeUpdateStore.ts';
import { useHostsSync } from './state/useHostsSync.ts';
import { useComputersSync } from './state/useComputersSync.ts';
import { useRemoteSync } from './state/useRemoteSync.ts';
import { RemoteView } from './components/computers/RemoteView.tsx';
import { localSessionId } from './state/remoteSelection.ts';
import { useSessionsSync } from './state/useSessionsSync.ts';
import { runMainRequest } from './state/mainRequests.ts';
import { usePopoutsSync } from './state/usePopoutsSync.ts';
import { useSessionViewHandoff } from './state/useSessionViewSync.ts';
import { matches, type ShortcutId } from './lib/shortcuts.ts';
import { ShortcutsSheet } from './components/shortcuts/ShortcutsSheet.tsx';
import { UpcomingView } from './components/upcoming/UpcomingView.tsx';
import { SelectionMenu } from './components/SelectionMenu.tsx';
import { openUpcoming } from './state/upcomingStore.ts';

/** What the main area shows, as the terminal sees it: Home is the session view without a session. */
function terminalView(view: MainView, sessionId: string | null): TerminalView {
  return view === 'new' ? 'new-session' : view === 'session' ? (sessionId ? 'session' : 'home') : view;
}

/**
 * The panel ⌘J and ⌘⇧J work on: the session's in the active pane, the window's own elsewhere (Settings too). None
 * for a session on another computer: its terminal is there.
 */
function currentTerminalOwner(): string | null {
  const { view, selectedId } = useSessions.getState();
  return terminalOwner(terminalView(view, selectedId), localSessionId(selectedId));
}

/** What each key of the panes does (keys in `lib/shortcuts.ts`). */
const PANE_KEYS: ReadonlyArray<readonly [ShortcutId, (sessions: ReturnType<typeof useSessions.getState>) => void]> = [
  ['pane.close', (s) => s.closePane()],
  ['pane.close-other', (s) => s.closeOtherPanes()],
  ['pane.focus-left', (s) => s.focusWay('left')],
  ['pane.focus-right', (s) => s.focusWay('right')],
  ['pane.focus-up', (s) => s.focusWay('up')],
  ['pane.focus-down', (s) => s.focusWay('down')],
  ['pane.swap', (s) => s.swapPanes()],
  ['pane.orientation', (s) => s.flipSplit()],
];

/**
 * The window's own shortcuts (keys in `lib/shortcuts.ts`): new session, go-to, search, Home, the sidebar, moving
 * between sessions and the panes (close, focus, swap, turn), plus the command palette and the shortcuts sheet and
 * the session's own (the terminal, open in editor, open in new window), which a pop-out has too. The terminal
 * passes ⌘ keys and ⌃⇥ on to the window (XTerm.tsx), so these work there too.
 */
function useShortcuts() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // ⌘B, ⌃⇥ and ⌘⇧U became Switchboard's after project actions could take them: an action saved on
      // one of them keeps it. These run once the key has been through every listener, and only if none
      // took it (the actions' listener may come before or after this one). They have no default to stop.
      const later = (run: () => void) => setTimeout(() => !event.defaultPrevented && run(), 0);
      if (matches(event, 'session.next') || matches(event, 'session.previous')) {
        if (!event.defaultPrevented && !overlayOpen()) later(() => goToAdjacentSession(matches(event, 'session.previous') ? -1 : 1));
      } else if (matches(event, 'session.next-needs-you')) {
        later(goToNextNeedsYou);
      } else if (matches(event, 'sidebar.toggle')) {
        later(() => useSidebar.getState().toggle());
      } else if (matches(event, 'home')) {
        event.preventDefault();
        useSessions.getState().goHome();
      } else if (matches(event, 'upcoming')) {
        event.preventDefault();
        openUpcoming();
      } else if (matches(event, 'search')) {
        if (otherModalOpen()) return;
        event.preventDefault();
        const overlay = useOverlay.getState();
        if (overlay.open === 'search') overlay.close();
        else overlay.show('search');
      } else if (matches(event, 'palette.goto')) {
        if (otherModalOpen()) return;
        event.preventDefault();
        useOverlay.getState().togglePalette('goto');
      } else if (PANE_KEYS.some(([id]) => matches(event, id))) {
        // The panes' keys work with more than one pane open, and in the session view (Settings sits over it, inert).
        const sessions = useSessions.getState();
        if (sessions.view !== 'session' || sessions.paneIds.length < 2) return;
        event.preventDefault();
        PANE_KEYS.find(([id]) => matches(event, id))![1](sessions);
      } else if (matches(event, 'session.new')) {
        event.preventDefault();
        // On a project's page, the new session starts in that project (its New session button says ⌘N).
        const { view } = useSessions.getState();
        const projectRoot = useProjectPage.getState().root;
        if (view === 'project' && projectRoot) useProjects.getState().startIn(projectRoot);
        useSessions.getState().openNewSession();
      } else if (matches(event, 'session.question')) {
        // New session with Quick question picked: no project, the scratch folder the engine keeps.
        const { questionsDir, startIn } = useProjects.getState();
        if (!questionsDir) return;
        event.preventDefault();
        startIn(questionsDir);
        useSessions.getState().openNewSession();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // The palette and the shortcuts sheet open in whichever window the key is pressed in (`useOverlayShortcuts`).
  useOverlayShortcuts();
  // The terminal, Open in editor and Open in new window: shared with the pop-out (`useSessionShortcuts`).
  useSessionShortcuts(() => {
    const { view, selectedId } = useSessions.getState();
    return { terminalOwner: currentTerminalOwner(), sessionId: view === 'session' ? localSessionId(selectedId) : null };
  });
}

/** Keeps main informed about what's on screen, and opens sessions main asks for (notification clicks). */
function useWindowFocus() {
  const view = useSessions((s) => s.view);
  const selectedId = useSessions((s) => s.selectedId);
  useEffect(() => {
    window.switchboard?.reportFocus(view === 'session' ? localSessionId(selectedId) : null);
  }, [view, selectedId]);
  useEffect(() => window.switchboard?.onSelectSession((id) => useSessions.getState().select(id)), []);
  // A pop-out has no Settings, Usage, project pages or New session: they open here, with the window in front.
  useEffect(() => window.switchboard?.onMainRequest(runMainRequest), []);
  // Switchboard → Settings… (⌘,) or Check for Updates… (About) in the menu bar.
  useEffect(() => window.switchboard?.onOpenSettings((section) => useSessions.getState().openSettings(section ?? undefined)), []);
  // An app-wide shortcut pressed in a pop-out: main brought this window to the front, and the keys run here.
  useEffect(
    () =>
      window.switchboard?.onKeysForwarded((keys) => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { ...keys, bubbles: true, cancelable: true }));
      }),
    [],
  );
}

export function App() {
  useSessionsSync();
  useHostsSync();
  useComputersSync();
  useRemoteSync();
  useProjectsSync();
  useCloneSync();
  useProfilesSync();
  useTerminalsSync();
  useUpdatesSync();
  useClaudeUpdateSync();
  useSidebarSync();
  useDraftsSync();
  usePopoutsSync();
  useSessionViewHandoff();
  useUsageSync();
  usePreferencesSync();
  useThemesSync();
  useLaterSync();
  useSchedulesSync();
  useCatchUpSync();
  useUpNextSync();
  useModsSync();
  useLimitsSync();
  useSavedPromptsSync();
  useAskSync();
  useQueueToasts();
  useSidebarSectionsSync();
  useCompanionSync();
  useWorktreesSync();
  useNavHistorySync();
  // Listen for links before telling main the window is ready: main hands over waiting links then.
  useLinksSync();
  useReadyReport();
  useShortcuts();
  useWindowFocus();
  const view = useSessions((s) => s.view);
  const settingsFrom = useSessions((s) => s.settingsFrom);
  const behind = view === 'settings' ? settingsFrom : view;
  const hasPanes = useSessions((s) => s.layout !== null);
  const selectedId = useSessions((s) => s.selectedId);
  // Settings covers the view it opened from, a session too: there the window's terminal is the one ⌘J shows.
  const shownView = view === 'settings' ? 'settings' : terminalView(behind, selectedId);
  const overlay = useOverlay((s) => s.open);
  const adding = useProjects((s) => s.adding);
  const cloning = useClone((s) => s.dialog);

  return (
    <div className="flex h-full">
      <SidebarShell />
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Outside a session, the window's own terminal (⌘J) docks below or beside the view, and Settings. */}
        <AppTerminalFrame view={shownView}>
        {/* Settings is a sheet over the view it opened from, which stays on screen (inert) behind it. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col" inert={view === 'settings'}>
        {behind === 'usage' ? (
          <UsageView />
        ) : behind === 'remote' ? (
          <RemoteView />
        ) : behind === 'projects' ? (
          <ProjectManagerView />
        ) : behind === 'project' ? (
          <ProjectPage />
        ) : behind === 'new' ? (
          <NewSessionView />
        ) : behind === 'upcoming' ? (
          <UpcomingView />
        ) : hasPanes ? (
          <SplitPanes />
        ) : (
          <HomeView />
        )}
        </div>
        {view === 'settings' && <SettingsView />}
        </AppTerminalFrame>
      </main>
      <QuitPrompt />
      <LinkError />
      {overlay === 'search' && <SearchDialog />}
      {overlay === 'palette' && <CommandPalette />}
      {overlay === 'shortcuts' && <ShortcutsSheet />}
      <SelectionMenu />
      <PaletteDialogs />
      <AddContextDialogHost />
      <UnsentList />
      <ArchiveDraftDialog />
      {adding && <AddProjectDialog onClose={() => useProjects.getState().showAdd(false)} />}
      {cloning && <CloneProjectDialog />}
      <BackupDialogs />
      <ThemeImportDialogs />
      <FocusGateDialog />
      <ClaudeInstallDialog />
      <SessionHud />
      <EngineStalledNotice />
      <ToastLayer />
      <TooltipLayer />
    </div>
  );
}
