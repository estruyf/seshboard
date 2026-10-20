import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeStorage } from 'electron';

/** Remote's keys: this computer's identity, which phones check, and its device key for other computers. */
export type RemoteKey = 'identity' | 'device';
const FILES: Record<RemoteKey, string> = { identity: 'remote-identity.bin', device: 'remote-device.bin' };

/**
 * One of Remote's keys (docs/remote-access.md): 32 random bytes, encrypted with the system's keychain (`safeStorage`)
 * in the app's data folder, so a copy of the folder is no use without this user's login. The identity is made the
 * first time Remote is turned on, the device key the first time this app pairs with another computer. Null when the
 * keychain can't be used: Remote then stays off, and pairing with another computer says why.
 */
/**
 * Keys for a scripted run (the smoke test, the screenshots, a driven app): made in memory for the run, never in the
 * keychain. Those runs use a throwaway profile, and some point HOME at a made-up folder, where macOS has no login
 * keychain and would ask to make one.
 */
const throwawayKeys = new Map<RemoteKey, string>();
export function throwawayRemoteKey(key: RemoteKey): string {
  let secret = throwawayKeys.get(key);
  if (!secret) throwawayKeys.set(key, (secret = randomBytes(32).toString('base64')));
  return secret;
}

export function remoteIdentity(dataDir: string, key: RemoteKey = 'identity'): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const file = join(dataDir, FILES[key]);
  if (existsSync(file)) {
    try {
      const secret = safeStorage.decryptString(readFileSync(file));
      if (Buffer.from(secret, 'base64').length === 32) return secret;
    } catch {
      // Unreadable (another login's keychain, a damaged file): paired phones (or computers) have to pair again with a new key.
    }
  }
  const secret = randomBytes(32).toString('base64');
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, safeStorage.encryptString(secret), { mode: 0o600 });
  renameSync(temporary, file);
  return secret;
}
