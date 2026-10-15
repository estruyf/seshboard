import { parseRemoteLink, type RemoteLink } from '@switchboard/protocol/remote-client';

/** What the phone keeps after pairing (in IndexedDB, on this site only). */
export interface Paired {
  /** The phone's device key: its secret half never leaves the phone. */
  deviceSecret: Uint8Array;
  enginePublicKey: Uint8Array;
  /** Where the computer is now (`https://…`); a connect link updates it. */
  address: string;
  deviceId: string;
  name: string;
  pairedAt: number;
}

/** What to do with the page's link and what the phone has kept. */
export type Start =
  | { kind: 'welcome' }
  | { kind: 'pair'; link: Extract<RemoteLink, { kind: 'pair' }>; replaces: boolean }
  | { kind: 'connect'; paired: Paired }
  | { kind: 'other-computer' }
  | { kind: 'bad-link' };

const sameKey = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);

/**
 * Pure, so it is easy to check: a pairing link pairs (replacing a pairing with another computer only after asking),
 * a connect link moves a paired phone to the computer's new address, and no link connects to what the phone has.
 */
export function startFrom(hash: string, paired: Paired | null): Start {
  const fragment = hash.replace(/^#/, '');
  if (!fragment) return paired ? { kind: 'connect', paired } : { kind: 'welcome' };
  const link = parseRemoteLink(fragment);
  if (!link) return paired ? { kind: 'connect', paired } : { kind: 'bad-link' };
  if (link.kind === 'pair') return { kind: 'pair', link, replaces: paired !== null && !sameKey(paired.enginePublicKey, link.enginePublicKey) };
  if (!paired || !sameKey(paired.enginePublicKey, link.enginePublicKey)) return { kind: 'other-computer' };
  return { kind: 'connect', paired: { ...paired, address: link.address } };
}

/** Waits before trying to reconnect: quickly at first, then up to 30 seconds. */
export function reconnectDelay(attempt: number): number {
  return Math.min(30_000, 500 * 2 ** Math.max(0, attempt));
}
