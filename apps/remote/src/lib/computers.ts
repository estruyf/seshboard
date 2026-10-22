import { checkRemoteSessions, REMOTE_FEATURE_THEME, unreadableLine, type RemoteSessions, type RemoteTheme } from '@switchboard/protocol/remote-client';
import { Connection, type ConnectionState, type Dial } from './connection.ts';
import { computerId, type Paired } from './link.ts';
import type { PushComputers, PushTarget } from './push.ts';
import { cleanTheme } from './theme.ts';
import { cacheTheme, cachedTheme } from './themeApply.ts';

/** One paired computer: its pairing, its connection, its last list of sessions and its last theme. */
export interface Computer {
  id: string;
  paired: Paired;
  connection: Connection;
  state: ConnectionState;
  sessions: RemoteSessions;
  /** The theme in use there (`REMOTE_FEATURE_THEME`), kept on the phone; null until it sent one. */
  theme: RemoteTheme | null;
  /** What its last session list had that this app can't read (`unreadableLine`), for a banner; null when all was fine. */
  problem: string | null;
}

const EMPTY: RemoteSessions = { sessions: [], prompts: [] };

/** The computer's name, from its hello, else from its last one. */
export const nameOf = (computer: Pick<Computer, 'state' | 'paired'>): string => (computer.state.kind === 'connected' && computer.state.computerName) || computer.paired.computerName || '';

/** How many of a computer's sessions wait on you. */
export const needsYouOf = (computer: Pick<Computer, 'sessions'>): number => computer.sessions.sessions.filter((s) => s.status === 'needs-you').length;

/**
 * Every paired computer, connected at once: each has its own `Connection` (with its backoff), and its sessions are
 * listed and kept up to date while it is connected, so the menu can say which needs you and the phone can switch to
 * it at once. Only the one on screen watches a transcript; the others just keep their list.
 */
export class Computers {
  private entries = new Map<string, Computer>();
  /** What each connected computer's list needs undone when its connection goes. */
  private listing = new Map<string, () => void>();
  private snapshot: readonly Computer[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly options: {
      /** Once a computer is connected (each time it connects again too). */
      onConnected?: (computer: Computer) => void;
      /** A computer has something new to keep: its name, from its hello. */
      onPaired?: (paired: Paired) => void;
      dial?: Dial;
    } = {},
  ) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The computers in the order they were paired. A new array only when something changed (for React). */
  readonly list = (): readonly Computer[] => this.snapshot;

  get(id: string): Computer | undefined {
    return this.entries.get(id);
  }

  /** The computer a push was for: each computer gave this phone its own device id. */
  byDevice(deviceId: string): Computer | undefined {
    return [...this.entries.values()].find((c) => c.paired.deviceId === deviceId);
  }

  /**
   * Connects to the computers paired now: a new one starts connecting, a forgotten one is closed. Another pairing or
   * address of a computer connects again; only its name changing doesn't.
   */
  sync(pairings: readonly Paired[]): void {
    const ids = new Set(pairings.map(computerId));
    for (const id of [...this.entries.keys()]) if (!ids.has(id)) this.remove(id);
    for (const paired of pairings) {
      const id = computerId(paired);
      const known = this.entries.get(id);
      if (known && known.paired.deviceId === paired.deviceId && known.paired.address === paired.address) {
        this.entries.set(id, { ...known, paired });
        continue;
      }
      if (known) this.remove(id);
      const connection = new Connection(paired, this.options.dial ? { dial: this.options.dial } : {});
      this.entries.set(id, { id, paired, connection, state: connection.current, sessions: cachedSessions(id), theme: cachedTheme(id), problem: null });
      connection.subscribe((state) => this.stateChanged(id, connection, state));
      connection.start({ disconnected: wasDisconnected(id) });
    }
    this.changed();
  }

  /** Closes every connection: the app is going away. `sync` connects again. */
  stop(): void {
    for (const id of [...this.entries.keys()]) this.remove(id);
    this.changed();
  }

