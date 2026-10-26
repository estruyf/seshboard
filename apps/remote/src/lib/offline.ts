/**
 * Why the phone can't reach the computer, and what to say about it. Pure, so the guesses are easy to check: a browser
 * tells a page almost nothing about a WebSocket that failed, so the reason comes from how it failed.
 */

/**
 * - `address`: a quick tunnel's address that no longer answers (it gets a new one each time it starts);
 * - `tunnel`: the address answers at once but nothing is behind it (Seshboard, Remote or the tunnel is off);
 * - `asleep`: nothing answers at all (the computer sleeps or is offline);
 * - `no-network`: this phone has no network;
 * - `unknown`: the connection dropped, or something else went wrong.
 */
export type OfflineReason = 'address' | 'tunnel' | 'asleep' | 'no-network' | 'unknown';

/** A socket refused faster than this was answered by something (DNS, the tunnel's edge); slower, nothing answered. */
export const FAST_FAILURE_MS = 3_000;
/** How long a socket may take to open before the phone gives up on that attempt. */
export const OPEN_TIMEOUT_MS = 10_000;
/** Tries before the phone stops reconnecting by itself (about a minute and a half); it tries again when it's back in front. */
export const MAX_ATTEMPTS = 8;

/** A Cloudflare quick tunnel's address, which changes each time it starts. */
export const isQuickTunnel = (address: string) => {
  try {
    return new URL(address).hostname.endsWith('.trycloudflare.com');
  } catch {
    return false;
  }
};

export function offlineReason({ online, address, failure }: { online: boolean; address: string; failure: { kind: 'timeout' } | { kind: 'refused'; elapsedMs: number } | { kind: 'dropped' } }): OfflineReason {
  if (!online) return 'no-network';
  if (failure.kind === 'timeout') return 'asleep';
  if (failure.kind === 'dropped') return 'unknown';
  if (failure.elapsedMs >= FAST_FAILURE_MS) return 'asleep';
  return isQuickTunnel(address) ? 'address' : 'tunnel';
}

/** The banner's line, short enough for one line in the sidebar: the why is in the Help sheet. */
export function offlineLine(reason: OfflineReason, computer: string): string {
  return reason === 'no-network' ? 'This phone is offline' : `Can't reach ${computer}`;
}

/** The Help sheet: what happened and what to do, in two or three short sentences. */
export function offlineHelp(reason: OfflineReason, computer: string, address: string): { title: string; text: string[] } {
  switch (reason) {
    case 'address':
      return {
        title: 'The tunnel address changed',
        text: [
          'Quick tunnels get a new address each time they start.',
          `Scan the QR code in Settings › Remote on ${computer} again, or use a named tunnel so the address stays the same.`,
        ],
      };
    case 'tunnel':
      return {
        title: `${computer} doesn't answer`,
        text: [`The address answers, but Seshboard doesn't.`, `Check that Seshboard is open on ${computer}, and that Settings › Remote shows the tunnel as running.`],
      };
    case 'asleep':
      return {
        title: `${computer} doesn't answer`,
        text: [`Nothing answers at ${hostOf(address)}.`, `${computer} may be asleep, offline, or Seshboard is closed. Wake it, or check its network.`],
      };
    case 'no-network':
      return { title: 'This phone is offline', text: ['Connect to Wi-Fi or mobile data. Seshboard Remote reconnects by itself.'] };
    case 'unknown':
      return { title: 'The connection dropped', text: [`Seshboard Remote tries again by itself. If it keeps failing, check that Seshboard is open on ${computer}.`] };
  }
}

function hostOf(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}
