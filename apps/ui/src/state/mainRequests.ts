import type { MainWindowRequest } from '@switchboard/protocol/bridge';
import { openUsage } from './usageViewStore.ts';
import { PROJECT_TABS, openProject, type ProjectTab } from './projectPageStore.ts';
import { useProjects } from './projectsStore.ts';
import { useSessions, type SettingsSection } from './sessionsStore.ts';

/**
 * Shows what a pop-out asked the main window for (`showInMain`): a pop-out has no Settings, Usage, project pages
 * or New session. Main has already brought the window to the front.
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
  }
}
