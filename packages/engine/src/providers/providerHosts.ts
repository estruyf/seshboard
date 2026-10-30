import { randomUUID } from 'node:crypto';
import {
  BUILTIN_PROFILE_ID,
  RpcError,
  type HostState,
  type ImageAttachment,
  type LogLevel,
  type OptionalProvider,
  type PermissionDecision,
  type PermissionMode,
  type PermissionRequest,
  type QueuedMessage,
  type SendMode,
  type SessionHostInfo,
  type StreamDelta,
} from '@seshboard/protocol';
import type { RawSessionMessage } from '../claude/transcript.ts';
import type { TurnOutcome } from '../host/sessionHost.ts';
import { summarise, type StoredUpNext } from '../host/upNextStore.ts';
import type { DriverSession, ProviderAdapter } from './provider.ts';

export interface ProviderHostsDeps {
  /** The allowed providers that can run sessions (have a driver). */
  providers(): ProviderAdapter[];
  /** The provider of a session listed by one (to resume it). */
  providerOf(sessionId: string): OptionalProvider | undefined;
  /** The folder a session ran in. */
  sessionCwd(sessionId: string): string | null;
  /** The session is open in the provider's own app right now (Copilot CLI in a terminal): resuming it here would clash. */
  openElsewhere?(provider: OptionalProvider, sessionId: string): boolean;
  /** What each session last ran with (its mode and model), so a resume picks up where it left off. */
  settings?: { get(sessionId: string): { model?: string | null; permissionMode?: PermissionMode | null } | null | undefined; set(sessionId: string, change: { model?: string | null; permissionMode?: PermissionMode }): void };
  /** Where Up next is kept, the same store as Claude Code's sessions, so it outlives the session and the app. */
  upNext?: { list(sessionId: string): StoredUpNext[]; save(sessionId: string, messages: readonly StoredUpNext[]): void };
  onUpNext?(sessionId: string, queue: QueuedMessage[]): void;
  onInfo(info: SessionHostInfo): void;
  onStream(delta: StreamDelta): void;
  onMessages(sessionId: string, messages: RawSessionMessage[]): void;
  onPermission(request: PermissionRequest): void;
  onPermissionResolved(requestId: string, sessionId: string): void;
  onTurnEnd?(sessionId: string, outcome: TurnOutcome): void;
  /** A session this app started (it counts as a Seshboard session). */
  onCreated(sessionId: string): void;
  /** You sent a message to a session started elsewhere. */
  onContinued?(sessionId: string): void;
  log(level: LogLevel, message: string): void;
}

interface Host {
  provider: OptionalProvider;
  session: DriverSession | null;
  info: SessionHostInfo;
  permissions: Map<string, PermissionRequest>;
  /** A turn is under way (between a message and the provider going idle). */
  inTurn: boolean;
  /** Stop was pressed during this turn; `continue`: Up next goes on after it (Send now). */
  stopping: false | 'hold' | 'continue';
  /** Up next: messages that go one per turn, once the turn under way ends. */
  queue: StoredUpNext[];
}

/**
 * Runs other providers' sessions (GitHub Copilot) through their drivers, next to `HostManager`, which runs Claude
 * Code's. Each session reports what a Claude Code host does (`session.host` info, streamed text, live messages,
 * permission requests, turn ends, Up next), so the transcript, the sidebar, catch-up, the phone and notifications treat
 * them alike. Messages sent while a turn runs wait in Up next, steer the turn, or stop it (Send now), as for Claude
 * Code. Claude Code's own features (profiles, plan usage, mods, rewind, worktrees) don't apply.
 */
export class ProviderHosts {
  private readonly hosts = new Map<string, Host>();
  /** Permission request id → session. */
  private readonly requests = new Map<string, string>();

  constructor(private readonly deps: ProviderHostsDeps) {}

  has(sessionId: string): boolean {
    return this.hosts.has(sessionId);
  }

  /** Whether a session belongs to a provider that can run it here (running or not). */
  handles(sessionId: string): boolean {
    return this.hosts.has(sessionId) || this.adapterOf(this.deps.providerOf(sessionId)) !== undefined;
  }

  list(): { hosts: SessionHostInfo[]; permissions: PermissionRequest[] } {
    const hosts = [...this.hosts.values()];
    return { hosts: hosts.map((h) => h.info), permissions: hosts.flatMap((h) => [...h.permissions.values()]) };
  }

  /** Every running session's Up next. */
  upNextLists(): Array<{ sessionId: string; queue: QueuedMessage[] }> {
    return [...this.hosts.values()].filter((h) => h.queue.length).map((h) => ({ sessionId: h.info.sessionId, queue: h.queue.map(summarise) }));
  }

