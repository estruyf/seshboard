import { useSessions } from '../../state/sessionsStore.ts';
import { jumpToSetting } from '../settingsSearch/SettingsSearch.tsx';
import { settingsIndex } from '../settingsSearch/settingsIndex.ts';

/**
 * Settings › Browser, scrolled to Browser profiles (the button under the Browser's tabs and the profile menus): the
 * same jump as picking it in Settings' search, so the index says once where the section is.
 */
export function openBrowserProfiles(): void {
  useSessions.getState().openSettings('browser');
  const entry = settingsIndex().find((e) => e.id === 'browser-profiles');
  if (entry) jumpToSetting(entry);
}
