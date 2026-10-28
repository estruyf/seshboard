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

/**
 * What the menu says next to another computer: how many of its sessions need you while it is connected, else its
 * state ("Offline", "Disconnected"). Nothing for a connected computer that waits on nothing.
 */
export function otherLine(state: ChipState, needsYou: number): string {
  if (state.kind === 'connected') return needsYou > 0 ? `${needsYou} ${needsYou === 1 ? 'needs' : 'need'} you` : '';
  if (state.kind === 'connecting' && state.attempt === 0) return 'Connecting…';
  return stateLine(state, 0);
}

/** The colour of a computer's dot: connected, trying again, given up or refused, or disconnected by you. */
export type StateTone = 'ok' | 'caution' | 'error' | 'faint';

/**
 * The drawer's computer row and Settings say how the computer is in a few words, with the dot's colour:
 * "Connected · encrypted", "Connecting…", "Reconnecting…", "Offline", "Disconnected", "Pair again". Settings leaves out
 * "encrypted" (`encrypted: false`): its line says when the computer was paired instead.
 */
export function computerRowLine(state: ChipState, { encrypted = true }: { encrypted?: boolean } = {}): { text: string; tone: StateTone } {
  switch (state.kind) {
    case 'connected':
      return { text: encrypted ? 'Connected · encrypted' : 'Connected', tone: 'ok' };
    case 'connecting':
      return { text: state.attempt === 0 ? 'Connecting…' : 'Reconnecting…', tone: 'caution' };
    case 'offline':
      return state.retryAt === null ? { text: 'Offline', tone: 'error' } : { text: 'Reconnecting…', tone: 'caution' };
    case 'disconnected':
      return { text: 'Disconnected', tone: 'faint' };
    case 'unpaired':
      return { text: 'Pair again', tone: 'error' };
  }
}

/** "paired today", "paired yesterday", "paired 3 days ago": when this phone was paired with a computer, in Settings. */
export function pairedAgo(pairedAt: number, now: number): string {
  const days = Math.floor(Math.max(0, now - pairedAt) / 86_400_000);
  if (days === 0) return 'paired today';
  if (days === 1) return 'paired yesterday';
  return `paired ${days} days ago`;
}