  /** Starts a session with a provider in `cwd` and sends the first message. Returns its id. */
  async create(params: { provider: OptionalProvider; cwd: string; prompt: string; attachments: ImageAttachment[]; model: string | null; permissionMode?: PermissionMode }): Promise<string> {
    const adapter = this.adapterOf(params.provider);
    if (!adapter?.driver) throw new RpcError('PROVIDER_UNAVAILABLE', 'This provider is not allowed, or cannot start sessions');
    const permissionMode = this.modeFor(adapter, params.permissionMode);
    // The provider names the session: it is reported from then on (the window waits on `session.create` until then).
    const host = this.newHost('', params.provider, params.cwd, params.model, permissionMode, 'starting');
    let session: DriverSession;
    try {
      session = await adapter.driver.start({ cwd: params.cwd, model: params.model, permissionMode }, this.eventsFor(host));
    } catch (error) {
      throw new RpcError('PROVIDER_FAILED', (error as Error).message);
    }
    host.session = session;
    host.info = { ...host.info, sessionId: session.sessionId };
    this.hosts.set(session.sessionId, host);
    this.deps.settings?.set(session.sessionId, { model: params.model, permissionMode });
    this.deps.onCreated(session.sessionId);
    this.deps.onInfo(host.info);
    await this.deliver(host, params.prompt, params.attachments);
    return session.sessionId;
  }

  /**
   * Sends a message, resuming the session here first when it isn't running. While a turn runs, `mode` decides: `queue`
   * waits in Up next, `steer` joins the turn at its next step, `now` stops the turn and goes first.
   */
  async send(params: { sessionId: string; text: string; attachments: ImageAttachment[]; mode?: SendMode }): Promise<{ sessionId: string; messageUuid: string; queued: boolean }> {
    const host = this.hosts.get(params.sessionId) ?? (await this.resume(params.sessionId));
    const mode = params.mode ?? 'queue';
    if (host.inTurn && mode !== 'steer') {
      const message: StoredUpNext = { id: randomUUID(), text: params.text, attachments: params.attachments, createdAt: Date.now() };
      if (mode === 'now') {
        host.queue.unshift(message);
        this.queueChanged(host);
        await this.stop(host, 'continue');
      } else {
        host.queue.push(message);
        this.queueChanged(host);
      }
      return { sessionId: params.sessionId, messageUuid: message.id, queued: true };
    }
    const messageUuid = await this.deliver(host, params.text, params.attachments, host.inTurn);
    return { sessionId: params.sessionId, messageUuid, queued: false };
  }

  /** Stops the turn. `continue`: Up next goes on after it; `hold` (Stop): Up next waits until resumed. */
  async interrupt(sessionId: string, upNext: 'hold' | 'continue' = 'hold'): Promise<void> {
    const host = this.hosts.get(sessionId);
    if (host?.session && host.inTurn) await this.stop(host, upNext);
  }

