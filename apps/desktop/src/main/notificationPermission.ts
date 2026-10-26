import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { NotificationPermission } from '@seshboard/protocol/bridge';

// macOS 26 stopped updating com.apple.ncprefs, so on a newer Mac this answers `unknown` and the page shows a hint instead.
// To know for sure, a native addon could ask UNUserNotificationCenter.getNotificationSettings from inside the app.

/** macOS's "Allow notifications" switch for an app: a bit in its `flags` in the Notifications preferences. */
const ALLOW_NOTIFICATIONS = 2 ** 25;

/**
 * Whether macOS lets an app notify, from the `apps` array of `com.apple.ncprefs` as XML (`plutil -extract apps xml1`).
 * `unknown` when the app isn't listed yet (it hasn't asked) or the format is not the one expected.
 */
export function macPermissionFrom(xml: string, bundleId: string): NotificationPermission {
  // One app per dictionary one level into the array; its own keys sit one tab deeper (the sources list deeper still).
  for (const entry of xml.split(/\n\t<dict>/).slice(1)) {
    const id = /\n\t\t<key>bundle-id<\/key>\s*<string>([^<]*)<\/string>/.exec(entry)?.[1];
    if (id !== bundleId) continue;
    const flags = /\n\t\t<key>flags<\/key>\s*<integer>(\d+)<\/integer>/.exec(entry)?.[1];
    if (flags === undefined) return 'unknown';
    return Math.floor(Number(flags) / ALLOW_NOTIFICATIONS) % 2 === 1 ? 'allowed' : 'blocked';
  }
  return 'unknown';
}

/**
 * Whether Windows lets an app notify, from `reg query` of its own notification settings and of the switch for
 * every app. A value that is missing means it was never turned off.
 */
export function windowsPermissionFrom(app: string, everyApp: string): NotificationPermission {
  const off = (output: string, name: string) => new RegExp(`\\b${name}\\s+REG_DWORD\\s+0x0\\b`, 'i').test(output);
  return off(everyApp, 'ToastEnabled') || off(app, 'Enabled') ? 'blocked' : 'allowed';
}

const run = (command: string, args: string[]) =>
  new Promise<string>((resolve) => {
    // A key or file that isn't there fails the command: that says nothing was turned off.
    execFile(command, args, { timeout: 5_000, windowsHide: true }, (_error, stdout) => resolve(String(stdout ?? '')));
  });

/** The bundle id of the running app (Seshboard's, or Electron's in development), from its Info.plist. */
async function macBundleId(): Promise<string> {
  // …/Seshboard.app/Contents/MacOS/Seshboard → …/Seshboard.app/Contents/Info.plist
  const plist = join(dirname(dirname(process.execPath)), 'Info.plist');
  return (await run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist])).trim();
}

/**
 * Asks the system whether notifications are turned off for Seshboard. Read-only: it reads the system's
 * notification settings and never changes them. `appUserModelId` is the id Windows shows the notifications under.
 */
export async function notificationPermission(appUserModelId: string): Promise<NotificationPermission> {
  try {
    if (process.platform === 'darwin') {
      const bundleId = await macBundleId();
      if (!bundleId) return 'unknown';
      const xml = await run('/usr/bin/plutil', ['-extract', 'apps', 'xml1', '-o', '-', join(homedir(), 'Library/Preferences/com.apple.ncprefs.plist')]);
      return macPermissionFrom(xml, bundleId);
    }
    if (process.platform === 'win32') {
      const base = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion';
      const [app, everyApp] = await Promise.all([
        run('reg.exe', ['query', `${base}\\Notifications\\Settings\\${appUserModelId}`, '/v', 'Enabled']),
        run('reg.exe', ['query', `${base}\\PushNotifications`, '/v', 'ToastEnabled']),
      ]);
      return windowsPermissionFrom(app, everyApp);
    }
  } catch {
    // Can't tell: say nothing rather than a warning that may be wrong.
  }
  return 'unknown';
}

/** The system's notification settings: Seshboard's own page in System Settings, the Notifications page in Windows. */
export async function notificationSettingsUrl(): Promise<string | null> {
  if (process.platform === 'darwin') {
    const bundleId = await macBundleId().catch(() => '');
    return `x-apple.systempreferences:com.apple.preference.notifications${bundleId ? `?id=${encodeURIComponent(bundleId)}` : ''}`;
  }
  if (process.platform === 'win32') return 'ms-settings:notifications';
  return null;
}
