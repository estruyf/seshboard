/**
 * The notice for people whose data comes from Switchboard, the app's name before 1.2.0: what they may have to do
 * once after the update. Pure, so each platform's words are tested.
 */

/** Where the window remembers that the notice was dismissed (the data folder's own storage). */
export const RENAME_NOTICE_KEY = 'seshboard.renameNotice.dismissed';

/** What the old app's shortcut was, and how to put Seshboard back there, on each platform. */
function shortcutLine(platform: string): string {
  if (platform === 'darwin') return 'If the Dock says Switchboard is no longer there, open Seshboard from Applications and keep it in the Dock.';
  if (platform === 'win32') return 'A taskbar or Start menu pin to Switchboard no longer opens it: pin Seshboard again.';
  return 'A favourite for Switchboard in your dock no longer opens it: add Seshboard again.';
}

/** The notice's title and sentence, or null when the data is new or it was dismissed. */
export function renameNotice(fromSwitchboard: boolean, dismissed: boolean, platform: string): { title: string; body: string } | null {
  if (!fromSwitchboard || dismissed) return null;
  return {
    title: 'Switchboard is now Seshboard',
    body: `Same app, new name. If you paired a phone or another computer, pair it again in Settings › Remote. ${shortcutLine(platform)}`,
  };
}
