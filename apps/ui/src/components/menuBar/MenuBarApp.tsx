import { useReadyReport } from '../../engine/useReadyReport.ts';
import { useLimitsSync } from '../../state/limitsStore.ts';
import { usePreferencesSync } from '../../state/preferencesStore.ts';
import { useProfilesSync } from '../../state/profilesStore.ts';
import { useProjectsSync } from '../../state/projectsStore.ts';
import { useThemesSync } from '../../state/themeStore.ts';
import { useCatchUpSync } from '../../state/useCatchUpSync.ts';
import { useHostsSync } from '../../state/useHostsSync.ts';
import { useSessionsSync } from '../../state/useSessionsSync.ts';
import { RepoTrustDialog } from '../clone/CloneTrustDialog.tsx';
import { FocusGateDialog } from '../focus/FocusGateDialog.tsx';
import { ToastLayer } from '../ui/Toast.tsx';
import { TooltipLayer } from '../ui/Tooltip.tsx';
import { useUsageSync } from '../UsageBand.tsx';
import { MenuBarPanel } from './MenuBarPanel.tsx';

/**
 * The menu bar's panel window (`?menubar=1`): the sessions, prompts, catch-ups, projects, profiles and usage it shows,
 * kept in step with the engine as the main window's are, and only the panel. Like a pop-out it saves nothing of the
 * main window's and does none of its app-wide work (`secondaryWindow`). Starting work can ask the focus limit's
 * question or whether to trust a cloned repository, so those dialogs are here too.
 */
export function MenuBarApp() {
  useSessionsSync();
  useHostsSync();
  useProjectsSync();
  useProfilesSync();
  useUsageSync();
  usePreferencesSync();
  useThemesSync();
  useCatchUpSync();
  useLimitsSync();
  useReadyReport();
  return (
    <>
      <MenuBarPanel />
      <FocusGateDialog />
      <RepoTrustDialog />
      <ToastLayer />
      <TooltipLayer />
    </>
  );
}
