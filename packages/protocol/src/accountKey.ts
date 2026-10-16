import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * What tells a claude.ai account apart on every computer, without saying which it is: SHA-256 of its email (lower
 * case) and organization. Another computer's profiles signed in to the same account have the same key, so the Usage
 * view can count their tokens with this computer's while the account itself never leaves the computer. Null without
 * an account (not signed in, or an API key).
 */
export function accountKey(account: { email: string | null; organization: string | null } | null): string | null {
  const email = account?.email?.trim().toLowerCase();
  if (!email) return null;
  return bytesToHex(sha256(utf8ToBytes(`switchboard-account\n${email}\n${account?.organization?.trim() ?? ''}`)));
}
