import { currentPlatform } from '../../lib/platform.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { Toggle } from '../ui/Toggle.tsx';
import { HIDE_DOCK_DETAIL, HIDE_DOCK_LABEL, KEEP_RUNNING_LABEL, keepRunningDetail, menuBarDetail, menuBarLabel } from './menuBarCopy.ts';

/**
 * Settings › General › Menu bar: the icon in the menu bar (the notification area on Windows), whether closing the
 * window keeps the app running, and (macOS) whether the Dock icon goes while no window is open. Main applies them.
 */
export function MenuBarSettings() {
  const prefs = usePreferences((s) => s.prefs);
  const update = usePreferences((s) => s.update);
  return (
    <>
      <Toggle label={menuBarLabel()} detail={menuBarDetail()} checked={prefs.menuBar} attr="data-menu-bar-setting" onChange={(menuBar) => update({ menuBar })} />
      <Toggle label={KEEP_RUNNING_LABEL} detail={keepRunningDetail()} checked={prefs.keepRunning} attr="data-keep-running" onChange={(keepRunning) => update({ keepRunning })} />
      {currentPlatform() === 'darwin' && <Toggle label={HIDE_DOCK_LABEL} detail={HIDE_DOCK_DETAIL} checked={prefs.hideDock} attr="data-hide-dock" onChange={(hideDock) => update({ hideDock })} />}
    </>
  );
}