  async setModel(sessionId: string, model: string | null): Promise<void> {
    const host = this.hosts.get(sessionId);
    if (!host?.session) throw new RpcError('NOT_RUNNING', 'This session is not running in Seshboard');
    await host.session.setModel(model);
    this.deps.settings?.set(sessionId, { model });
    this.update(host, { model });
  }

  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    const host = this.hosts.get(sessionId);
    if (!host?.session) {
      // Not running: the next resume starts in it.
      this.deps.settings?.set(sessionId, { permissionMode: mode });
      return;
    }
    const adapter = this.adapterOf(host.provider);
    if (!adapter?.driver?.modes.some((m) => m.value === mode)) throw new RpcError('INVALID', 'This provider has no such mode');
    await host.session.setMode(mode);
    this.deps.settings?.set(sessionId, { permissionMode: mode });
    this.update(host, { permissionMode: mode });
  }

  /** Answers a permission request of a provider's session. False when the request isn't one of theirs. */
  respond(requestId: string, decision: PermissionDecision): boolean {
    const sessionId = this.requests.get(requestId);
    const host = sessionId ? this.hosts.get(sessionId) : undefined;
    if (!host?.session) return false;
    host.session.respond(requestId, decision);
    return true;
  }

  /** Takes a message out of Up next (to edit it in the box). */
  dequeue(sessionId: string, id: string): { text: string; attachments: ImageAttachment[] } | null {
    const host = this.hosts.get(sessionId);
    const index = host?.queue.findIndex((m) => m.id === id) ?? -1;
    if (!host || index < 0) return null;
    const [message] = host.queue.splice(index, 1);
    this.queueChanged(host);
    return { text: message!.text, attachments: message!.attachments };
  }

  moveQueued(sessionId: string, id: string, toIndex: number): void {
    const host = this.hosts.get(sessionId);
    const index = host?.queue.findIndex((m) => m.id === id) ?? -1;
    if (!host || index < 0) return;
    const [message] = host.queue.splice(index, 1);
    host.queue.splice(Math.max(0, Math.min(toIndex, host.queue.length)), 0, message!);
    this.queueChanged(host);
  }

  /** Sends one message from Up next now: stops the turn under way first, and the rest of Up next goes on after it. */
  async sendQueuedNow(sessionId: string, id: string): Promise<void> {
    const host = this.hosts.get(sessionId);
    if (!host) return;
    this.moveQueued(sessionId, id, 0);
    this.update(host, { queueHold: null });
    if (host.inTurn) await this.stop(host, 'continue');
    else await this.next(host);
  }

  /** Up next goes on after Stop, a failed turn, or a restart. */
  async resumeQueue(sessionId: string): Promise<void> {
    const host = this.hosts.get(sessionId) ?? (this.deps.upNext?.list(sessionId).length ? await this.resume(sessionId) : undefined);
    if (!host) return;
    this.update(host, { queueHold: null });
    if (!host.inTurn) await this.next(host);
  }

  /** Lets go of a session (it stays on disk, and so does its Up next; sending resumes it). */
  async close(sessionId: string): Promise<void> {
    const host = this.hosts.get(sessionId);
    if (!host) return;
    this.hosts.delete(sessionId);
    await host.session?.close().catch((error: Error) => this.deps.log('warn', `Closing ${sessionId}: ${error.message}`));
    this.update(host, { state: 'closed' });
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.hosts.keys()].map((id) => this.close(id)));
  }

  private async resume(sessionId: string): Promise<Host> {
    const provider = this.deps.providerOf(sessionId);
    const adapter = this.adapterOf(provider);
    if (!provider || !adapter?.driver) throw new RpcError('READ_ONLY_SESSION', 'Sending is only available for Claude Code sessions');
    if (this.deps.openElsewhere?.(provider, sessionId)) {
      throw new RpcError('SESSION_BUSY_ELSEWHERE', 'This session is open in its own app right now. Close it there first.');
    }
    const cwd = this.deps.sessionCwd(sessionId);
    if (!cwd) throw new RpcError('NOT_FOUND', 'Unknown session, or its folder is not recorded');
    const saved = this.deps.settings?.get(sessionId);
    const model = saved?.model ?? null;
    const permissionMode = this.modeFor(adapter, saved?.permissionMode);
    const host = this.track(sessionId, provider, cwd, model, permissionMode, 'starting');
    try {
      host.session = await adapter.driver.start({ cwd, model, permissionMode, resume: sessionId }, this.eventsFor(host));
    } catch (error) {
      this.hosts.delete(sessionId);
      this.update(host, { state: 'closed' });
      throw new RpcError('PROVIDER_FAILED', (error as Error).message);
    }
    // What waited in Up next when it stopped (or the app quit) comes back, held until you go on.
    const kept = this.deps.upNext?.list(sessionId) ?? [];
    host.queue = [...kept];
    this.update(host, { state: 'idle', queue: host.queue.map(summarise), queueHold: kept.length ? 'saved' : null });
    this.deps.onContinued?.(sessionId);
    return host;
  }

  /** Hands a message to the provider (`steer`: into the turn under way). */
  private async deliver(host: Host, text: string, attachments: readonly ImageAttachment[], steer = false): Promise<string> {
    if (!steer) {
      host.inTurn = true;
      host.stopping = false;
    }
    this.update(host, { state: host.permissions.size ? 'needs-you' : 'running', promptedAt: Date.now(), error: null });
    try {
      return await host.session!.send(text, attachments, steer);
    } catch (error) {
      if (!steer) host.inTurn = false;
      this.update(host, { state: 'error', error: (error as Error).message });
      throw new RpcError('PROVIDER_FAILED', (error as Error).message);
    }
  }

  private async stop(host: Host, upNext: 'hold' | 'continue'): Promise<void> {
    host.stopping = upNext;
    await host.session!.interrupt();
  }

  /** Sends the first message of Up next, when there is one and nothing holds it. */
  private async next(host: Host): Promise<void> {
    if (host.inTurn || host.info.queueHold || !host.queue.length || !host.session) return;
    const message = host.queue.shift()!;
    this.queueChanged(host);
    await this.deliver(host, message.text, message.attachments).catch((error: Error) => this.deps.log('warn', `Up next for ${host.info.sessionId}: ${error.message}`));
  }

  private queueChanged(host: Host): void {
    const id = host.info.sessionId;
    this.deps.upNext?.save(id, host.queue);
    const queue = host.queue.map(summarise);
    this.deps.onUpNext?.(id, queue);
    this.update(host, { queue, ...(host.queue.length ? {} : { queueHold: null }) });
  }

  /** The mode a session starts in: the one asked for when the provider has it, else the provider's first. */
  private modeFor(adapter: ProviderAdapter, mode: PermissionMode | null | undefined): PermissionMode {
    const modes = adapter.driver?.modes ?? [];
    return mode && modes.some((m) => m.value === mode) ? mode : (modes[0]?.value ?? 'default');
  }

  /** A host that is reported from now on. */
  private track(sessionId: string, provider: OptionalProvider, cwd: string, model: string | null, permissionMode: PermissionMode, state: HostState): Host {
    const host = this.newHost(sessionId, provider, cwd, model, permissionMode, state);
    this.hosts.set(sessionId, host);
    this.deps.onInfo(host.info);
    return host;
  }

  private newHost(sessionId: string, provider: OptionalProvider, cwd: string, model: string | null, permissionMode: PermissionMode, state: HostState): Host {
    return {
      provider,
      session: null,
      permissions: new Map(),
      inTurn: false,
      stopping: false,
      queue: [],
      info: {
        sessionId,
        cwd,
        state,
        model,
        permissionMode,
        effort: null,
        costUsd: 0,
        contextPercent: null,
        contextTokens: null,
        contextMax: null,
        error: null,
        startedAt: Date.now(),
        promptedAt: null,
        queue: [],
        queueHold: null,
        // Claude profiles don't apply: the provider's own login runs it.
        profileId: BUILTIN_PROFILE_ID,
        backgroundTasks: [],
        provider,
      },
    };
  }

  private eventsFor(host: Host) {
    const id = () => host.info.sessionId;
    return {
      stream: (delta: Omit<StreamDelta, 'sessionId'>) => this.deps.onStream({ ...delta, sessionId: id() }),
      messages: (messages: RawSessionMessage[]) => this.deps.onMessages(id(), messages),
      state: (state: 'running' | 'idle' | 'error', error?: string) => {
        if (state === 'running') {
          host.inTurn = true;
          this.update(host, { state: host.permissions.size ? 'needs-you' : 'running' });
          return;
        }
        const ended = host.inTurn;
        const stopped = host.stopping;
        host.inTurn = false;
        host.stopping = false;
        // Stop holds Up next, and so does a failed turn; Send now (`continue`) goes on with it.
        const queueHold = !host.queue.length ? null : state === 'error' ? 'error' : stopped === 'hold' ? 'stopped' : host.info.queueHold;
        this.update(host, state === 'error' ? { state: 'error', error: error ?? null, queueHold } : { state: 'idle', queueHold });
        if (ended) {
          const outcome: TurnOutcome =
            state === 'error'
              ? { ok: false, error: error ?? null }
              : { ok: true, error: null, ...(stopped ? { stopped: true } : {}), ...(stopped === 'continue' && host.queue.length ? { superseded: true } : {}) };
          this.deps.onTurnEnd?.(id(), outcome);
        }
        if (state === 'idle') void this.next(host);
      },
      permission: (request: Omit<PermissionRequest, 'sessionId'>) => {
        const full = { ...request, sessionId: id() };
        host.permissions.set(request.requestId, full);
        this.requests.set(request.requestId, id());
        this.update(host, { state: 'needs-you' });
        this.deps.onPermission(full);
      },
      permissionDone: (requestId: string) => {
        if (!host.permissions.delete(requestId)) return;
        this.requests.delete(requestId);
        this.deps.onPermissionResolved(requestId, id());
        if (host.info.state === 'needs-you' && host.permissions.size === 0) this.update(host, { state: host.inTurn ? 'running' : 'idle' });
      },
      usage: (usage: { contextTokens?: number; contextMax?: number; spent?: { amount: number; unit: string } }) => {
        const change: Partial<SessionHostInfo> = {};
        if (usage.contextTokens !== undefined && usage.contextMax) {
          change.contextTokens = usage.contextTokens;
          change.contextMax = usage.contextMax;
          change.contextPercent = Math.round((usage.contextTokens / usage.contextMax) * 100);
        }
        if (usage.spent) change.providerUsage = usage.spent;
        this.update(host, change);
      },
    };
  }

  private update(host: Host, change: Partial<SessionHostInfo>): void {
    host.info = { ...host.info, ...change };
    this.deps.onInfo(host.info);
  }

  private adapterOf(provider: OptionalProvider | undefined): ProviderAdapter | undefined {
    return provider ? this.deps.providers().find((p) => p.id === provider && p.driver) : undefined;
  }
}
