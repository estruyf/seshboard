import { currentPlatform, thisComputerName } from '../../lib/platform.ts';

/** "this Mac" or "this PC", for the middle of a sentence. */
const thisComputer = (platform: string) => thisComputerName(platform).replace(/^T/, 't');

/** The Keep awake switch's label: "Keep this Mac awake", or "Keep this PC awake" on Windows and Linux. */
export function keepAwakeLabel(platform = currentPlatform()): string {
  return `Keep ${thisComputer(platform)} awake`;
}

/** The line under it (Settings shows it, and its search finds it). `caffeinate -s` only holds sleep off on power. */
export function keepAwakeDetail(platform = currentPlatform()): string {
  return platform === 'darwin'
    ? 'Stops sleep while Switchboard is open and on power. The display can still sleep.'
    : 'Stops sleep while Switchboard is open. The display can still sleep.';
}

/** The status line while sleep is held off: "Keeping this Mac awake". */
export function keepAwakeActive(platform = currentPlatform()): string {
  return `Keeping ${thisComputer(platform)} awake`;
}
