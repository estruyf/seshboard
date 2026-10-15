import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { safeStorage } from 'electron';

const FILE = 'remote-identity.bin';

/**
 * Remote's identity key (docs/remote-access.md): 32 random bytes, encrypted with the system's keychain
 * (`safeStorage`) in the app's data folder, so a copy of the folder is no use without this user's login. Made the
 * first time Remote is turned on. Null when the keychain can't be used: Remote then stays off.
 */
export function remoteIdentity(dataDir: string): string | null {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const file = join(dataDir, FILE);
  if (existsSync(file)) {
    try {
      const secret = safeStorage.decryptString(readFileSync(file));
      if (Buffer.from(secret, 'base64').length === 32) return secret;
    } catch {
      // Unreadable (another login's keychain, a damaged file): paired phones have to pair again with a new key.
    }
  }
  const secret = randomBytes(32).toString('base64');
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, safeStorage.encryptString(secret), { mode: 0o600 });
  renameSync(temporary, file);
  return secret;
}
