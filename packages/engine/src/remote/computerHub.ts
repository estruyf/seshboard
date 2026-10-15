import type { DatabaseSync } from 'node:sqlite';
import {
  keyPairFromSecret,
  parseRemoteLink,
  REMOTE_DESKTOP_ORIGIN,
  RpcError,
  type Computer,
  type ComputerEvent,
  type ComputerMethod,
  type ComputerPairing,
  type ComputersStatus,
  type KeyPair,
} from '@switchboard/protocol';
import { ComputerLink, dialWebSocket, LinkError, pairComputer, type Dial, type LinkFailure, type LinkState } from './computerLink.ts';
import { ComputerStore, type PairedComputer } from './computerStore.ts';
import { computerName } from './computerName.ts';
import { CLOSE } from './remoteServer.ts';

export interface ComputerHubOptions {
  db: DatabaseSync;
  /**
   * This app's device key, which main keeps in the system's keychain: one key for every computer it pairs with, as
   * an SSH key. Asked for only once a computer is paired or pairing starts; null when the keychain can't be used.
   */
  deviceKey(): Promise<Uint8Array | null>;
  /** What the other computer calls this one (tests pass their own). */
  computerName?: () => string;
  /** Opens sockets (tests pass their own); `ws` with `REMOTE_DESKTOP_ORIGIN` by default. */
  dial?: Dial;
  onStatus(status: ComputersStatus): void;
  onEvent(event: ComputerEvent): void;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  now?: () => number;
}

/**
 * Other computers: the computers this app paired with, as a phone pairs with them, and a connection to each
 * (docs/remote-access.md). The app's windows see their sessions through `call` and the events passed on.
 */
export class ComputerHub {
  private readonly store: ComputerStore;
  private readonly dial: Dial;
  private readonly links = new Map<string, { link: ComputerLink; state: LinkState; lastSeen: number | null }>();
  private pairing: ComputerPairing = null;
  private pairingAbort: AbortController | null = null;
  private device: KeyPair | null = null;
  private stopped = false;

  constructor(private readonly options: ComputerHubOptions) {
    this.store = new ComputerStore(options.db, options.now);
    this.dial = options.dial ?? dialWebSocket({ origin: REMOTE_DESKTOP_ORIGIN });
  }

  /** Connects to every paired computer. The keychain is only asked when there is one. */
  async start(): Promise<void> {
    const computers = this.store.list();
    if (!computers.length) return;
    const device = await this.deviceKey();
    if (!device || this.stopped) return;
    for (const computer of computers) this.connect(computer, device);
    this.changed();
  }

  stop(): void {
    this.stopped = true;
    this.pairingAbort?.abort();
    for (const { link } of this.links.values()) link.stop();
    this.links.clear();
  }

  status(): ComputersStatus {
    return { available: true, computers: this.store.list().map((computer) => this.view(computer)), pairing: this.pairing };
  }

  /**
   * A link copied from another computer: a pair link (Pair a phone, Copy link) starts pairing, which goes on after
   * this returns (`computers.changed` has the code, then the computer or why it failed); a connect link (Show the
   * address to paired phones) moves a paired computer to its new address.
   */
  async add(text: string): Promise<void> {
    const hash = text.indexOf('#');
    const link = parseRemoteLink(hash >= 0 ? text.slice(hash + 1) : text);
    if (!link) throw new RpcError('INVALID_LINK', 'That isn’t a link from Switchboard. On the other computer, click Pair a phone in Settings › Remote, then Copy link.');
    if (link.kind === 'connect') {
      const known = this.store.find(link.enginePublicKey);
      if (!known) throw new RpcError('NOT_PAIRED', 'This computer isn’t paired yet. Copy the link from Pair a phone on it instead.');
      this.store.setAddress(known.id, link.address);
      this.links.get(known.id)?.link.setAddress(link.address);
      this.changed();
      return;
    }
    const device = await this.deviceKey();
    if (!device) throw new RpcError('UNAVAILABLE', 'Switchboard can’t keep a key in this computer’s keychain, so it can’t pair with another computer.');
    this.pairingAbort?.abort();
    const abort = new AbortController();
    this.pairingAbort = abort;
    this.setPairing({ state: 'connecting', code: null, message: null });
    pairComputer({
      link,
      device,
      name: (this.options.computerName ?? computerName)(),
      dial: this.dial,
      signal: abort.signal,
      onCode: (code) => !abort.signal.aborted && this.setPairing({ state: 'waiting', code, message: null }),
    }).then(
      ({ deviceId }) => {
        if (abort.signal.aborted || this.stopped) return;
        this.pairingAbort = null;
        const computer = this.store.add({ name: new URL(link.address).hostname, enginePublicKey: link.enginePublicKey, address: link.address, deviceId });
        this.options.log('info', `Other computers: paired with ${link.address}`);
        this.links.get(computer.id)?.link.stop();
        this.links.delete(computer.id);
        this.pairing = null;
        this.connect(computer, device);
        this.changed();
      },
      (error: unknown) => {
        if (abort.signal.aborted || this.stopped) return;
        this.pairingAbort = null;
        this.setPairing({ state: 'failed', code: null, message: pairingMessage(error) });
      },
    );
  }

