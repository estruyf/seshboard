import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import { REMOTE_DEVICE_NAME_MAX } from '@seshboard/protocol';

/**
 * The name people know this computer by ("Elio's iMac"), for the phone's connection chip and its offline help. On
 * macOS that is the Sharing name, which `hostname` only has as a mangled `Elios-iMac.local`; elsewhere the host name.
 * At most `REMOTE_DEVICE_NAME_MAX` characters: pairing with another computer sends it as this device's name, which
 * that computer refuses when it is longer (a CI runner's host name is).
 */
export function computerName(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') {
    try {
      const name = execFileSync('/usr/sbin/scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 1_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (name) return name.slice(0, REMOTE_DEVICE_NAME_MAX).trim();
    } catch {
      // No Sharing name set: the host name below.
    }
  }
  return hostname().replace(/\.local$/i, '').slice(0, REMOTE_DEVICE_NAME_MAX).trim() || 'your computer';
}
