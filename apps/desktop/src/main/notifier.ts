import { app, MessageChannelMain, Notification, type BrowserWindow } from 'electron';
import { createRpcClient, type Contract, type LaterItem, type QueueStarted, type RpcClient } from '@switchboard/protocol/client';
import { mainPortTransport } from '../shared/mainPortTransport.ts';
import { Attention, type AttentionEvent } from './attention.ts';
import type { EngineProcess } from './engineProcess.ts';
import { queueHint } from './queueHint.ts';

export interface NotifierOptions {
  engine: EngineProcess;
  window: () => BrowserWindow | undefined;
  /** The session the user is looking at (reported by the renderer). */
  focusedSession: () => string | null;
  openSession: (sessionId: string) => void;
  /** Settings → Show sessions from other apps. */
  showAllSessions: () => boolean;
  /** Smoke tests record events (and whether they'd be suppressed) instead of showing notifications. */
  record?: (event: AttentionEvent & { suppressed: boolean }) => void;
}

/**
 * Main's own connection to the engine, so notifications and the dock badge
 * work even with the window closed.
 */
export class Notifier {
  private client: RpcClient<Contract> | undefined;
  private readonly attention: Attention;
  /** Notifications must be referenced until closed, or macOS drops their click handlers. */
  private readonly shown = new Set<Notification>();
  /** The queue, so a finished turn can say what is next there. */
  private queue: { items: LaterItem[]; started: QueueStarted[] } = { items: [], started: [] };

  constructor(private readonly options: NotifierOptions) {
    this.attention = new Attention({ external: options.showAllSessions });
  }

  /** (Re)connects; call again after the engine restarts. */
  connect(): void {
    this.client?.dispose();
    this.attention.reset();
    const { port1, port2 } = new MessageChannelMain();
    this.options.engine.connect(port1);
    const client = createRpcClient<Contract>(mainPortTransport(port2), { timeoutMs: 15_000 });
    this.client = client;

    client.on('sessions.changed', ({ upserted }) => upserted.forEach((s) => this.attention.setTitle(s.id, s.title)));
    client.on('session.host', (info) => this.handle(this.attention.onHost(info)));
    client.on('session.permission', (request) => this.handle(this.attention.onPermission(request)));
    client.on('session.permissionResolved', ({ requestId }) => {
      this.attention.onPermissionResolved(requestId);
      this.updateBadge();
    });
    client.on('sessions.live', ({ live }) => this.handle(this.attention.onLive(live)));
    client.on('terminals.changed', ({ terminals }) => this.handle(this.attention.onTerminals(terminals)));
    client.on('later.changed', (queue) => void (this.queue = queue));
    void client.call('later.list', {}).then((queue) => void (this.queue = queue), () => {});

    // Seed state silently: only changes from here on deserve a notification.
    void Promise.all([client.call('sessions.list', {}), client.call('hosts.list', {}), client.call('terminal.list', {})])
      .then(([sessions, hosts, terminals]) => {
        sessions.sessions.forEach((s) => this.attention.setTitle(s.id, s.title));
        hosts.hosts.forEach((h) => this.attention.onHost(h));
        hosts.permissions.forEach((p) => this.attention.onPermission(p));
        this.attention.onLive(sessions.live);
        this.attention.onTerminals(terminals.terminals);
        this.updateBadge();
      })
      .catch(() => {});
  }

  /** The sessions running in a Claude Code process right now (in Switchboard or anywhere else), and their folders, from the engine. */
  async runningSessions(): Promise<{ ids: Set<string>; folders: string[] }> {
    if (!this.client) return { ids: new Set(), folders: [] };
    const [{ live }, { hosts }] = await Promise.all([this.client.call('sessions.list', {}), this.client.call('hosts.list', {})]);
    return {
      ids: new Set([...live.map((l) => l.sessionId), ...hosts.map((h) => h.sessionId)]),
      folders: [...live.flatMap((l) => [l.cwd, l.projectRoot]), ...hosts.map((h) => h.cwd)].filter((folder): folder is string => !!folder),
    };
  }

  private handle(events: AttentionEvent[]): void {
    const win = this.options.window();
    const focused = !!win && win.isFocused() && !win.isMinimized();
    for (const event of events) {
      // Already looking at it: no need to interrupt.
      const suppressed = focused && this.options.focusedSession() === event.sessionId;
      if (this.options.record) {
        this.options.record({ ...event, suppressed });
        continue;
      }
      if (suppressed) continue;
      if (Notification.isSupported()) {
        // A finished turn says what is next in the queue there, rather than a second notification.
        const hint = event.kind === 'finished' ? queueHint(this.queue.items, this.queue.started, { sessionId: event.sessionId, cwd: event.cwd ?? null }) : null;
        const notification = new Notification({ title: event.title, body: hint ? `${event.body}\n${hint}` : event.body });
        notification.on('click', () => this.options.openSession(event.sessionId));
        notification.on('close', () => this.shown.delete(notification));
        this.shown.add(notification);
        notification.show();
      }
      if (event.kind === 'needs-you' && !focused) app.dock?.bounce('informational');
    }
    this.updateBadge();
  }

  private updateBadge(): void {
    const count = this.attention.badge();
    app.dock?.setBadge(count > 0 ? String(count) : '');
  }
}
