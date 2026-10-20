import { currentPlatform } from '../../lib/platform.ts';

/** What the line under Open at login says, per platform (Settings shows it, and its search finds it). */
export function openAtLoginDetail(platform = currentPlatform()): string {
  const when = platform === 'darwin' ? 'log in to this Mac' : platform === 'win32' ? 'sign in to Windows' : 'log in';
  return `Switchboard opens when you ${when}, so it is running again after a restart.`;
}

/** Why Open at login is greyed out: Electron has no login items on Linux, and a development build would add Electron itself. */
export function openAtLoginUnavailable(platform = currentPlatform()): string {
  return platform === 'darwin' || platform === 'win32' ? 'Only in the installed app, not in a development build.' : 'Not available on Linux yet.';
}
