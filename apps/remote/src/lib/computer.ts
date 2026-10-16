/**
 * What the computer chip's menu says about the connection. Pure, with tests.
 */

/** "under a minute", "12m", "2h", "3d": how long the connection has been up. */
export function upFor(since: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - since) / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export type ChipState = { kind: 'connected'; since: number } | { kind: 'connecting'; attempt: number } | { kind: 'offline'; retryAt: number | null } | { kind: 'disconnected' } | { kind: 'unpaired' };

/** The line under the computer's name: "Connected for 2h · encrypted", "Reconnecting…", "Offline", "Disconnected". */
export function stateLine(state: ChipState, now: number): string {
  switch (state.kind) {
    case 'connected':
      return `Connected for ${upFor(state.since, now)} · encrypted`;
    case 'connecting':
      return state.attempt === 0 ? 'Connecting…' : 'Reconnecting…';
    case 'offline':
      return state.retryAt === null ? 'Offline' : 'Reconnecting…';
    case 'disconnected':
      return 'Disconnected';
    case 'unpaired':
      return 'Pair again';
  }
}
