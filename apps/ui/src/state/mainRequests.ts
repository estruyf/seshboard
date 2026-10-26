import type { MainWindowRequest } from '@seshboard/protocol/bridge';
import { otherModalOpen } from '../lib/modalGuards.ts';
import { useOverlay } from './overlayStore.ts';
import { openUsage } from './usageViewStore.ts';
import { openUpcoming } from './upcomingStore.ts';
import { PROJECT_TABS, openProject, type ProjectTab } from './projectPageStore.ts';
import { useProjects } from './projectsStore.ts';
import { goToAdjacentSession, goToNextNeedsYou } from './sessionNav.ts';
import { useSessions, type SettingsSection } from './sessionsStore.ts';

/**
 * Shows what a pop-out asked the main window for (`showInMain`): a pop-out has no Settings, Usage, project pages,
 * New session, Go to or Search, nor a sidebar to step through. Main has already brought the window to the front.
 */
export function runMainRequest(request: MainWindowRequest): void {
  switch (request.kind) {
    case 'settings':
      useSessions.getState().openSettings((request.section as SettingsSection | null) ?? undefined);
      return;
    case 'usage':
      openUsage(request.profileId);
      return;
    case 'project':
      openProject(request.root, PROJECT_TABS.find((tab) => tab === request.tab) as ProjectTab | undefined);
      return;
    case 'new-session':
      if (request.cwd) useProjects.getState().startIn(request.cwd, { worktree: request.worktree });
      useSessions.getState().setView('new');
      return;
    case 'go-to': {
      // Opens Go to, never closes it, and waits behind another dialog as the shortcut does.
      const overlay = useOverlay.getState();
      if (otherModalOpen() || (overlay.open === 'palette' && overlay.palette.mode === 'goto')) return;
      overlay.togglePalette('goto');
      return;
    }
    case 'search':
      if (otherModalOpen()) return;
      if (request.memory) useOverlay.getState().searchMemory();
      else useOverlay.getState().show('search');
      return;
    case 'upcoming':
      openUpcoming({ kind: request.filter ?? undefined, scheduleId: request.scheduleId });
      return;
    case 'navigate':
      if (request.to === 'needs-you') goToNextNeedsYou();
      else goToAdjacentSession(request.to === 'previous' ? -1 : 1);
      return;
  }
}