  /** Stops pairing, or clears what a failed one said. */
  cancelPairing(): void {
    this.pairingAbort?.abort();
    this.pairingAbort = null;
    if (this.pairing) this.setPairing(null);
  }

  /** Forgets a computer here. It keeps this one in its list until you revoke it there. */
  forget(id: string): void {
    this.links.get(id)?.link.stop();
    this.links.delete(id);
    if (this.store.remove(id)) this.changed();
  }

  retry(id: string): void {
    this.links.get(id)?.link.retryNow();
  }

  /** A request to a connected computer; it checks the params itself. */
  async call(id: string, method: ComputerMethod, params: unknown): Promise<unknown> {
    const entry = this.links.get(id);
    if (!entry) throw new RpcError('NOT_FOUND', 'This computer isn’t paired');
    return entry.link.call(method, params);
  }

  private async deviceKey(): Promise<KeyPair | null> {
    if (this.device) return this.device;
    const secret = await this.options.deviceKey();
    if (secret) this.device = keyPairFromSecret(secret);
    return this.device;
  }

  private connect(computer: PairedComputer, device: KeyPair): void {
    const entry: { link: ComputerLink; state: LinkState; lastSeen: number | null } = {
      state: { kind: 'connecting' },
      lastSeen: null,
      link: new ComputerLink({
        address: computer.address,
        enginePublicKey: computer.enginePublicKey,
        device,
        dial: this.dial,
        ...(this.options.now ? { now: this.options.now } : {}),
        onState: (state) => {
          // Leaving a connection: when it was last there, for "Last seen 2h ago" while it is away.
          if (entry.state.kind === 'connected' && state.kind !== 'connected') entry.lastSeen = (this.options.now ?? Date.now)();
          entry.state = state;
          if (state.kind === 'connected' && state.name && state.name !== this.store.find(computer.enginePublicKey)?.name) this.store.setName(computer.id, state.name);
          if (state.kind === 'unpaired') this.options.log('info', `Other computers: ${computer.address} no longer knows this computer`);
          this.changed();
        },
        onEvent: (name, payload) => this.options.onEvent({ computerId: computer.id, name, payload: payload as ComputerEvent['payload'] }),
      }),
    };
    this.links.set(computer.id, entry);
    entry.link.start();
  }

  private view(computer: PairedComputer): Computer {
    const entry = this.links.get(computer.id);
    const state = entry?.state ?? { kind: 'connecting' as const };
    const base = { id: computer.id, name: computer.name, address: computer.address, pairedAt: computer.pairedAt, lastSeen: entry?.lastSeen ?? null };
    switch (state.kind) {
      case 'connected':
        return { ...base, state: 'connected', message: null, retryAt: null, version: state.version, lastSeen: null };
      case 'connecting':
        return { ...base, state: 'connecting', message: null, retryAt: null, version: null };
      case 'offline':
        return { ...base, state: 'offline', message: offlineMessage(state.failure, computer.name), retryAt: state.retryAt, version: null };
      case 'unpaired':
        return { ...base, state: 'unpaired', message: `${computer.name} no longer knows this computer. Pair it again.`, retryAt: null, version: null };
    }
  }

  private setPairing(pairing: ComputerPairing): void {
    this.pairing = pairing;
    this.changed();
  }

  private changed(): void {
    if (!this.stopped) this.options.onStatus(this.status());
  }
}

/** Why a paired computer can't be reached, in a sentence that says what to do. */
export function offlineMessage(failure: LinkFailure, name: string): string {
  switch (failure.kind) {
    case 'timeout':
      return `${name} doesn’t answer. It may be asleep, or its tunnel stopped.`;
    case 'refused':
      return `Nothing answers at ${name}’s address. Check that Remote is on there. A quick tunnel gets a new address each time it starts.`;
    case 'http':
      if (failure.status === 403) return `${name} refused the connection. Update Switchboard there.`;
      if (failure.status === 429) return `Too many tries. Switchboard tries again shortly.`;
      return `${name}’s address answered with an error (HTTP ${failure.status}). Check its tunnel.`;
    case 'closed':
      if (failure.code === CLOSE.version) return `${name} runs another version of Remote. Update Switchboard on both computers.`;
      return `${name} closed the connection.`;
    case 'dropped':
      return `Lost the connection to ${name}.`;
  }
}

/** Why pairing failed, in a sentence. */
export function pairingMessage(error: unknown): string {
  if (error instanceof RpcError) {
    if (error.code === 'DENIED') return 'The other computer didn’t allow this one.';
    if (error.code === 'TIMEOUT') return 'Nobody clicked Allow on the other computer in time.';
  }
  if (error instanceof LinkError) {
    const { failure } = error;
    if (failure.kind === 'closed' && failure.code === CLOSE.pairingClosed) return 'This link was used or has expired. On the other computer, click Pair a phone again and copy a new link.';
    if (failure.kind === 'closed' && failure.code === CLOSE.refused) return 'The other computer refused the link. Copy a new one.';
    if (failure.kind === 'http' && failure.status === 403) return 'The other computer refused the connection. Update Switchboard there.';
    return 'Can’t reach the other computer. Check that Remote is on there, and that its link is new.';
  }
  return error instanceof Error ? error.message : String(error);
}
