import { channelOf, isMine, REMOTE_FEATURE_UPDATE, REMOTE_UPDATE_SINCE, remoteUpdateFor, UPDATE_ASK_MAX_AGE_MS, type Computer, type RemoteSession, type UpdateAsk } from '@seshboard/protocol/client';

/**
 * Updating Seshboard on another paired computer from Settings › Remote (docs/remote-access.md, Other computers): what
 * its row says about its version and its updater, which button it offers, and who works there. Always started by
 * hand: Update, ⋯ › Check for updates and ⋯ › Update to …. Pure, with tests.
 */

/** A check or an update asked from this window, until it is over; `error` when the ask itself was refused. */
export interface RowAsk extends UpdateAsk {
  error: string | null;
}

/** This Mac's own updater, as `remoteUpdateFor` reads it. */
export interface HereUpdate {
  version: string;
  availableVersion: string | null;
  channel: 'stable' | 'beta';
}

export type RowUpdateState = 'none' | 'old' | 'behind' | 'ahead' | 'checking' | 'up-to-date' | 'waiting' | 'downloading' | 'restarting' | 'updated' | 'not-found' | 'failed';

export interface RowUpdate {
  /** `data-computer-update-state`. */
  state: RowUpdateState;
  /** What follows the version on the status line; null for "paired …". */
  line: string | null;
  /** A quieter part after `line` ("involv hasn't seen it yet"). */
  aside: string | null;
  tone: 'link' | 'caution' | 'ok' | 'muted';
  /** A sentence under the status line. */
  detail: string | null;
  /** The row's button, next to the notifications. */
  button: { kind: 'update' | 'cancel' | 'retry' | 'update-here'; label: string; aria: string } | null;
  /** What ⋯ › Update to … installs, whenever a newer version is known; null when there is none. */
  offer: string | null;
  /** The computer restarts to update: a grey dot, and the line in place of its state and version. */
  restarting: boolean;
  /** Why ⋯ can't update it from here (an older version), as a note. */
  note: string | null;
}

const row = (state: RowUpdateState, rest: Partial<RowUpdate> = {}): RowUpdate => ({ state, line: null, aside: null, tone: 'muted', detail: null, button: null, offer: null, restarting: false, note: null, ...rest });

/** Whether a computer takes updates from here (`REMOTE_FEATURE_UPDATE`); an older one doesn't. */
export const updatesFromHere = (computer: Pick<Computer, 'features'>): boolean => computer.features.includes(REMOTE_FEATURE_UPDATE);

/**
 * What a computer's row says about updating it. `ask` is what this window asked it (Check for updates, or Update);
 * `updatedTo` the version it updated to from here in this app session.
 */
