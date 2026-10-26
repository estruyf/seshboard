import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_APP_ICON,
  defuseStubs,
  keyPairFromSecret,
  REMOTE_APP_URL,
  REMOTE_DEFAULT_PORT,
  REMOTE_LEGACY_APP_URLS,
  REMOTE_PREVIEW_APP_URL,
  remoteLinkFragment,
  RemoteSettings,
  RemoteTheme,
  RpcError,
  type Handlers,
  type HandlerContext,
  type KeyPair,
  type PermissionDecision,
  type ProfileColor,
  type ProfileDefaults,
  type ProjectDefaults,
  type RemoteBranches,
  type ClonePlan,
  type CloneProgress,
  type RemoteLimitStanding,
  type RemoteSessionOptions,
  type RemoteSession,
  type RemoteSessions,
  type RemoteStatus,
  type RemoteContract,
  type SendMode,
  type TranscriptMessage,
  type TranscriptUpdate,
  type StreamDelta,
  type QueuedMessage,
  type CatchUp,
  type GitChanges,
  type PermissionRequest,
  type SessionHostInfo,
  type RemotePushSubscription,
  type RemoteImage,
  type ModelOption,
  type PermissionMode,
  type UsageBreakdown,
  type WindowCost,
  type UsageGroup,
  type UsagePeriod,
  type UsageSnapshot,
  type AutoTier,
  type AskEvent,
  type AskThreadList,
  type Pipeline,
  type PipelineNotice,
  type PipelineRunState,
  type PushPreview,
  type RemoteRunState,
  type RunChoices,
  Effort,
  runOfParent,
  withRunStub,
  REMOTE_DIFF_LINES,
  REMOTE_DESKTOP_ORIGIN,
} from '@seshboard/protocol';
import type { AppStateStore } from '../db/appState.ts';
import type { SessionSources } from '../companion/companionSessions.ts';
import { DeviceStore, type RemoteDevice } from './devices.ts';
import { checkAttachments, promptWithFiles, pruneRemoteFiles, saveRemoteFiles } from './remoteFiles.ts';
import { Pairing } from './pairing.ts';
import { RemoteServer } from './remoteServer.ts';
import { nextFreePort } from './freePort.ts';
import { findTool, Tunnel, type TunnelTool } from './tunnel.ts';
import { finishedLine, needsYouLine, promptAnswers, pushTargets, TurnEnds, type PushPayload } from './pushEvents.ts';
import { generateVapidKeys, isPushEndpoint, sendPush, validVapidKeys, type VapidKeys } from './webPush.ts';
import { capDiff, lastSegment, projectIdOf, remoteCatchUp, remoteRun, remoteUsage, remoteDefaults, remoteMessage, remoteSessions, sessionChoice, transcriptPage, type SessionChoice } from './remoteView.ts';

const SETTINGS_KEY = 'remote.settings';
/** The app's theme, kept so a phone that connects before a window opened gets it too. */
const THEME_KEY = 'remote.theme';
/** The engine's VAPID key pair, made the first time a phone asks for it. */
const VAPID_KEY = 'remote.vapid';
/** Each paired device's push subscription and the moments it wants, by device id. */
const PUSH_KEY = 'remote.push';
/** How long a finished turn's push waits for its catch-up, which says what happened. */
const CATCH_UP_WAIT_MS = 8_000;

type PushEntry = {
  deviceId: string;
  subscription: RemotePushSubscription;
  needsYou: boolean;
  finished: boolean;
  /** The device's own VAPID key (`REMOTE_FEATURE_PUSH_KEY`), which its subscription was made with; else the engine's. */
  vapid?: VapidKeys;
  /** What its pushes start with: this computer's name, for a device paired with more than one. */
  label?: string;
};
const DEFAULT_SETTINGS: RemoteSettings = { enabled: false, tunnel: 'cloudflare', customUrl: null, ngrokDomain: null, port: REMOTE_DEFAULT_PORT };
/** Waits before starting a tunnel again after it stopped by itself: longer each time, up to a minute. */
const RETRY_MS = [2_000, 5_000, 15_000, 60_000];

export interface RemoteProject {
  root: string;
  name: string;
  exists: boolean;
  /** Added to Seshboard by hand; folders that only have Claude Code sessions are not offered to a phone. */
  added: boolean;
  /** Position in your project list (null: after the ordered ones, by name). */
  order: number | null;
  defaults: ProjectDefaults;
  /** The project's own Claude profile (null: the default). */
  profileId: string | null;
}

/** A Claude profile as Remote needs it: no folder, no account. */
export interface RemoteHubProfile {
  id: string;
  name: string;
  color: ProfileColor;
  defaults: ProfileDefaults;
  /** Its account's `accountTag`, for `usage.get`; null without an account. */
  account?: string | null;
}

/** A run's button, as the computer's step tree has it. */
export type RemoteRunAction = 'continue' | 'retryStep' | 'anotherRound' | 'skipStep' | 'stop';

/** Pipelines (#179) as the computer runs them; what goes wrong comes back as an `RpcError` with a sentence. */
export interface RemotePipelines {
  /** Every run, with its steps. */
  runs(): PipelineRunState[];
  /** The pipelines the project in `root` can run, as `pipelines.list` there. */
  list(root: string): Pipeline[];
  /** Runs a pipeline, as `pipelines.run` on the computer: from a session, or with a task in `projectRoot`. */
  run(input: { pipelineId: string; parentSessionId: string | null; task: string | null; attachments: RemoteImage[]; projectRoot: string | null; profileId: string | null; choices: RunChoices | null }): Promise<PipelineRunState>;
  /** One of a run's buttons; `message` is Push's commit message for Continue. */
  act(action: RemoteRunAction, runId: string, message: string | null): Promise<PipelineRunState>;
  archive(runId: string, archived: boolean): Promise<void>;
  pushPreview(runId: string, fresh: boolean): Promise<PushPreview>;
  /** Writes in a run row: the run gets a session of its own, with the run's brief first. */
  write(runId: string, text: string): Promise<{ sessionId: string }>;
}

