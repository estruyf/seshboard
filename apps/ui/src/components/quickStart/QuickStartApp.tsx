import { useReadyReport } from '../../engine/useReadyReport.ts';
import { useLaterSync } from '../../state/laterStore.ts';
import { useLimitsSync } from '../../state/limitsStore.ts';
import { usePreferencesSync } from '../../state/preferencesStore.ts';
import { useProfilesSync } from '../../state/profilesStore.ts';
import { useProjectsSync } from '../../state/projectsStore.ts';
import { useSignInSync } from '../../state/signInStore.ts';
import { useThemesSync } from '../../state/themeStore.ts';
import { useHostsSync } from '../../state/useHostsSync.ts';
import { useSessionsSync } from '../../state/useSessionsSync.ts';
import { RepoTrustDialog } from '../clone/CloneTrustDialog.tsx';
import { FocusGateDialog } from '../focus/FocusGateDialog.tsx';
import { ToastLayer } from '../ui/Toast.tsx';
import { TooltipLayer } from '../ui/Tooltip.tsx';
import { QuickStartPanel } from './QuickStartPanel.tsx';

/**
 * The quick start panel's window (`?quickstart=1`), which the global shortcut shows over any app: the projects,
 * sessions, profiles, models and queue it needs, kept in step with the engine as the main window's are, and only the
 * panel. Like the menu bar's panel it saves nothing of the main window's (`secondaryWindow`). Starting can ask the
 * focus limit's question or whether to trust a cloned repository, so those dialogs are here too.
 */
export function QuickStartApp() {
  useSessionsSync();
  useHostsSync();
  useProjectsSync();
  useProfilesSync();
  usePreferencesSync();
  useThemesSync();
  useLimitsSync();
  useLaterSync();
  useSignInSync();
  useReadyReport();
  return (
    <>
      <QuickStartPanel />
      <FocusGateDialog />
      <RepoTrustDialog />
      <ToastLayer />
      <TooltipLayer />
    </>
  );
}
