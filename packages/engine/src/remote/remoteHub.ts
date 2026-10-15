import type { DatabaseSync } from 'node:sqlite';
import {
  keyPairFromSecret,
  REMOTE_APP_URL,
  REMOTE_DEFAULT_PORT,
  remoteLinkFragment,
  RemoteSettings,
  RpcError,
  type Handlers,
  type HandlerContext,
  type KeyPair,
  type PermissionDecision,
  type ProjectDefaults,
  type RemoteSessions,
  type RemoteStatus,
  type RemoteContract,
  type SendMode,
  type TranscriptMessage,
  type TranscriptUpdate,
  type StreamDelta,
  type QueuedMessage,
} from '@switchboard/protocol';
import type { AppStateStore } from '../db/appState.ts';
import type { SessionSources } from '../companion/companionSessions.ts';
import { DeviceStore, type RemoteDevice } from './devices.ts';
import { Pairing } from './pairing.ts';
import { RemoteServer } from './remoteServer.ts';
import { findTool, Tunnel, type TunnelTool } from './tunnel.ts';
import { projectIdOf, remoteMessage, remoteSessions, transcriptPage } from './remoteView.ts';

const SETTINGS_KEY = 'remote.settings';
const DEFAULT_SETTINGS: RemoteSettings = { enabled: false, tunnel: 'cloudflare', customUrl: null, ngrokDomain: null, port: REMOTE_DEFAULT_PORT };
/** Waits before starting a tunnel again after it stopped by itself: longer each time, up to a minute. */
const RETRY_MS = [2_000, 5_000, 15_000, 60_000];

export interface RemoteProject {
  root: string;
  name: string;
  exists: boolean;
  /** Added to Switchboard by hand; folders that only have Claude Code sessions are not offered to a phone. */
  added: boolean;
  /** Position in your project list (null: after the ordered ones, by name). */
  order: number | null;
  defaults: ProjectDefaults;
}

export interface RemoteHubOptions {
  db: DatabaseSync;
  appState: AppStateStore;
  appVersion: string;
  /** The remote app (`REMOTE_APP_URL`; a development build can point at its own). */
  appUrl?: string;
  /**
   * Remote's identity key, which main keeps in the system's keychain. Asked for only once Remote is on, so the
   * keychain is never touched for people who don't use it; null when the keychain can't be used.
   */
  identity(): Promise<Uint8Array | null>;
  sources(): SessionSources;
  archiveAfterDays(): number;
  /** The sidebar's scope, so the phone lists what the sidebar lists. */
  scope(): 'switchboard' | 'all';
  projects(): RemoteProject[];
  readTranscript(sessionId: string): Promise<TranscriptMessage[]>;
  watchTranscript(sessionId: string, listener: (update: TranscriptUpdate) => void): () => void;
  send(sessionId: string, text: string, mode: SendMode): Promise<{ messageUuid: string; queued: boolean }>;
  dequeue(sessionId: string, id: string): void;
  interrupt(sessionId: string): Promise<void>;
  respond(requestId: string, decision: PermissionDecision): void;
  /** A new session in `root` with the project's defaults for model, effort and mode. */
  create(root: string, prompt: string, defaults: ProjectDefaults): Promise<{ sessionId: string }>;
  /** Tells the app's windows. */
  onStatus(status: RemoteStatus): void;
  /** A prompt or an answer came from a phone, for the label in the conversation. */
  onFromDevice?(event: { sessionId: string; messageUuid: string | null; requestId: string | null; device: string }): void;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  /** Tests: where the tools are, and what to run instead of them. */
  findTool?: (tool: TunnelTool) => string | null;
  tunnelCommand?: (tool: TunnelTool, port: number) => { file: string; args: string[] };
  retryMs?: readonly number[];
}

/** What a phone watches: one transcript at a time. */
interface Watch {
  sessionId: string;
  stop(): void;
}

/**
 * Remote, engine side: Settings › Remote's switch and tunnel, the device store, pairing, the server and what each
 * phone may ask (see docs/remote-access.md). Nothing listens until Remote is on and main handed over the identity
 * key; then the server listens on `127.0.0.1` and the tunnel makes it reachable at an `https://` address.
 */
