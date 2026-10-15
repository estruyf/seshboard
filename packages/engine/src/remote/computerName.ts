import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';

/**
 * The name people know this computer by ("Elio's iMac"), for the phone's connection chip and its offline help. On
 * macOS that is the Sharing name, which `hostname` only has as a mangled `Elios-iMac.local`; elsewhere the host name.
 */
export function computerName(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') {
    try {
      const name = execFileSync('/usr/sbin/scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 1_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (name) return name.slice(0, 100);
    } catch {
      // No Sharing name set: the host name below.
    }
  }
  return hostname().replace(/\.local$/i, '').slice(0, 100) || 'your computer';
}
