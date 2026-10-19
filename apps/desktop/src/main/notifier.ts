import { app, MessageChannelMain, nativeImage, Notification, type BrowserWindow, type NativeImage } from 'electron';
import { resolveSound } from '@switchboard/protocol/bridge';
import { createRpcClient, promptLabel, type Contract, type LaterItem, type QueueAuto, type QueueStarted, type RpcClient } from '@switchboard/protocol/client';
import { mainPortTransport } from '../shared/mainPortTransport.ts';
import { alertFor, louder, type Alert, type AlertPrefs } from './alerts.ts';
import { Attention, type AttentionEvent } from './attention.ts';
import { CacheReminder, REMIND_BEFORE_MS, type CacheReminderPrefs } from './cacheReminder.ts';
import type { EngineProcess } from './engineProcess.ts';
import { queueHint } from './queueHint.ts';
import type { SoundPlayer } from './sounds.ts';
import { badgeDescription, badgeDotBitmap } from './taskbarBadge.ts';

/** A recorded event: whether it was for the session on screen, and what it did with the settings at the time. */
export type RecordedAlert = AttentionEvent & { suppressed: boolean } & Alert;

export interface NotifierOptions {
  engine: EngineProcess;
  /** The main window: its taskbar button flashes, and carries the badge on Windows. */
  window: () => BrowserWindow | undefined;
  /** A Switchboard window (the main one or a pop-out) is in front and not minimized. */
  focused: () => boolean;
  /** The session the user is looking at in the window in front (reported by its renderer). */
  focusedSession: () => string | null;
  openSession: (sessionId: string) => void;
  /** Settings → Show sessions from other apps. */
  showAllSessions: () => boolean;
  /** Settings › Notifications: notifications on or off, and the sounds. */
  alerts: () => AlertPrefs;
  /** Settings › Usage: Large context, and how a cost reads. */
  cachePrefs: () => CacheReminderPrefs;
  sounds: SoundPlayer;
  /** Smoke tests record events (whether they'd be suppressed, and what they'd do) instead of showing notifications. */
  record?: (event: RecordedAlert) => void;
}

/**
 * Main's own connection to the engine, so notifications and the badge (Dock or taskbar)
 * work even with the window closed.
 */
export class Notifier {
  private client: RpcClient<Contract> | undefined;
  private readonly attention: Attention;
  /** Notifications must be referenced until closed, or macOS drops their click handlers. */
  private readonly shown = new Set<Notification>();
  /** The dot over the taskbar button on Windows, made once. */
  private dot: NativeImage | undefined;
  /** The queue, so a finished turn can say what is next there. */
  private queue: { items: LaterItem[]; started: QueueStarted[]; auto: QueueAuto } = { items: [], started: [], auto: { outcomes: [], focusHeld: [] } };
  /** Reminds you before a large session's cache lapses (Settings › Usage). */
  private readonly cache: CacheReminder;

  constructor(private readonly options: NotifierOptions) {
    this.attention = new Attention({ external: options.showAllSessions });
    this.cache = new CacheReminder({
      prefs: options.cachePrefs,
      remind: ({ sessionId, tokens, cost }) =>
        this.handle([
          {
            kind: 'cache-expiring',
            sessionId,
            title: `Cache expires in ${REMIND_BEFORE_MS / 60_000} minutes`,
            body: `${this.attention.label(sessionId, null)}: after that, your next message re-reads its ${tokens} tokens of context${cost ? ` (${cost})` : ''}.`,
          },
        ]),
    });
  }

  /** Settings changed: the cache reminder may be due sooner or not at all. */
  prefsChanged(): void {
    this.cache.prefsChanged();
  }

  /** (Re)connects; call again after the engine restarts. */
  connect(): void {
    this.client?.dispose();
    this.attention.reset();
    this.cache.reset();
    const { port1, port2 } = new MessageChannelMain();
    this.options.engine.connect(port1);
    const client = createRpcClient<Contract>(mainPortTransport(port2), { timeoutMs: 15_000 });
    this.client = client;

    client.on('sessions.changed', ({ upserted }) => upserted.forEach((s) => this.attention.setTitle(s.id, s.title)));
    client.on('session.host', (info) => {
      this.handle(this.attention.onHost(info));
      this.cache.onHost(info);
    });
    client.on('session.permission', (request) => this.handle(this.attention.onPermission(request)));
    client.on('session.permissionResolved', ({ requestId }) => {
      this.attention.onPermissionResolved(requestId);
      this.updateBadge();
    });
    client.on('sessions.live', ({ live }) => this.handle(this.attention.onLive(live)));
    client.on('terminals.changed', ({ terminals }) => this.handle(this.attention.onTerminals(terminals)));
    client.on('limits.resumed', ({ sessionId }) => this.handle(this.attention.onResumed(sessionId)));
    client.on('git.checksFinished', (event) => this.handle(this.attention.onChecksFinished(event)));
    client.on('later.changed', (queue) => void (this.queue = queue));
    // Queued items that start by themselves: the engine started one, or one didn't start after an error or a stop.
    client.on('later.autoStarted', ({ sessionId, prompt, projectName }) =>
      this.handle([{ kind: 'queue-started', sessionId, title: `Started: ${promptLabel(prompt, 80)}`, body: projectName }]),
    );
    client.on('later.autoSkipped', ({ prompt, sessionId, title, outcome }) =>
      this.handle([
        {
          kind: 'queue-skipped',
          // A click opens the session that didn't finish cleanly: that is what to look at first.
          sessionId,
          title: `“${promptLabel(prompt, 60)}” didn't start`,
          body: `“${promptLabel(title, 60)}” ${outcome === 'error' ? 'ended with an error' : 'was stopped'}.`,
        },
      ]),
    );
    void client.call('later.list', {}).then((queue) => void (this.queue = queue), () => {});

    // Seed state silently: only changes from here on deserve a notification.
    void Promise.all([client.call('sessions.list', {}), client.call('hosts.list', {}), client.call('terminal.list', {})])
      .then(([sessions, hosts, terminals]) => {
        sessions.sessions.forEach((s) => this.attention.setTitle(s.id, s.title));
        hosts.hosts.forEach((h) => {
          this.attention.onHost(h);
          this.cache.onHost(h);
        });
        hosts.permissions.forEach((p) => this.attention.onPermission(p));
        this.attention.onLive(sessions.live);
        this.attention.onTerminals(terminals.terminals);
        this.updateBadge();
      })
      .catch(() => {});
  }