export class RemoteHub {
  readonly devices: DeviceStore;
  private readonly pairing: Pairing;
  private readonly server: RemoteServer;
  private identity: KeyPair | null = null;
  private settings: RemoteSettings;
  private problem: RemoteStatus['problem'] = null;
  private readonly appUrl: string;
  /** The engine's public address while the tunnel runs. */
  private address: string | null = null;
  private tunnelState: RemoteStatus['tunnel'] = { state: 'off', message: null };
  private tunnel: Tunnel | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;
  /** Bumped on every change, so a tunnel that answers late for old settings is ignored. */
  private generation = 0;
  private changeTimer: ReturnType<typeof setTimeout> | undefined;
  private lastSessions = '';
  private readonly watches = new Map<HandlerContext<RemoteContract>, Watch>();
  /** Messages sent from a phone, by session, for the label (kept while the engine runs). */
  private readonly sentFrom = new Map<string, Map<string, string>>();
  private applying: Promise<void> = Promise.resolve();

  constructor(private readonly options: RemoteHubOptions) {
    this.devices = new DeviceStore(options.db);
    this.pairing = new Pairing(() => this.statusChanged());
    const saved = RemoteSettings.safeParse(options.appState.get(SETTINGS_KEY));
    this.settings = saved.success ? saved.data : DEFAULT_SETTINGS;
    this.appUrl = options.appUrl ?? REMOTE_APP_URL;
    this.server = new RemoteServer({
      // The server only starts once there is one (see `apply`).
      identity: () => this.identity!,
      devices: this.devices,
      pairing: this.pairing,
      appVersion: options.appVersion,
      origins: [new URL(this.appUrl).origin],
      cloudflare: () => this.settings.tunnel === 'cloudflare',
      log: options.log,
      handlers: (device) => this.handlers(device),
      onConnections: () => this.statusChanged(),
    });
  }

  /** Starts Remote when it was on when the app quit. */
  start(): Promise<void> {
    return this.apply();
  }

  status(): RemoteStatus {
    const find = this.options.findTool ?? ((tool: TunnelTool) => findTool(tool));
    return {
      available: true,
      settings: this.settings,
      appUrl: this.appUrl,
      address: this.address,
      tunnel: this.tunnelState,
      tools: { cloudflare: find('cloudflare') !== null, ngrok: find('ngrok') !== null, tailscale: find('tailscale') !== null },
      problem: this.problem,
      devices: this.devices.list(),
      connections: this.server.list(),
      pairing: this.pairing.state(),
    };
  }

  /** Changes Settings › Remote and starts, restarts or stops the server and the tunnel to match. */
  async configure(change: Partial<RemoteSettings>): Promise<RemoteStatus> {
    this.settings = RemoteSettings.parse({ ...this.settings, ...change });
    this.options.appState.set(SETTINGS_KEY, this.settings);
    await this.apply();
    return this.status();
  }

  /** Pair a phone: the link for the QR code, with the engine's address and a secret for one use. */
  startPairing(): { url: string; expiresAt: number } {
    const { identity, address } = this.reachable();
    const { secret, expiresAt } = this.pairing.start();
    return { url: `${this.appUrl}#${remoteLinkFragment({ kind: 'pair', enginePublicKey: identity.publicKey, secret, address })}`, expiresAt };
  }

  /** For phones already paired: the engine's address now (a quick tunnel gets a new one each time it starts). */
  connectLink(): { url: string } {
    const { identity, address } = this.reachable();
    return { url: `${this.appUrl}#${remoteLinkFragment({ kind: 'connect', enginePublicKey: identity.publicKey, address })}` };
  }

  cancelPairing(): void {
    this.pairing.cancel();
  }

  decidePairing(requestId: string, allow: boolean): void {
    if (!this.pairing.decide(requestId, allow)) throw new RpcError('NOT_FOUND', 'That phone is no longer waiting');
  }

  revoke(deviceId: string): void {
    this.devices.revoke(deviceId);
    this.server.disconnect(deviceId);
    this.statusChanged();
  }