  /**
   * A list as the computer sent it (`sessions.list`, `sessions.changed`, pull to refresh), checked first: another
   * version, or something that isn't Switchboard, may send one the views can't read. What can't be read is left
   * out, and the computer's `problem` says so; a list that can't be read at all keeps the last one.
   */
  setSessions(id: string, value: unknown): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const checked = checkRemoteSessions(value);
    const name = nameOf(entry);
    const problem = !checked ? unreadableLine(name, null) : checked.dropped ? unreadableLine(name, checked.dropped) : null;
    this.entries.set(id, { ...entry, ...(checked ? { sessions: checked.list } : {}), problem });
    if (checked) cacheSessions(id, checked.list);
    this.changed();
  }

  /** A theme from the computer: kept, and shown when it is the one Theme shows. */
  private setTheme(id: string, value: unknown): void {
    const entry = this.entries.get(id);
    const theme = cleanTheme(value);
    if (!entry || !theme || JSON.stringify(theme) === JSON.stringify(entry.theme)) return;
    this.entries.set(id, { ...entry, theme });
    cacheTheme(id, theme);
    this.changed();
  }

  /**
   * Sync now, in Theme: asks every connected computer for its theme again, in case a change didn't come through.
   * False when none of them could answer (none connected, or none with `REMOTE_FEATURE_THEME`).
   */
  async syncThemes(): Promise<boolean> {
    const asked = [...this.entries.values()].flatMap((entry) => {
      const { state } = entry;
      if (state.kind !== 'connected' || !state.features.includes(REMOTE_FEATURE_THEME)) return [];
      return [state.client.call('theme.get', {}).then(({ theme }) => (this.setTheme(entry.id, theme), true), () => false)];
    });
    return (await Promise.all(asked)).includes(true);
  }

  private remove(id: string): void {
    this.listing.get(id)?.();
    this.listing.delete(id);
    this.entries.get(id)?.connection.stop();
    this.entries.delete(id);
  }

  private stateChanged(id: string, connection: Connection, state: ConnectionState): void {
    const entry = this.entries.get(id);
    // A connection that was replaced or stopped reports in no more.
    if (!entry || entry.connection !== connection) return;
    this.listing.get(id)?.();
    this.listing.delete(id);
    // Connected again: it may have been updated since, and its next list says.
    const next = { ...entry, state, ...(state.kind === 'connected' ? { problem: null } : {}) };
    this.entries.set(id, next);
    if (state.kind === 'connected') {
      const { client } = state;
      const offs = [client.on('sessions.changed', (sessions) => this.setSessions(id, sessions))];
      if (state.features.includes(REMOTE_FEATURE_THEME)) {
        offs.push(client.on('theme.changed', (theme) => this.setTheme(id, theme)));
        void client.call('theme.get', {}).then(({ theme }) => this.setTheme(id, theme), () => {});
      }
      this.listing.set(id, () => offs.forEach((off) => off()));
      void client.call('sessions.list', {}).then((sessions) => this.setSessions(id, sessions), () => {});
      if (state.computerName && state.computerName !== entry.paired.computerName) {
        const paired = { ...entry.paired, computerName: state.computerName };
        this.entries.set(id, { ...next, paired });
        this.options.onPaired?.(paired);
      }
      this.options.onConnected?.(this.entries.get(id)!);
    }
    this.changed();
  }

  private changed(): void {
    this.snapshot = [...this.entries.values()];
    for (const listener of this.listeners) listener();
  }
}

/** Disconnect, per computer and for this tab: a reload stays disconnected, a new launch connects again. */
const DISCONNECTED = 'switchboard-remote:disconnected';

export function wasDisconnected(id: string): boolean {
  try {
    return sessionStorage.getItem(`${DISCONNECTED}:${id}`) === '1';
  } catch {
    return false;
  }
}

export function keepDisconnected(id: string, on: boolean): void {
  try {
    if (on) sessionStorage.setItem(`${DISCONNECTED}:${id}`, '1');
    else sessionStorage.removeItem(`${DISCONNECTED}:${id}`);
  } catch {
    // Storage is off: a reload connects again.
  }
}

/** Each computer's last list, for this tab: shown greyed out while offline, also after a reload. */
const CACHE = 'switchboard-remote:sessions';

function cachedSessions(id: string): RemoteSessions {
  try {
    const checked = checkRemoteSessions(JSON.parse(sessionStorage.getItem(`${CACHE}:${id}`) ?? 'null'));
    if (checked) return checked.list;
  } catch {
    // Nothing kept, or storage is off.
  }
  return EMPTY;
}

function cacheSessions(id: string, sessions: RemoteSessions): void {
  try {
    sessionStorage.setItem(`${CACHE}:${id}`, JSON.stringify(sessions));
  } catch {
    // Storage is full or off: the list just isn't kept.
  }
}

/** The connected computers as push targets, and how many there are in all. */
export function pushComputers(computers: readonly Computer[]): PushComputers {
  return { targets: computers.map(pushTarget).filter((t): t is PushTarget => t !== null), paired: computers.length };
}

export function pushTarget(computer: Computer): PushTarget | null {
  return computer.state.kind === 'connected' ? { client: computer.state.client, features: computer.state.features, name: nameOf(computer) } : null;
}
