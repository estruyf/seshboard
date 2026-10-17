import { parseRemoteLink, type RemoteLink } from '@switchboard/protocol/remote-client';

/** What the phone keeps after pairing with a computer (in IndexedDB, on this site only), one per computer. */
export interface Paired {
  /** The phone's device key: its secret half never leaves the phone. */
  deviceSecret: Uint8Array;
  enginePublicKey: Uint8Array;
  /** Where the computer is now (`https://…`); a connect link updates it. */
  address: string;
  deviceId: string;
  name: string;
  pairedAt: number;
  /** What the computer is called ("Elio's iMac"), from its last hello: the offline help names it. */
  computerName?: string;
}

/** A paired computer's id on this phone: its engine key in hex. It stays the same across addresses and pairings. */
export function computerId(paired: Pick<Paired, 'enginePublicKey'>): string {
  return Array.from(paired.enginePublicKey, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** What to do with the page's link and the computers the phone is paired with. */
export type Start =
  | { kind: 'welcome' }
  /** `again`: the phone is paired with that computer already, and pairing again replaces that pairing. */
  | { kind: 'pair'; link: Extract<RemoteLink, { kind: 'pair' }>; again: boolean }
  | { kind: 'connect'; paired: Paired }
  | { kind: 'other-computer' }
  | { kind: 'bad-link' };

const sameKey = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);

/**
 * Pure, so it is easy to check: a pairing link pairs (another computer is added; the same one is paired again), a
 * connect link moves the computer it is for to its new address and opens it, and no link opens `current`, the
 * computer the phone showed last.
 */
export function startFrom(hash: string, computers: readonly Paired[], current: Paired | null): Start {
  const fragment = hash.replace(/^#/, '');
  if (!fragment) return current ? { kind: 'connect', paired: current } : { kind: 'welcome' };
  const link = parseRemoteLink(fragment);
  if (!link) return current ? { kind: 'connect', paired: current } : { kind: 'bad-link' };
  if (link.kind === 'pair') return { kind: 'pair', link, again: computers.some((c) => sameKey(c.enginePublicKey, link.enginePublicKey)) };
  const known = computers.find((c) => sameKey(c.enginePublicKey, link.enginePublicKey));
  if (!known) return { kind: 'other-computer' };
  return { kind: 'connect', paired: { ...known, address: link.address } };
}

/** The computer to show: the one shown last, else the one paired last. */
export function currentComputer(computers: readonly Paired[], lastId: string | null): Paired | null {
  return computers.find((c) => computerId(c) === lastId) ?? [...computers].sort((a, b) => b.pairedAt - a.pairedAt)[0] ?? null;
}

/**
 * The link in what was pasted: a whole link (`https://…/remote/#p.…`), or only what follows its `#`. A Home Screen app
 * on an iPhone has no address bar and keeps its own pairing, apart from Safari's, so it pairs from a pasted link.
 */
export function pastedLink(text: string): string {
  const trimmed = text.trim();
  const hash = trimmed.indexOf('#');
  return hash >= 0 ? trimmed.slice(hash + 1) : trimmed;
}

/** Waits before trying to reconnect: quickly at first, then up to 30 seconds. */
export function reconnectDelay(attempt: number): number {
  return Math.min(30_000, 500 * 2 ** Math.max(0, attempt));
}
