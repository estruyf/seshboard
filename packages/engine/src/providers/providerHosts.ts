import { BUILTIN_PROFILE_ID, RpcError, type HostState, type ImageAttachment, type LogLevel, type OptionalProvider, type PermissionDecision, type PermissionRequest, type SessionHostInfo, type StreamDelta } from '@seshboard/protocol';
import type { RawSessionMessage } from '../claude/transcript.ts';
import type { TurnOutcome } from '../host/sessionHost.ts';
import type { DriverSession, ProviderAdapter } from './provider.ts';

export interface ProviderHostsDeps {
  /** The allowed providers that can run sessions (have a driver). */
  providers(): ProviderAdapter[];
  /** The provider of a session listed by one (to resume it). */
  providerOf(sessionId: string): OptionalProvider | undefined;
  /** The folder a session ran in. */
  sessionCwd(sessionId: string): string | null;
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
  /** Stop was pressed during this turn. */
  stopping: boolean;
}

/**
 * Runs other providers' sessions (GitHub Copilot) through their drivers, next to `HostManager`, which runs Claude
 * Code's. Each session reports what a Claude Code host does (`session.host` info, streamed text, live messages,
 * permission requests, turn ends), so the transcript, the sidebar, catch-up and notifications treat them alike.
 * Claude Code's own features (profiles, plan usage, mods, rewind, worktrees) don't apply.
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

  /** Starts a session with a provider in `cwd` and sends the first message. Returns its id. */
  async create(params: { provider: OptionalProvider; cwd: string; prompt: string; attachments: ImageAttachment[]; model: string | null }): Promise<string> {
    const adapter = this.adapterOf(params.provider);
    if (!adapter?.driver) throw new RpcError('PROVIDER_UNAVAILABLE', 'This provider is not allowed, or cannot start sessions');
    // The provider names the session: it is reported from then on (the window waits on `session.create` until then).
    const host = this.newHost('', params.provider, params.cwd, params.model, 'starting');
    let session: DriverSession;
    try {
      session = await adapter.driver.start({ cwd: params.cwd, model: params.model }, this.eventsFor(host));
    } catch (error) {
      throw new RpcError('PROVIDER_FAILED', (error as Error).message);
    }
    host.session = session;
    host.info = { ...host.info, sessionId: session.sessionId };
    this.hosts.set(session.sessionId, host);
    this.deps.onCreated(session.sessionId);
    this.deps.onInfo(host.info);
    await this.sendTo(host, params.prompt, params.attachments);
    return session.sessionId;
  }

  /** Sends a message, resuming the session here first when it isn't running. */
  async send(params: { sessionId: string; text: string; attachments: ImageAttachment[] }): Promise<{ sessionId: string; messageUuid: string; queued: boolean }> {
    const host = this.hosts.get(params.sessionId) ?? (await this.resume(params.sessionId));
    const messageUuid = await this.sendTo(host, params.text, params.attachments);
    return { sessionId: params.sessionId, messageUuid, queued: false };
  }

  async interrupt(sessionId: string): Promise<void> {
    const host = this.hosts.get(sessionId);
    if (!host?.session || !host.inTurn) return;
    host.stopping = true;
    await host.session.interrupt();
  }

  async setModel(sessionId: string, model: string | null): Promise<void> {
    const host = this.hosts.get(sessionId);
    if (!host?.session) throw new RpcError('NOT_RUNNING', 'This session is not running in Seshboard');
    await host.session.setModel(model);
    this.update(host, { model });
  }

  /** Answers a permission request of a provider's session. False when the request isn't one of theirs. */
  respond(requestId: string, decision: PermissionDecision): boolean {
    const sessionId = this.requests.get(requestId);
    const host = sessionId ? this.hosts.get(sessionId) : undefined;
    if (!host?.session) return false;
    host.session.respond(requestId, decision);
    return true;
  }

  /** Lets go of a session (it stays on disk; sending resumes it). */
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
    const cwd = this.deps.sessionCwd(sessionId);
    if (!cwd) throw new RpcError('NOT_FOUND', 'Unknown session, or its folder is not recorded');
    const host = this.track(sessionId, provider, cwd, null, 'starting');
    try {
      host.session = await adapter.driver.start({ cwd, model: null, resume: sessionId }, this.eventsFor(host));
    } catch (error) {
      this.hosts.delete(sessionId);
      this.update(host, { state: 'closed' });
      throw new RpcError('PROVIDER_FAILED', (error as Error).message);
    }
    this.deps.onContinued?.(sessionId);
    return host;
  }

  private async sendTo(host: Host, text: string, attachments: readonly ImageAttachment[]): Promise<string> {
    host.inTurn = true;
    host.stopping = false;
    this.update(host, { state: 'running', promptedAt: Date.now(), error: null });
    try {
      return await host.session!.send(text, attachments);
    } catch (error) {
      host.inTurn = false;
      this.update(host, { state: 'error', error: (error as Error).message });
      throw new RpcError('PROVIDER_FAILED', (error as Error).message);
    }
  }

  /** A host that is reported from now on. */
  private track(sessionId: string, provider: OptionalProvider, cwd: string, model: string | null, state: HostState): Host {
    const host = this.newHost(sessionId, provider, cwd, model, state);
    this.hosts.set(sessionId, host);
    this.deps.onInfo(host.info);
    return host;
  }

  private newHost(sessionId: string, provider: OptionalProvider, cwd: string, model: string | null, state: HostState): Host {
    return {
      provider,
      session: null,
      permissions: new Map(),
      inTurn: false,
      stopping: false,
      info: {
        sessionId,
        cwd,
        state,
        model,
        permissionMode: 'default',
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
        this.update(host, state === 'error' ? { state: 'error', error: error ?? null } : { state: 'idle' });
        if (ended) this.deps.onTurnEnd?.(id(), state === 'error' ? { ok: false, error: error ?? null } : { ok: true, error: null, ...(stopped ? { stopped: true } : {}) });
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