/** What `remote.fromDevice` tells the app's windows. */
export interface RemoteFromDevice {
  sessionId: string;
  messageUuid: string | null;
  requestId: string | null;
  /** The device's name, for older callers; `deviceId` is the device. */
  device: string;
  deviceId: string;
  /** For an answer: the tool it was about and whether it was allowed. */
  answer: { toolName: string; allowed: boolean } | null;
}

export interface RemoteHubOptions {
  db: DatabaseSync;
  appState: AppStateStore;
  appVersion: string;
  /** What the phone calls this computer (tests and the demo pass their own). */
  computerName?: () => string;
  /** The remote app (`REMOTE_APP_URL`; a development build can point at its own). */
  appUrl?: string;
  /**
   * Also accept the preview's remote app (`REMOTE_PREVIEW_APP_URL`): development and beta builds, and a release whose
   * update channel is Beta. Changes with `setPreviewApp`.
   */
  previewApp?: boolean;
  /** Where files sent with a message are kept (`remoteFiles.ts`). */
  filesDir: string;
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
  /** Every Claude profile, and the one projects without their own use. */
  profiles(): { profiles: RemoteHubProfile[]; defaultId: string };
  /** The transcript with the messages a session still holds back, as the first `watchTranscript` update has it. */
  readTranscript(sessionId: string): Promise<TranscriptMessage[]>;
  watchTranscript(sessionId: string, listener: (update: TranscriptUpdate) => void): () => void;
  send(sessionId: string, text: string, mode: SendMode, images: RemoteImage[]): Promise<{ messageUuid: string; queued: boolean }>;
  dequeue(sessionId: string, id: string): void;
  /** Send now on a message in Up next: Claude's turn stops and it goes, as on the computer. */
  sendQueuedNow(sessionId: string, id: string): Promise<void>;
  /** A session's Up next as it is now, for a phone that starts watching it (it may have missed changes while away). */
  upNext(sessionId: string): QueuedMessage[];
  /** How a session stands with its profile's usage limit; null when its profile isn't at one. */
  limit(sessionId: string): RemoteLimitStanding | null;
  /** Resume now, and Resume when it resets on or off, as on the computer. */
  resumeLimit(sessionId: string): Promise<void>;
  armLimit(sessionId: string, armed: boolean): void;
  /** Stops Claude's turn and lets Up next move on after it: the phone has no Send next. */
  interrupt(sessionId: string): Promise<void>;
  /** Stops one of a running session's background tasks. */
  stopTask(sessionId: string, taskId: string): Promise<void>;
  respond(requestId: string, decision: PermissionDecision): void;
  /** A new session in `root`, with what the phone chose and the project's defaults for the rest. */
  create(root: string, prompt: string, choice: SessionChoice, images: RemoteImage[]): Promise<{ sessionId: string }>;
  /** The local branches of the folder `root`, as `git.branches` on the computer (none outside a git repository). */
  branches(root: string): Promise<RemoteBranches>;
  /** Puts a prompt in the queue (Later) for `root`. */
  queue(root: string, prompt: string, choice: SessionChoice): { id: string };
  /** As opening the session on the computer: no longer unread. */
  markRead(sessionId: string): void;
  /** Unread again, as before it was read: Undo after Mark as read. */
  markUnread(sessionId: string): void;
  setFlags(sessionId: string, flags: { pinned?: boolean; archived?: boolean }): void;
  setModel(sessionId: string, model: string | null): Promise<void>;
  setEffort(sessionId: string, effort: Effort | null): Promise<void>;
  setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void>;
  models(): ModelOption[];
  /** Settings › Conversation › Auto model: whether New session offers Auto, and the models it may pick. */
  autoModel(): { enabled: boolean; allowed: AutoTier[] };
  /** Settings › General › Global permission mode: what a session starts in where its profile and project set none. */
  globalPermissionMode(): PermissionMode;
  /** A profile's plan usage, as `usage.get` on the computer (`refresh`: check now). */
  usage(profileId: string, refresh: boolean): Promise<{ usage: UsageSnapshot | null; error: string | null }>;
  /**
   * Where the tokens of the profile signed in to an account (its `accountKey`) went, as `usage.breakdown`; null when
   * no profile here signs in to it.
   */
  tokens(account: string, params: { period: UsagePeriod; groupBy: UsageGroup; model: string | null; timeZone: string }): UsageBreakdown | null;
  /** A session's estimated API cost since it started, as `usage.sessionCost` on the computer. */
  sessionCost(sessionId: string): { usd: number; partial: boolean } | null;
  /** The cost of the given plan windows for the profile signed in to an account; null when no profile here signs in to it. */
  windowCosts(account: string, windows: ReadonlyArray<{ kind: string; scope: string | null; from: number }>): WindowCost[] | null;
  catchUp(sessionId: string): CatchUp | null;
  /** Ask about this session, as on the computer: the answer comes through `askEvent`. */
  ask(sessionId: string, question: string, threadId: string | undefined, replaces: string | undefined): { threadId: string; id: string; at: number };
  askThreads(sessionId: string): AskThreadList;
  /** What changed in the session's checkout, uncommitted; null when it has no folder. */
  changes(sessionId: string): Promise<GitChanges | null>;
  diff(sessionId: string, path: string): Promise<{ diff: string; truncated: boolean }>;
  /** Commits every change in the session's checkout, without a terminal. */
  commit(sessionId: string, message: string): Promise<{ ok: true; sha: string } | { ok: false; output: string }>;
  /** Clone from GitHub, as `projects.clonePlan` on the computer (`off` while its setting is off). */
  clonePlan(url: string, name: string | undefined): Promise<ClonePlan>;
  /** Starts a clone, as `projects.clone` on the computer; its progress goes to `onProgress` too. */
  clone(jobId: string, url: string, name: string, onProgress: (progress: CloneProgress) => void): Promise<void>;
  cancelClone(jobId: string): void;
  /** Pipelines: the runs in the list, and what a phone may do with them. Without it a phone sees no runs. */
  pipelines?: RemotePipelines;
  /** Tells the app's windows. */
  onStatus(status: RemoteStatus): void;
  /** A prompt or an answer came from a phone, for the label in the conversation and the sidebar's last action. */
  onFromDevice?(event: RemoteFromDevice): void;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  /** Tests: where the tools are, and what to run instead of them. */
  findTool?: (tool: TunnelTool) => string | null;
  tunnelCommand?: (tool: TunnelTool, port: number) => { file: string; args: string[] };
  retryMs?: readonly number[];
  /** Tests: where pushes go instead of the push services. */
  pushFetch?: typeof fetch;
  catchUpWaitMs?: number;
}

