import type { OpenAtLogin } from '@seshboard/protocol/bridge';

/** What `app.getLoginItemSettings()` answers that matters here. `status` is only there on macOS 13 and later. */
export interface LoginItemReading {
  openAtLogin: boolean;
  status?: string;
  executableWillLaunchAtLogin?: boolean;
}

/**
 * How Open at login stands, from the system's login item settings. On Windows the app can be listed and still be
 * turned off in Task Manager or Startup apps, so it only counts as on when it will really launch. On macOS 13 and
 * later the status says whether it waits for approval in System Settings.
 */
export function openAtLoginFrom(reading: LoginItemReading, platform: string): OpenAtLogin {
  if (platform === 'win32') return reading.openAtLogin && reading.executableWillLaunchAtLogin !== false ? 'on' : 'off';
  if (reading.status === 'requires-approval') return 'needs-approval';
  if (reading.status) return reading.status === 'enabled' ? 'on' : 'off';
  return reading.openAtLogin ? 'on' : 'off';
}

/** Where the system lists the apps that open at login, or null where there is no such page. */
export function loginItemsSettingsUrl(platform: string): string | null {
  if (platform === 'darwin') return 'x-apple.systempreferences:com.apple.LoginItems-Settings.extension';
  if (platform === 'win32') return 'ms-settings:startupapps';
  return null;
}