export function rowUpdate({ computer, here, ask, updatedTo, now }: { computer: Pick<Computer, 'name' | 'state' | 'version' | 'features' | 'update' | 'address'>; here: HereUpdate | null; ask: RowAsk | null; updatedTo: string | null; now: number }): RowUpdate {
  const name = computer.name;
  const fresh = ask && now - ask.at <= UPDATE_ASK_MAX_AGE_MS ? ask : null;
  const installing = fresh?.kind === 'install' && !fresh.error ? fresh : null;
  // A quick tunnel comes back at another address, which this computer can't learn by itself.
  const reconnect = quickTunnel(computer.address) ? `${name} gets a new address when it restarts. Copy the link from Reconnect a paired device in Settings › Remote there, and paste it below.` : null;
  // Restarting: the connection went with it, until it is back.
  if (installing && computer.state !== 'connected') return row('restarting', { line: `Updating${installing.version ? ` to ${installing.version}` : ''}, restarting…`, restarting: true, detail: reconnect });
  if (computer.state !== 'connected') return row('none');
  if (!updatesFromHere(computer)) return row('old', { note: `Update it on that computer (needs ${REMOTE_UPDATE_SINCE} or later to update from here).` });

  const update = computer.update;
  const known = here ? remoteUpdateFor(computer, here) : { kind: 'none' as const };
  const offer = known.kind === 'behind' ? known.version : null;
  const updateButton = (version: string) => ({ kind: 'update' as const, label: 'Update', aria: `Update ${name} to ${version}` });
  const retry = { kind: 'retry' as const, label: 'Try again', aria: `Try updating ${name} again` };

  if (updatedTo && computer.version === updatedTo) return row('updated', { line: 'Updated', tone: 'ok', offer });
  if (fresh?.error) return row('failed', { line: 'Couldn’t update from here', tone: 'caution', detail: `${fresh.error}. Update it on that computer.`, button: retry, offer });

  // What goes on there now, whoever started it.
  if (update?.whenIdle) {
    const version = installing?.version ?? update.availableVersion ?? offer;
    return row('waiting', { line: `updates${version ? ` to ${version}` : ''} when idle`, tone: 'link', button: { kind: 'cancel', label: 'Cancel update', aria: `Cancel the update of ${name}` }, offer });
  }
  if (update?.status === 'downloading') return row('downloading', { line: `Downloading${update.availableVersion ? ` ${update.availableVersion}` : ''}… ${update.downloadPercent ?? 0}%`, tone: 'link', offer });
  if (update?.status === 'installing' || (installing && update?.status === 'downloaded')) {
    const version = update.downloadedVersion ?? update.availableVersion;
    return row('restarting', { line: `Updating${version ? ` to ${version}` : ''}, restarting…`, restarting: true, detail: reconnect });
  }
  if (update?.status === 'checking' && fresh) return row('checking', { line: 'Checking for updates…', offer });

  // How what this window asked went.
  const checkedSince = fresh && update && update.checkedAt !== null && update.checkedAt >= fresh.at;
  if (fresh && update?.status === 'error') {
    return row('failed', { line: fresh.kind === 'check' ? 'Couldn’t check for updates' : 'Couldn’t update from here', tone: 'caution', detail: `${update.error ?? 'It didn’t say why'}. Update it on that computer.`, button: retry, offer });
  }
  if (fresh && checkedSince && update?.status === 'up-to-date') {
    const wanted = fresh.version ?? offer;
    if (!wanted) return row('up-to-date', { line: 'Up to date', tone: 'link' });
    const reason = channelOf(wanted) === 'beta' && update.channel === 'stable' ? `${name} gets Stable releases, and ${wanted} is a Beta. Change its channel there, or wait for Stable.` : null;
    return row('not-found', { line: `${name} didn’t find ${wanted}`, tone: 'caution', detail: reason, button: retry, offer });
  }
  if (installing && !update?.disabledReason) return row('checking', { line: 'Checking for updates…', offer });

  if (known.kind === 'behind') {
    if (update?.status === 'disabled') return row('failed', { line: 'Couldn’t update from here', tone: 'caution', detail: `${update.disabledReason ?? 'Updates are turned off there'}. Update it on that computer.`, offer: null });
    if (known.source === 'there') return row('behind', { line: `${known.version} available`, tone: 'link', button: updateButton(known.version), offer });
    return row('behind', { line: `${known.version} is out`, aside: `${name} hasn’t seen it yet`, tone: 'link', detail: `This Mac knows about ${known.version}. Update makes ${name} check now, then installs it.`, button: updateButton(known.version), offer });
  }
  if (known.kind === 'ahead') return row('ahead', { line: 'newer than this Mac', tone: 'link', button: { kind: 'update-here', label: 'Update this Mac', aria: 'Update this Mac' } });
  return row('none');
}

/**
 * Asked before Update with sessions working there: how many, and how many of them are other people's (not `isMine`),
 * for the panel's first line. Null when nothing works there: it updates at once.
 */
export function workingThere(computer: Pick<Computer, 'name' | 'mineHere'>, sessions: readonly Pick<RemoteSession, 'id' | 'status' | 'parentId'>[]): string | null {
  const working = sessions.filter((s) => s.status === 'working' || s.status === 'needs-you' || s.status === 'background');
  if (!working.length) return null;
  const others = working.filter((s) => !isMine(s.id, s.parentId, computer)).length;
  const count = working.length === 1 ? '1 session is' : `${working.length} sessions are`;
  const whose = !others ? '' : others === working.length ? (working.length === 1 ? ', from someone else' : ', all from other people') : `, ${others} of them from other people`;
  return `${count} working on ${computer.name}${whose}.`;
}

/** A Cloudflare quick tunnel gets a new address each time it starts, so the restart leaves this computer at the old one. */
export const quickTunnel = (address: string): boolean => {
  try {
    return new URL(address).hostname.endsWith('.trycloudflare.com');
  } catch {
    return false;
  }
};