/**
 * The origins whose remote app may open a socket: the app's, and the preview's when `previewApp`, each with the
 * address it had before seshboard.app (`REMOTE_LEGACY_APP_URLS`), so phones paired there keep working.
 */
export function remoteAppOrigins(appUrl: string, previewApp: boolean): string[] {
  const urls = [appUrl];
  if (previewApp) urls.push(REMOTE_PREVIEW_APP_URL);
  const origins: string[] = [];
  for (const url of urls) {
    for (const origin of [new URL(url).origin, ...(REMOTE_LEGACY_APP_URLS[url] ? [new URL(REMOTE_LEGACY_APP_URLS[url]).origin] : [])]) {
      if (!origins.includes(origin)) origins.push(origin);
    }
  }
  return origins;
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
  /** Whether the preview's remote app is let in (`previewApp`, then `setPreviewApp`). */
  private previewApp: boolean;
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
  /** Connections whose app is on the device's screen, with their device: no pushes to those devices. */
  private readonly visible = new Map<HandlerContext<RemoteContract>, string>();
  private readonly turnEnds = new TurnEnds();
  /** Finished turns waiting for their catch-up before their push goes out. */
  private readonly finishing = new Map<string, ReturnType<typeof setTimeout>>();
  /** Questions a phone asked that are still answering, by id: their answer reaches it also after it left the session. */
  private readonly askedBy = new Map<string, Set<HandlerContext<RemoteContract>>>();
  /** Messages sent from a phone, by session, for the label (kept while the engine runs). */
  private readonly sentFrom = new Map<string, Map<string, string>>();
  /**
   * Sessions a phone archived, and when: it may take that back (Undo) for a while, although an archived session has
   * left its list and nothing else may touch it.
   */
  private readonly archivedFromPhone = new Map<string, number>();
  private applying: Promise<void> = Promise.resolve();
  /** Settings › Theme › App icon's colourway for phones, from main (`setAppIcon`). */
  private appIcon: string = DEFAULT_APP_ICON;
  /** The theme the app shows (`remote.setTheme`), for phones that look like this computer. */
  private theme: RemoteTheme | null;

  constructor(private readonly options: RemoteHubOptions) {
    this.devices = new DeviceStore(options.db);
    this.pairing = new Pairing(() => this.statusChanged());
    const saved = RemoteSettings.safeParse(options.appState.get(SETTINGS_KEY));
    this.settings = saved.success ? saved.data : DEFAULT_SETTINGS;
    const theme = RemoteTheme.safeParse(options.appState.get(THEME_KEY));
    this.theme = theme.success ? theme.data : null;
    this.appUrl = options.appUrl ?? REMOTE_APP_URL;
    this.previewApp = options.previewApp ?? false;
    this.server = new RemoteServer({
      // The server only starts once there is one (see `apply`).
      identity: () => this.identity!,
      devices: this.devices,
      pairing: this.pairing,
      appVersion: options.appVersion,
      ...(options.computerName ? { computerName: options.computerName } : {}),
      appIcon: () => this.appIcon,
      // Seshboard on another computer pairs and connects as a phone does (docs/remote-access.md, Other computers).
      origins: () => [...remoteAppOrigins(this.appUrl, this.previewApp), REMOTE_DESKTOP_ORIGIN],
      address: () => this.address,
      cloudflare: () => this.settings.tunnel === 'cloudflare',
      log: options.log,
      handlers: (device) => this.handlers(device),
      onConnections: () => this.statusChanged(),
    });
  }

  /** Starts Remote when it was on when the app quit. */
  start(): Promise<void> {
    pruneRemoteFiles(this.options.filesDir);
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
      addressChanged: this.addressChanged(),
      pairing: this.pairing.state(),
    };
  }

  /**
   * A quick tunnel's new address hasn't reached any paired device: one connected before through another address, and
   * none has connected through this one since. Only for tunnels whose address changes when they start.
   */
  private addressChanged(): boolean {
    const { tunnel, ngrokDomain } = this.settings;
    const changes = tunnel === 'cloudflare' || (tunnel === 'ngrok' && !ngrokDomain);
    if (!changes || this.tunnelState.state !== 'running' || !this.address) return false;
    const seen = this.devices.list().flatMap((device) => (device.lastAddress ? [device.lastAddress] : []));
    return seen.length > 0 && !seen.includes(this.address);
  }

  /** Changes Settings › Remote and starts, restarts or stops the server and the tunnel to match. */
  async configure(change: Partial<RemoteSettings>): Promise<RemoteStatus> {
    this.settings = RemoteSettings.parse({ ...this.settings, ...change });
    this.options.appState.set(SETTINGS_KEY, this.settings);
    await this.apply();
    return this.status();
  }

  /** Pair a device: the link for the QR code, with the engine's address and a secret for one use. */
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

  rename(deviceId: string, name: string): void {
    if (!this.devices.rename(deviceId, name)) throw new RpcError('NOT_FOUND', 'That device is no longer paired');
    this.statusChanged();
  }

  revoke(deviceId: string): void {
    this.devices.revoke(deviceId);
    this.setPush(deviceId, null);
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

  /** An answer to Ask about this session: to phones watching the session, and to the one that asked. */
  askEvent(event: AskEvent): void {
    const phones = new Set(this.askedBy.get(event.id));
    for (const [phone, watch] of this.watches) if (watch.sessionId === event.sessionId) phones.add(phone);
    for (const phone of phones) phone.emit('session.ask', event);
    if (event.done) this.askedBy.delete(event.id);
  }

  /** Settings › Theme › App icon changed (Graphite with "Use it on your phone too" off): connected phones swap their icons. */
  setAppIcon(key: string): void {
    if (key === this.appIcon) return;
    this.appIcon = key;
    if (this.server.listening) this.server.each((rpc) => rpc.emit('app.icon', { key }));
  }

  /**
   * The update channel changed: Beta lets in the preview's remote app too, Stable only the website's. Phones on the
   * preview are closed when it stops being let in, rather than at their next reconnect.
   */
  setPreviewApp(enabled: boolean): void {
    if (enabled === this.previewApp) return;
    this.previewApp = enabled;
    if (!enabled && this.server.listening) this.server.closeRefused();
  }

  /** A usage limit was hit, cleared or armed: phones watching a session hear how it stands now. */
  limitsChanged(): void {
    for (const [phone, watch] of this.watches) phone.emit('limits.changed', { sessionId: watch.sessionId, limit: this.options.limit(watch.sessionId) });
  }

  /** The app shows another theme (every window sends it; only a change reaches the phones). */
  setTheme(theme: RemoteTheme): void {
    if (JSON.stringify(theme) === JSON.stringify(this.theme)) return;
    this.theme = theme;
    this.options.appState.set(THEME_KEY, theme);
    if (this.server.listening) this.server.each((rpc) => rpc.emit('theme.changed', theme));
  }

  /** A profile's plan usage changed: every phone hears it, for its Home. */
  usageChanged(profileId: string, usage: UsageSnapshot | null): void {
    if (!this.server.listening || !this.options.profiles().profiles.some((p) => p.id === profileId)) return;
    this.server.each((rpc) => rpc.emit('usage.changed', { profileId, usage }));
  }

  /** A session's catch-up changed: phones watching it get the new one, and a finished turn's push goes out with it. */
  catchUpChanged(sessionId: string, card: CatchUp | null): void {
    if (card && this.finishing.has(sessionId)) this.sendFinished(sessionId);
    for (const [phone, watch] of this.watches) if (watch.sessionId === sessionId) phone.emit('catchup.changed', { sessionId, catchUp: remoteCatchUp(card) });
  }

  /** A prompt opened: paired phones that want it get a push. */
  permissionAsked(request: PermissionRequest): void {
    const session = this.list().sessions.find((s) => s.id === request.sessionId);
    if (!session) return;
    this.push({ kind: 'needs-you', sessionId: session.id, title: session.title, project: session.projectName, ...profileOf(session), line: needsYouLine(request), ...promptAnswers(request) });
  }

  /** A session's process changed state: a turn that ended sends its push once the catch-up is in (or soon without). */
  hostChanged(info: SessionHostInfo): void {
    if (!this.turnEnds.ended(info.sessionId, info.state)) return;
    clearTimeout(this.finishing.get(info.sessionId));
    const timer = setTimeout(() => this.sendFinished(info.sessionId), this.options.catchUpWaitMs ?? CATCH_UP_WAIT_MS);
    timer.unref?.();
    this.finishing.set(info.sessionId, timer);
  }

  /**
   * A pipeline run waits for you without a session asking (Wait for me, Push), stopped, or is done: paired phones that
   * want it get a push, as the computer's notification. A tap opens the step's sub-session, the parent, or the run row.
   */
  runNotice(notice: PipelineNotice): void {
    const state = this.options.pipelines?.runs().find((r) => r.run.id === notice.runId);
    if (!state) return;
    const project = this.projectName(state.run.projectRoot);
    const sessionId = notice.sessionId ?? notice.runId;
    if (notice.kind === 'needsYou') this.push({ kind: 'needs-you', sessionId, title: notice.title, project, line: notice.body });
    else this.push({ kind: 'finished', sessionId, title: notice.kind === 'stopped' ? `${notice.title}: the run stopped` : notice.title, project, line: notice.body });
  }

  stop(): void {
    this.generation++;
    for (const timer of this.finishing.values()) clearTimeout(timer);
    this.finishing.clear();
    clearTimeout(this.changeTimer);
    this.pairing.cancel();
    this.stopListening();
  }

  // --- Listening ------------------------------------------------------------------------------------------------

  /** One change at a time: the switch can be flipped faster than the server starts. */
  private apply(): Promise<void> {
    // A tunnel still starting is stopped now, not after it gave its address: turning Remote off works at once.
    if (this.tunnelState.state === 'starting') {
      this.generation++;
      this.tunnel?.stop();
    }
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
        this.problem = { kind: 'failed', message: "Seshboard can't keep Remote's key in this computer's keychain." };
        return this.statusChanged();
      }
      this.identity = keyPairFromSecret(secret);
    }
    try {
      await this.server.start(port);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      this.problem = code === 'EADDRINUSE' ? { kind: 'port-in-use', port, suggestedPort: await nextFreePort(port) } : { kind: 'failed', message: (error as Error).message };
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
      // Your own tunnel or proxy: Seshboard only needs to know the address it forwards from.
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
    this.visible.clear();
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

  // --- Push ---------------------------------------------------------------------------------------------------------

  private vapid(): VapidKeys {
    const saved = this.options.appState.get(VAPID_KEY) as Partial<VapidKeys> | null;
    if (typeof saved?.publicKey === 'string' && typeof saved.privateKey === 'string') return { publicKey: saved.publicKey, privateKey: saved.privateKey };
    const keys = generateVapidKeys();
    this.options.appState.set(VAPID_KEY, keys);
    return keys;
  }

  private pushEntries(): PushEntry[] {
    const saved = this.options.appState.get(PUSH_KEY);
    return Array.isArray(saved) ? (saved as unknown as PushEntry[]) : [];
  }

  private setPush(deviceId: string, entry: Omit<PushEntry, 'deviceId'> | null): void {
    const rest = this.pushEntries().filter((e) => e.deviceId !== deviceId);
    if (!entry && rest.length === this.pushEntries().length) return;
    this.options.appState.set(PUSH_KEY, entry ? [...rest, { deviceId, ...entry }] : rest);
  }

  private sendFinished(sessionId: string): void {
    clearTimeout(this.finishing.get(sessionId));
    this.finishing.delete(sessionId);
    const session = this.list().sessions.find((s) => s.id === sessionId);
    if (!session) return;
    // A turn that ends in a step of a run that goes on is the run's news: it says when it needs you, stops or is done.
    if (this.options.pipelines?.runs().some(({ run, steps }) => run.status !== 'done' && run.status !== 'stopped' && steps.some((s) => s.sessionId === sessionId))) return;
    this.push({ kind: 'finished', sessionId, title: session.title, project: session.projectName, ...profileOf(session), line: finishedLine(this.options.catchUp(sessionId)) });
  }

  /**
   * Sends a push to every device that wants this kind and doesn't have the app on screen. A subscription the push
   * service says is gone is forgotten.
   */
  private push(payload: PushPayload): void {
    if (!this.settings.enabled) return;
    const entries = this.pushEntries();
    if (!entries.length) return;
    const known = new Set(this.devices.list().map((d) => d.id));
    const targets = pushTargets(entries, payload.kind, new Set(this.visible.values()), known);
    if (!targets.length) return;
    // At most 32 characters: a newer push about the same session replaces one the phone hasn't had yet.
    const topic = createHash('sha256').update(`${payload.kind}:${payload.sessionId}`).digest('base64url').slice(0, 32);
    for (const target of targets) {
      // The device id tells a phone paired with more than one computer which one it came from.
      const body: PushPayload = { ...payload, deviceId: target.deviceId, ...(target.label ? { computer: target.label } : {}) };
      void sendPush(target.subscription, body, { keys: target.vapid ?? this.vapid(), subject: new URL(this.appUrl).origin, urgent: payload.kind === 'needs-you', topic, ...(this.options.pushFetch ? { fetch: this.options.pushFetch } : {}) }).then(
        (result) => {
          if (result === 'gone') this.setPush(target.deviceId, null);
          if (result === 'failed') this.options.log('warn', `Remote: a push service refused a notification`);
        },
        (error: Error) => this.options.log('warn', `Remote: couldn't reach the push service: ${error.message}`),
      );
    }
  }

  // --- What a phone may do --------------------------------------------------------------------------------------

  private list(): RemoteSessions {
    const projectNames = new Map(this.options.projects().map((p) => [p.root, p.name]));
    const runs = this.options.pipelines?.runs();
    return remoteSessions(this.options.sources(), { archiveAfterDays: this.options.archiveAfterDays(), scope: this.options.scope(), projectNames, profiles: this.options.profiles().profiles, ...(runs ? { runs } : {}) });
  }

  private projectName(root: string): string {
    return this.options.projects().find((p) => p.root === root)?.name ?? lastSegment(root);
  }

  private requirePipelines(): RemotePipelines {
    if (!this.options.pipelines) throw new RpcError('NOT_FOUND', 'Pipelines are not on this computer');
    return this.options.pipelines;
  }

  /** A phone may only touch the runs its list has. */
  private checkRun(runId: string): RemoteRunState {
    const state = this.list().runs?.find((r) => r.run.id === runId);
    if (!state) throw new RpcError('NOT_FOUND', 'No such run');
    return state;
  }

  /** A run for the phone after one of its buttons, as its list will have it. */
  private toRemote(state: PipelineRunState): RemoteRunState {
    this.sessionsChanged();
    return remoteRun(state, new Map(this.options.projects().map((p) => [p.root, p.name])));
  }

  /** Any project the computer knows by its id (the ones you added, and the folders sessions ran in), for a session's runs. */
  private knownProject(projectId: string): RemoteProject {
    const project = this.options.projects().find((p) => projectIdOf(p.root) === projectId);
    if (!project) throw new RpcError('NOT_FOUND', 'No such project');
    return project;
  }

  /** The projects New session offers, as the app's own list: the ones you added that still exist, in your order. */
  private yourProjects(): RemoteProject[] {
    return this.options
      .projects()
      .filter((p) => p.added && p.exists)
      .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.name.localeCompare(b.name));
  }

  private project(projectId: string): RemoteProject {
    const project = this.yourProjects().find((p) => projectIdOf(p.root) === projectId);
    if (!project) throw new RpcError('NOT_FOUND', 'No such project');
    return project;
  }

  /** The profile a new session in `project` runs with: the one the phone chose, else the project's, else the default. */
  private profileFor(project: RemoteProject, chosen: string | undefined): RemoteHubProfile {
    const { profiles, defaultId } = this.options.profiles();
    const find = (id: string | null | undefined) => (id ? profiles.find((p) => p.id === id) : undefined);
    if (chosen && !find(chosen)) throw new RpcError('NOT_FOUND', 'That Claude profile no longer exists');
    const profile = find(chosen) ?? find(project.profileId) ?? find(defaultId) ?? profiles[0];
    if (!profile) throw new RpcError('NOT_FOUND', 'No Claude profile');
    return profile;
  }

  /**
   * The phone's choice, after checking a branch to check out is one of the folder's own: git would also take a
   * remote branch, or a name that isn't one.
   */
  private async choiceFor(project: RemoteProject, options: RemoteSessionOptions): Promise<SessionChoice> {
    const choice = sessionChoice(options, project.defaults, this.profileFor(project, options.profileId), this.options.globalPermissionMode());
    const branch = choice.checkoutBranch;
    if (branch === null) return choice;
    if (choice.worktree) throw new RpcError('INVALID_PARAMS', 'A new worktree gets its own branch; choose the current checkout to check out a branch');
    const { branches, checkedOutElsewhere } = await this.options.branches(project.root);
    if (!branches.includes(branch)) throw new RpcError('NOT_FOUND', `No branch ${branch} in ${project.name}`);
    if (checkedOutElsewhere.includes(branch)) throw new RpcError('INVALID_PARAMS', `${branch} is checked out in another worktree`);
    return choice;
  }

  /** A phone may only touch the sessions it can see in its list. */
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
      'projects.branches': ({ projectId }) => this.options.branches(this.project(projectId).root),
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
        phone.emit('upNext.changed', { sessionId, queue: this.options.upNext(sessionId) });
        phone.emit('limits.changed', { sessionId, limit: this.options.limit(sessionId) });
        return {};
      },
      'transcript.unwatch': ({ sessionId }, phone) => {
        if (this.watches.get(phone)?.sessionId === sessionId) unwatch(phone);
        return {};
      },
      'session.send': async ({ sessionId, text, mode, images, files }) => {
        this.checkSession(sessionId);
        checkAttachments(images, files);
        const prompt = promptWithFiles(text, saveRemoteFiles(this.options.filesDir, files));
        // A run's parent: what you write links the run, so Claude gets its brief first, as on the computer. After the
        // stubs the phone typed were defused: this one is the computer's own.
        const parentRun = this.options.pipelines ? runOfParent(this.options.pipelines.runs(), sessionId) : null;
        const linked = parentRun?.run.parentSessionId === sessionId ? withRunStub(prompt, parentRun.run) : prompt;
        const sent = await this.options.send(sessionId, linked, mode, images);
        if (!sent.queued) label(sessionId, sent.messageUuid);
        this.options.onFromDevice?.({ sessionId, messageUuid: sent.queued ? null : sent.messageUuid, requestId: null, device: device.name, deviceId: device.id, answer: null });
        return { queued: sent.queued };
      },
      'session.queue.remove': ({ sessionId, id }, phone) => {
        this.checkSession(sessionId);
        this.options.dequeue(sessionId, id);
        // Already sent while this phone was away: nothing changed, so no update comes; this one sets its list right.
        phone.emit('upNext.changed', { sessionId, queue: this.options.upNext(sessionId) });
        return {};
      },
      'session.queue.sendNow': async ({ sessionId, id }) => {
        this.checkSession(sessionId);
        await this.options.sendQueuedNow(sessionId, id);
        return {};
      },
      'session.interrupt': async ({ sessionId }) => {
        this.checkSession(sessionId);
        await this.options.interrupt(sessionId);
        return {};
      },
      'session.stopTask': async ({ sessionId, taskId }) => {
        // Only a task the list shows: a phone can't stop what it was never told about.
        if (!this.list().sessions.find((s) => s.id === sessionId)?.background?.some((t) => t.taskId === taskId)) throw new RpcError('NOT_FOUND', 'That task is no longer running');
        await this.options.stopTask(sessionId, taskId);
        return {};
      },
      'session.respond': ({ requestId, decision }) => {
        const prompt = this.list().prompts.find((p) => p.requestId === requestId);
        if (!prompt) throw new RpcError('NOT_FOUND', 'That was already answered');
        this.options.respond(requestId, decision);
        this.options.onFromDevice?.({ sessionId: prompt.sessionId, messageUuid: null, requestId, device: device.name, deviceId: device.id, answer: { toolName: prompt.toolName, allowed: decision.behavior === 'allow' } });
        return {};
      },
      'session.create': async ({ projectId, prompt, images, files, ...options }) => {
        const project = this.project(projectId);
        checkAttachments(images, files);
        const choice = await this.choiceFor(project, options);
        const created = await this.options.create(project.root, promptWithFiles(prompt, saveRemoteFiles(this.options.filesDir, files)), choice, images);
        // Its first prompt: the sidebar's last action for the device.
        this.options.onFromDevice?.({ sessionId: created.sessionId, messageUuid: null, requestId: null, device: device.name, deviceId: device.id, answer: null });
        return created;
      },
      'pipelines.list': ({ projectId }) => {
        const pipelines = this.requirePipelines().list(this.knownProject(projectId).root);
        return { pipelines: pipelines.map(({ scope: _scope, ...pipeline }) => pipeline) };
      },
      'pipelines.run': async ({ pipelineId, parentSessionId, projectId, task, images, files, profileId, model, effort, permissionMode }) => {
        const pipelines = this.requirePipelines();
        let root: string;
        if (parentSessionId) {
          this.checkSession(parentSessionId);
          root = this.knownProject(this.list().sessions.find((s) => s.id === parentSessionId)!.projectId).root;
        } else {
          // New session's projects: only the ones you added, as `session.create`.
          root = this.project(projectId!).root;
        }
        // Only a pipeline that project can run there: one the phone was offered.
        if (!pipelines.list(root).some((p) => p.id === pipelineId)) throw new RpcError('NOT_FOUND', 'That pipeline was deleted');
        checkAttachments(images, files);
        const profile = parentSessionId || !profileId ? null : this.profileFor(this.project(projectId!), profileId).id;
        const choices: RunChoices | null = parentSessionId || (model === undefined && effort === undefined && permissionMode === undefined) ? null : { model: model ?? null, effort: effort ?? null, permissionMode: permissionMode ?? null };
        const state = await pipelines.run({
          pipelineId,
          parentSessionId: parentSessionId ?? null,
          task: task ? promptWithFiles(task, saveRemoteFiles(this.options.filesDir, files)) : null,
          attachments: images,
          projectRoot: parentSessionId ? null : root,
          profileId: profile,
          choices,
        });
        this.options.log('info', `Remote: ${device.name} ran the pipeline ${state.run.pipeline.name}`);
        return { state: this.toRemote(state) };
      },
      'runs.continue': async ({ runId, message }) => {
        const before = this.checkRun(runId);
        const state = await this.requirePipelines().act('continue', runId, message ?? null);
        if (before.run.waitingFor === 'push') this.options.log('info', `Remote: ${device.name} pushed the run ${runId}`);
        return { state: this.toRemote(state) };
      },
      'runs.retryStep': async ({ runId }) => {
        this.checkRun(runId);
        return { state: this.toRemote(await this.requirePipelines().act('retryStep', runId, null)) };
      },
      'runs.anotherRound': async ({ runId }) => {
        this.checkRun(runId);
        return { state: this.toRemote(await this.requirePipelines().act('anotherRound', runId, null)) };
      },
      'runs.skipStep': async ({ runId }) => {
        this.checkRun(runId);
        return { state: this.toRemote(await this.requirePipelines().act('skipStep', runId, null)) };
      },
      'runs.stop': async ({ runId }) => {
        this.checkRun(runId);
        return { state: this.toRemote(await this.requirePipelines().act('stop', runId, null)) };
      },
      'runs.archive': async ({ runId, archived }) => {
        // As for a session: an archived run row leaves the list, and the phone that archived it may take that back.
        const undo = !archived && Date.now() - (this.archivedFromPhone.get(runId) ?? -Infinity) < UNDO_ARCHIVE_MS;
        if (!undo) this.checkRun(runId);
        await this.requirePipelines().archive(runId, archived);
        if (archived) this.archivedFromPhone.set(runId, Date.now());
        else this.archivedFromPhone.delete(runId);
        this.sessionsChanged();
        return {};
      },
      'runs.pushPreview': async ({ runId, fresh }) => {
        this.checkRun(runId);
        return { preview: await this.requirePipelines().pushPreview(runId, fresh) };
      },
      'runs.write': async ({ runId, text }) => {
        const state = this.checkRun(runId);
        if (state.run.parentSessionId) throw new RpcError('INVALID', 'This run has a session already');
        const written = await this.requirePipelines().write(runId, defuseStubs(text));
        this.options.onFromDevice?.({ sessionId: written.sessionId, messageUuid: null, requestId: null, device: device.name, deviceId: device.id, answer: null });
        this.sessionsChanged();
        return written;
      },
      'projects.clonePlan': ({ url, name }) => this.options.clonePlan(url, name),
      'projects.clone': async ({ jobId, url, name }, phone) => {
        // Job ids are the device's own: another device can't cancel or hear this one.
        await this.options.clone(`remote:${device.id}:${jobId}`, url, name, ({ root, ...progress }) => {
          phone.emit('projects.cloneProgress', { ...progress, jobId, projectId: root ? projectIdOf(root) : null });
        });
        return {};
      },
      'projects.cancelClone': ({ jobId }) => {
        this.options.cancelClone(`remote:${device.id}:${jobId}`);
        return {};
      },
      'later.add': async ({ projectId, prompt, ...options }) => {
        const project = this.project(projectId);
        return this.options.queue(project.root, defuseStubs(prompt), await this.choiceFor(project, options));
      },
      'session.markRead': ({ sessionId }) => {
        this.checkSession(sessionId);
        this.options.markRead(sessionId);
        this.sessionsChanged();
        return {};
      },
      'session.markUnread': ({ sessionId }) => {
        this.checkSession(sessionId);
        this.options.markUnread(sessionId);
        this.sessionsChanged();
        return {};
      },
      'session.setFlags': ({ sessionId, pinned, archived }) => {
        const undo = archived === false && pinned === undefined && Date.now() - (this.archivedFromPhone.get(sessionId) ?? -Infinity) < UNDO_ARCHIVE_MS;
        if (!undo) this.checkSession(sessionId);
        if (archived === true) this.archivedFromPhone.set(sessionId, Date.now());
        else if (archived === false) this.archivedFromPhone.delete(sessionId);
        this.options.setFlags(sessionId, { ...(pinned !== undefined ? { pinned } : {}), ...(archived !== undefined ? { archived } : {}) });
        this.sessionsChanged();
        return {};
      },
      'session.setModel': async ({ sessionId, model }) => {
        this.checkSession(sessionId);
        await this.options.setModel(sessionId, model);
        this.sessionsChanged();
        return {};
      },
      'session.setEffort': async ({ sessionId, effort }) => {
        this.checkSession(sessionId);
        await this.options.setEffort(sessionId, effort);
        this.sessionsChanged();
        return {};
      },
      'session.setPermissionMode': async ({ sessionId, mode }) => {
        this.checkSession(sessionId);
        await this.options.setPermissionMode(sessionId, mode);
        this.sessionsChanged();
        return {};
      },
      'options.get': () => {
        const { profiles, defaultId } = this.options.profiles();
        const globalMode = this.options.globalPermissionMode();
        return {
          models: this.options.models().map(({ value, displayName, description, supportsEffort }) => ({ value, displayName, description, supportsEffort })),
          efforts: [...Effort.options],
          modes: ['default', 'acceptEdits', 'plan', 'auto'],
          profiles: profiles.map((p) => ({ id: p.id, name: p.name, color: p.color, defaults: remoteDefaults(p.defaults, globalMode) })),
          defaultProfileId: defaultId,
          auto: this.options.autoModel(),
          projects: this.yourProjects().map((p) => ({
            id: projectIdOf(p.root),
            profileId: p.profileId && profiles.some((profile) => profile.id === p.profileId) ? p.profileId : null,
            defaults: remoteDefaults(p.defaults, p.defaults.globalPermissionMode ? globalMode : null),
          })),
        };
      },
      'usage.get': async ({ refresh }) => {
        const { profiles, defaultId } = this.options.profiles();
        const ordered = [...profiles].sort((a, b) => Number(b.id === defaultId) - Number(a.id === defaultId));
        return {
          profiles: await Promise.all(
            ordered.map(async (p) => {
              const result = await this.options.usage(p.id, refresh).catch((error: Error) => ({ usage: null, error: error.message }));
              return { profile: { id: p.id, name: p.name, color: p.color }, ...result, account: p.account ?? null };
            }),
          ),
        };
      },
      'usage.tokens': ({ account, ...params }) => {
        const breakdown = this.options.tokens(account, params);
        return { breakdown: breakdown && remoteUsage(breakdown, new Map(this.options.projects().map((p) => [p.root, p.name]))) };
      },
      'limits.get': ({ sessionId }) => {
        this.checkSession(sessionId);
        return { limit: this.options.limit(sessionId) };
      },
      'limits.resume': async ({ sessionId }) => {
        this.checkSession(sessionId);
        await this.options.resumeLimit(sessionId);
        return {};
      },
      'limits.arm': ({ sessionId, armed }) => {
        this.checkSession(sessionId);
        this.options.armLimit(sessionId, armed);
        return {};
      },
      'usage.sessionCost': ({ sessionId }) => {
        this.checkSession(sessionId);
        return { cost: this.options.sessionCost(sessionId) };
      },
      'usage.windowCosts': ({ account, windows }) => ({ windows: this.options.windowCosts(account, windows) }),
      'session.ask': ({ sessionId, question, threadId, replaces }, phone) => {
        this.checkSession(sessionId);
        const asked = this.options.ask(sessionId, question, threadId, replaces);
        // The answer starts after this returns, and follows this phone wherever it goes in the app.
        this.askedBy.set(asked.id, new Set([phone]));
        phone.onDispose(() => this.askedBy.get(asked.id)?.delete(phone));
        return asked;
      },
      'session.askThreads': ({ sessionId }) => {
        this.checkSession(sessionId);
        return this.options.askThreads(sessionId);
      },
      'catchup.get': ({ sessionId }) => {
        this.checkSession(sessionId);
        return { catchUp: remoteCatchUp(this.options.catchUp(sessionId)) };
      },
      'changes.get': async ({ sessionId }) => {
        this.checkSession(sessionId);
        const changes = await this.options.changes(sessionId);
        if (!changes) return { branch: null, files: [], error: 'This session has no folder.' };
        return { branch: changes.branch, error: changes.error, files: changes.files.map(({ path, status, additions, deletions }) => ({ path, status, additions, deletions })) };
      },
      'changes.diff': async ({ sessionId, path }) => {
        this.checkSession(sessionId);
        // Only a file the list shows: the path comes from the phone, so it may not name anything else.
        const listed = (await this.options.changes(sessionId))?.files.some((f) => f.path === path);
        if (!listed) throw new RpcError('NOT_FOUND', 'That file has no changes');
        return capDiff(await this.options.diff(sessionId, path), REMOTE_DIFF_LINES);
      },
      'push.key': () => ({ publicKey: this.vapid().publicKey }),
      'push.subscribe': ({ subscription, needsYou, finished, vapid, label }) => {
        // Only the browsers' push services: a phone can't make the engine send requests anywhere else.
        if (!isPushEndpoint(subscription.endpoint)) throw new RpcError('INVALID_PARAMS', 'Not a push service this app knows');
        if (vapid && !validVapidKeys(vapid)) throw new RpcError('INVALID_PARAMS', 'Not a VAPID key pair');
        this.setPush(device.id, { subscription, needsYou, finished, ...(vapid ? { vapid } : {}), ...(label ? { label } : {}) });
        return {};
      },
      'push.unsubscribe': () => {
        this.setPush(device.id, null);
        return {};
      },
      'theme.get': () => ({ theme: this.theme }),
      'device.visibility': ({ visible }, phone) => {
        if (!this.visible.has(phone) && visible) phone.onDispose(() => this.visible.delete(phone));
        if (visible) this.visible.set(phone, device.id);
        else this.visible.delete(phone);
        return {};
      },
      'changes.commit': async ({ sessionId, message }) => {
        this.checkSession(sessionId);
        const result = await this.options.commit(sessionId, message);
        if (result.ok) this.options.log('info', `Remote: ${device.name} committed ${result.sha.slice(0, 7)} in session ${sessionId}`);
        return result;
      },
    };
  }
}

/** A push names the session's profile only when there is more than one (the list leaves it out with one). */
const profileOf = (session: RemoteSession): { profile?: string } => (session.profile ? { profile: session.profile.name } : {});

/** How long a phone may unarchive a session it archived (Undo), after it left its list. */
const UNDO_ARCHIVE_MS = 10 * 60_000;
