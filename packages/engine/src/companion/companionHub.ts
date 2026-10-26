import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  RpcError,
  type CompanionContract,
  type CompanionSessions,
  type Contract,
  type HandlerContext,
  type PermissionDecision,
} from '@seshboard/protocol';
import { CompanionServer } from './companionServer.ts';
import { companionSessions, promptsFor, sessionsFor, type ListingOptions, type SessionSources } from './companionSessions.ts';

type SessionScope = NonNullable<ListingOptions['scope']>;

export interface CompanionHubOptions {
  infoDir: string;
  /** See `CompanionServerOptions.legacyInfoDir`. */
  legacyInfoDir?: string;
  appVersion: string;
  /** Everything the engine knows about sessions right now. */
  sources(): SessionSources;
  /** Settings › Sessions: the archive days, so the editor lists what the sidebar lists. */
  archiveAfterDays(): number;
  /** Seshboard windows attached to the engine. */
  windows(): number;
  /** Answers a permission prompt, question or plan (throws NOT_FOUND when it was already answered). */
  respond(requestId: string, decision: PermissionDecision, acceptEdits: boolean): void | Promise<void>;
  log(level: 'info' | 'warn' | 'error', message: string): void;
  socketParent?: string;
  /** How long a window may take to add context before `context.add` fails (default 10 s). */
  deliveryTimeoutMs?: number;
}

interface Delivery {
  resolve(): void;
  reject(error: RpcError): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * The VS Code companion, engine side: answers the extension over the socket and hands the context it sends to the
 * Seshboard window that reported focus last, which adds it as chips and confirms. Windows tell it which session
 * is on screen (`companion.focus`); the extension asks for that to send context there first.
 */
export class CompanionHub {
  private readonly server: CompanionServer;
  /** Windows that reported focus, the most recent last, with the session each has on screen and its sidebar's scope. */
  private readonly windowFocus: Array<{ context: HandlerContext<Contract>; sessionId: string | null; scope: SessionScope }> = [];
  private readonly deliveries = new Map<string, Delivery>();
  /** What each watching editor last got, by its folders. */
  private readonly watchers = new Map<HandlerContext<CompanionContract>, { folders: string[]; last: string }>();
  private changeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: CompanionHubOptions) {
    this.server = new CompanionServer({
      infoDir: options.infoDir,
      ...(options.legacyInfoDir ? { legacyInfoDir: options.legacyInfoDir } : {}),
      appVersion: options.appVersion,
      log: options.log,
      ...(options.socketParent ? { socketParent: options.socketParent } : {}),
      handlers: {
        'sessions.list': ({ folders, limit }) => this.list(folders, limit),
        'sessions.watch': ({ folders }, context) => {
          if (!this.watchers.has(context)) context.onDispose(() => this.watchers.delete(context));
          const snapshot = this.list(folders, 50);
          this.watchers.set(context, { folders, last: JSON.stringify(snapshot) });
          return {};
        },
        'context.add': ({ target, items, reveal }) => {
          const window = this.focusWindow();
          if (target.kind === 'session' && !this.knows(target.sessionId)) throw new RpcError('NOT_FOUND', 'Seshboard has no session with that id');
          if (target.kind === 'new' && !existsSync(target.cwd)) throw new RpcError('NOT_FOUND', `Folder not found: ${target.cwd}`);
          const deliveryId = randomUUID();
          const delivered = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              this.deliveries.delete(deliveryId);
              reject(new RpcError('TIMEOUT', 'Seshboard did not add the context in time'));
            }, this.options.deliveryTimeoutMs ?? 10_000);
            this.deliveries.set(deliveryId, { resolve, reject, timer });
          });
          window.emit('companion.context', { deliveryId, target, items, reveal });
          return delivered.then(() => ({}));
        },
        'session.reveal': ({ sessionId }) => {
          if (!this.knows(sessionId)) throw new RpcError('NOT_FOUND', 'Seshboard has no session with that id');
          this.focusWindow().emit('companion.reveal', { sessionId });
          return {};
        },
        'prompt.respond': async ({ requestId, decision, acceptEdits }) => {
          await this.options.respond(requestId, decision, acceptEdits);
          return {};
        },
      },
    });
  }

  start(): Promise<void> {
    return this.server.start();
  }

  stop(): void {
    clearTimeout(this.changeTimer);
    for (const [id, delivery] of this.deliveries) {
      clearTimeout(delivery.timer);
      delivery.reject(new RpcError('DISCONNECTED', 'Seshboard is quitting'));
      this.deliveries.delete(id);
    }
    this.server.stop();
  }

  status() {
    return { listening: this.server.listening, clients: this.server.clients, error: this.server.error };
  }

  get infoFile(): string {
    return this.server.infoFile;
  }

  /** A window says which session is on screen in its active pane (null: none), and which sessions its sidebar lists. */
  focus(context: HandlerContext<Contract>, sessionId: string | null, scope: SessionScope): void {
    const index = this.windowFocus.findIndex((w) => w.context === context);
    if (index === -1) context.onDispose(() => this.forget(context));
    else this.windowFocus.splice(index, 1);
    this.windowFocus.push({ context, sessionId, scope });
    this.sessionsChanged();
  }

  /** A window added (or couldn't add) the context of a delivery. */
  received(deliveryId: string, error: string | null): void {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery) return;
    this.deliveries.delete(deliveryId);
    clearTimeout(delivery.timer);
    if (error) delivery.reject(new RpcError('NOT_ADDED', error));
    else delivery.resolve();
  }

  /** Sessions changed somewhere (a transcript, a process, a host): watching editors hear about it shortly. */
  sessionsChanged(): void {
    if (this.changeTimer || this.watchers.size === 0) return;
    this.changeTimer = setTimeout(() => {
      this.changeTimer = undefined;
      for (const [context, watch] of this.watchers) {
        const snapshot = this.list(watch.folders, 50);
        const json = JSON.stringify(snapshot);
        if (json === watch.last) continue;
        watch.last = json;
        context.emit('sessions.changed', snapshot);
      }
    }, 300);
    this.changeTimer.unref?.();
  }

  private list(folders: string[], limit: number): CompanionSessions {
    // The editor lists what the sidebar of the window that reported focus last lists.
    const window = this.windowFocus.at(-1);
    const focusedId = window?.sessionId ?? null;
    const sources = this.options.sources();
    const all = companionSessions(sources, { keep: focusedId, scope: window?.scope ?? 'switchboard', archiveAfterDays: this.options.archiveAfterDays() });
    const sessions = sessionsFor(all, folders, limit);
    return {
      sessions,
      focused: (focusedId && all.find((s) => s.id === focusedId)) || null,
      windows: this.options.windows(),
      prompts: promptsFor(sources.permissions ?? [], sessions),
    };
  }

  private knows(sessionId: string): boolean {
    const { summaries, live, hosts } = this.options.sources();
    return summaries.some((s) => s.id === sessionId) || live.some((l) => l.sessionId === sessionId) || hosts.some((h) => h.sessionId === sessionId);
  }

  /** The window context goes to: the one that reported focus last. */
  private focusWindow(): HandlerContext<Contract> {
    const window = this.windowFocus.at(-1)?.context;
    if (!window) throw new RpcError('NO_WINDOW', 'Seshboard has no window open');
    return window;
  }

  private forget(context: HandlerContext<Contract>): void {
    const index = this.windowFocus.findIndex((w) => w.context === context);
    if (index !== -1) this.windowFocus.splice(index, 1);
  }
}