  /**
   * The sessions running in a Claude Code process right now (in Switchboard or anywhere else), and their folders,
   * from the engine. Throws before the engine is connected: an empty list would say nothing runs.
   */
  async runningSessions(): Promise<{ ids: Set<string>; folders: string[] }> {
    if (!this.client) throw new Error('Not connected to the engine yet');
    const [{ live }, { hosts }] = await Promise.all([this.client.call('sessions.list', {}), this.client.call('hosts.list', {})]);
    return {
      ids: new Set([...live.map((l) => l.sessionId), ...hosts.map((h) => h.sessionId)]),
      // Where each works: its folder (a session in a worktree works there, not in the project's main checkout).
      folders: [...live.map((l) => l.cwd ?? l.projectRoot), ...hosts.map((h) => h.cwd)].filter((folder): folder is string => !!folder),
    };
  }

  /** What an event would do now, for the session on screen or not. The smoke test checks recorded events with it. */
  alertFor(event: AttentionEvent, suppressed = false): Alert {
    return alertFor(event.kind, suppressed, this.options.alerts());
  }

  /**
   * Settings › Notifications' "Send a test notification": one like a Needs you notification, with its sound when
   * sounds are on. It is never for the session on screen, so it always shows.
   */
  test(): void {
    this.handle([{ kind: 'needs-you', sessionId: '', title: 'Claude needs you', body: 'A test notification from Switchboard.' }], { test: true });
  }

  private handle(events: AttentionEvent[], { test = false } = {}): void {
    const win = this.options.window();
    const focused = this.options.focused();
    const prefs = this.options.alerts();
    let sound: Alert['sound'] = null;
    for (const event of events) {
      // Already looking at it: no need to interrupt, with a notification or a sound.
      const suppressed = !test && focused && this.options.focusedSession() === event.sessionId;
      const alert = alertFor(event.kind, suppressed, prefs);
      if (this.options.record) {
        this.options.record({ ...event, suppressed, ...alert });
        continue;
      }
      if (suppressed) continue;
      if (alert.notify && Notification.isSupported()) {
        // A finished turn says what is next in the queue there, rather than a second notification.
        const outcome = this.queue.auto.outcomes.find((o) => o.sessionId === event.sessionId)?.outcome ?? null;
        const hint = event.kind === 'finished' ? queueHint(this.queue.items, this.queue.started, { sessionId: event.sessionId, cwd: event.cwd ?? null, outcome }) : null;
        // With sounds on, the sound is ours (its volume applies, and it plays with notifications off too), so the
        // system's own notification sound (Windows plays one) would be a second one.
        const notification = new Notification({ title: event.title, body: hint ? `${event.body}\n${hint}` : event.body, silent: prefs.sounds.enabled });
        // The test has no session to open.
        notification.on('click', () => (test ? this.options.window()?.show() : this.options.openSession(event.sessionId)));
        notification.on('close', () => this.shown.delete(notification));
        this.shown.add(notification);
        notification.show();
      }
      sound = louder(sound, alert.sound);
      // The Dock and the taskbar stay independent of the notification setting, like the badge.
      if (event.kind === 'needs-you' && !focused && !test) {
        app.dock?.bounce('informational');
        // Windows and Linux have no Dock: the taskbar button flashes until the window is focused.
        if (process.platform !== 'darwin' && win && !win.isDestroyed()) win.flashFrame(true);
      }
    }
    if (sound) {
      const id = resolveSound(prefs.sounds.byEvent[sound], this.options.sounds.list(), sound);
      if (id) this.options.sounds.play(id, prefs.sounds.volume);
    }
    this.updateBadge();
  }

  private updateBadge(): void {
    const count = this.attention.badge();
    app.dock?.setBadge(count > 0 ? String(count) : '');
    // Windows has no badge count: a dot over the taskbar button says it instead.
    const win = this.options.window();
    if (process.platform === 'win32' && win && !win.isDestroyed()) {
      win.setOverlayIcon(count > 0 ? (this.dot ??= nativeImage.createFromBitmap(badgeDotBitmap(32), { width: 32, height: 32 })) : null, count > 0 ? badgeDescription(count) : '');
    }
  }
}