  /** Sessions changed somewhere: phones hear about it shortly, when their list changed. */
  sessionsChanged(): void {
    if (this.changeTimer || !this.server.listening) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = undefined;
      const snapshot = this.list();
      const json = JSON.stringify(snapshot);
      if (json === this.lastSessions) return;
      this.lastSessions = json;
      this.server.each((rpc) => rpc.emit('sessions.changed', snapshot));
    }, 300);
    this.changeTimer.unref?.();
  }

  /** Claude's output as it is written, to phones watching that session. */
  stream(delta: StreamDelta): void {
    for (const [phone, watch] of this.watches) if (watch.sessionId === delta.sessionId) phone.emit('session.stream', delta);
  }

  upNextChanged(sessionId: string, queue: QueuedMessage[]): void {
    for (const [phone, watch] of this.watches) if (watch.sessionId === sessionId) phone.emit('upNext.changed', { sessionId, queue });
  }

  stop(): void {
    this.generation++;
    clearTimeout(this.changeTimer);
    this.pairing.cancel();
    this.stopListening();
  }

  // --- Listening ------------------------------------------------------------------------------------------------

  /** One change at a time: the switch can be flipped faster than the server starts. */
  private apply(): Promise<void> {
    this.applying = this.applying.then(() => this.applyNow()).catch((error) => this.options.log('error', `Remote: ${(error as Error).message}`));
    return this.applying;
  }

  private async applyNow(): Promise<void> {
    const generation = ++this.generation;
    const { enabled, port } = this.settings;
    this.stopListening();
    this.problem = null;
    if (!enabled) return this.statusChanged();
    if (!this.identity) {
      const secret = await this.options.identity().catch(() => null);
      if (!secret) {
        this.problem = { kind: 'failed', message: "Switchboard can't keep Remote's key in this computer's keychain." };
        return this.statusChanged();
      }
      this.identity = keyPairFromSecret(secret);
    }
    try {
      await this.server.start(port);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      this.problem = code === 'EADDRINUSE' ? { kind: 'port-in-use', port } : { kind: 'failed', message: (error as Error).message };
      return this.statusChanged();
    }
    if (generation === this.generation) await this.startTunnel(generation);
  }

  private async startTunnel(generation: number): Promise<void> {
    const { tunnel: tool, customUrl, ngrokDomain, port } = this.settings;
    if (new URL(this.appUrl).hostname === 'localhost') {
      // A development build of the remote app (`npm run dev:remote`) on this computer: no tunnel, straight to the port.
      this.address = `http://127.0.0.1:${port}`;
      this.tunnelState = { state: 'running', message: null };
      return this.statusChanged();
    }
    if (tool === 'custom') {
      // Your own tunnel or proxy: Switchboard only needs to know the address it forwards from.
      this.address = customUrl;
      this.tunnelState = customUrl ? { state: 'running', message: null } : { state: 'failed', message: 'Add the address that forwards to Remote.' };
      return this.statusChanged();
    }
    const binary = (this.options.findTool ?? ((t: TunnelTool) => findTool(t)))(tool);
    if (!binary) {
      this.problem = { kind: 'tool-missing', tunnel: tool };
      this.tunnelState = { state: 'failed', message: null };
      return this.statusChanged();
    }
    const command = this.options.tunnelCommand?.(tool, port);
    const tunnel = new Tunnel({ tool, port, binary, ngrokDomain, ...(command ? { command } : {}) });
    this.tunnel = tunnel;
    this.tunnelState = { state: 'starting', message: null };
    this.statusChanged();
    try {
      const address = await tunnel.start();
      if (generation !== this.generation) return;
      this.address = address;
      this.retries = 0;
      this.tunnelState = { state: 'running', message: null };
      this.options.log('info', `Remote: the ${tool} tunnel is running`);
      tunnel.onExit((message) => this.tunnelStopped(generation, message));
    } catch (error) {
      if (generation !== this.generation) return;
      this.tunnel = null;
      this.tunnelState = { state: 'failed', message: (error as Error).message };
      this.options.log('warn', `Remote: the ${tool} tunnel didn't start: ${(error as Error).message}`);
    }
    this.statusChanged();
  }

  /** The tool stopped by itself (the network went away, the account was signed out): try again, later each time. */
  private tunnelStopped(generation: number, message: string): void {
    if (generation !== this.generation) return;
    this.tunnel = null;
    this.address = null;
    this.tunnelState = { state: 'failed', message };
    this.options.log('warn', `Remote: the tunnel stopped: ${message}`);
    this.statusChanged();
    const waits = this.options.retryMs ?? RETRY_MS;
    const wait = waits[Math.min(this.retries++, waits.length - 1)]!;
    this.retryTimer = setTimeout(() => {
      if (generation === this.generation) void this.startTunnel(generation);
    }, wait);
    this.retryTimer.unref?.();
  }

  private stopListening(): void {
    clearTimeout(this.retryTimer);
    this.tunnel?.stop();
    this.tunnel = null;
    this.address = null;
    this.tunnelState = { state: 'off', message: null };
    for (const watch of this.watches.values()) watch.stop();
    this.watches.clear();
    this.server.stop();
    this.lastSessions = '';
  }

  /** The identity and the address a link needs; refused while Remote isn't reachable. */
  private reachable(): { identity: KeyPair; address: string } {
    if (!this.identity || !this.address) throw new RpcError('NOT_LISTENING', 'Remote is not reachable yet');
    return { identity: this.identity, address: this.address };
  }

  private statusChanged(): void {
    this.options.onStatus(this.status());
  }

  // --- What a phone may do --------------------------------------------------------------------------------------

  private list(): RemoteSessions {
    const projectNames = new Map(this.options.projects().map((p) => [p.root, p.name]));
    return remoteSessions(this.options.sources(), { archiveAfterDays: this.options.archiveAfterDays(), scope: this.options.scope(), projectNames });
  }

  /** A phone may only touch the sessions it can see in its list. */
  /** The projects New session offers, as the app's own list: the ones you added that still exist, in your order. */
  private yourProjects(): RemoteProject[] {
    return this.options
      .projects()
      .filter((p) => p.added && p.exists)
      .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.name.localeCompare(b.name));
  }

  private checkSession(sessionId: string): void {
    if (!this.list().sessions.some((s) => s.id === sessionId)) throw new RpcError('NOT_FOUND', 'No such session');
  }

  private handlers(device: RemoteDevice): Omit<Handlers<RemoteContract>, 'hello'> {
    const label = (sessionId: string, uuid: string) => {
      let map = this.sentFrom.get(sessionId);
      if (!map) this.sentFrom.set(sessionId, (map = new Map()));
      map.set(uuid, device.name);
    };
    const toRemote = (sessionId: string, messages: TranscriptMessage[]) => messages.map((m) => remoteMessage(m, this.sentFrom.get(sessionId)?.get(m.uuid)));
    const unwatch = (phone: HandlerContext<RemoteContract>) => {
      this.watches.get(phone)?.stop();
      this.watches.delete(phone);
    };
    return {
      'sessions.list': () => this.list(),
      'projects.list': () => ({ projects: this.yourProjects().map((p) => ({ id: projectIdOf(p.root), name: p.name })) }),
      'transcript.get': async ({ sessionId, before, after, limit }) => {
        this.checkSession(sessionId);
        const page = transcriptPage(await this.options.readTranscript(sessionId), { before, after, limit });
        return { ...page, messages: toRemote(sessionId, page.messages) };
      },
      'transcript.watch': ({ sessionId }, phone) => {
        this.checkSession(sessionId);
        if (this.watches.has(phone)) unwatch(phone);
        else phone.onDispose(() => unwatch(phone));
        const stop = this.options.watchTranscript(sessionId, (update) => {
          if (update.error) return;
          phone.emit('transcript.updated', { sessionId, mode: update.mode, messages: toRemote(sessionId, update.messages) });
        });
        this.watches.set(phone, { sessionId, stop });
        return {};
      },
      'transcript.unwatch': ({ sessionId }, phone) => {
        if (this.watches.get(phone)?.sessionId === sessionId) unwatch(phone);
        return {};
      },
      'session.send': async ({ sessionId, text, mode }) => {
        this.checkSession(sessionId);
        const sent = await this.options.send(sessionId, text, mode);
        if (!sent.queued) label(sessionId, sent.messageUuid);
        this.options.onFromDevice?.({ sessionId, messageUuid: sent.queued ? null : sent.messageUuid, requestId: null, device: device.name });
        return { queued: sent.queued };
      },
      'session.queue.remove': ({ sessionId, id }) => {
        this.checkSession(sessionId);
        this.options.dequeue(sessionId, id);
        return {};
      },
      'session.interrupt': async ({ sessionId }) => {
        this.checkSession(sessionId);
        await this.options.interrupt(sessionId);
        return {};
      },
      'session.respond': ({ requestId, decision }) => {
        const prompt = this.list().prompts.find((p) => p.requestId === requestId);
        if (!prompt) throw new RpcError('NOT_FOUND', 'That was already answered');
        this.options.respond(requestId, decision);
        this.options.onFromDevice?.({ sessionId: prompt.sessionId, messageUuid: null, requestId, device: device.name });
        return {};
      },
      'session.create': async ({ projectId, prompt }) => {
        const project = this.yourProjects().find((p) => projectIdOf(p.root) === projectId);
        if (!project) throw new RpcError('NOT_FOUND', 'No such project');
        return this.options.create(project.root, prompt, project.defaults);
      },
    };
  }
}
