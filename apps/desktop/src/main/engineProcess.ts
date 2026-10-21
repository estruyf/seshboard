import { utilityProcess, type MessagePortMain, type UtilityProcess } from 'electron';

export interface EngineProcessOptions {
  entry: string;
  dataDir: string;
  /** The app's version, which the engine tells the VS Code companion. */
  appVersion: string;
  /** A development or beta build: Remote also accepts the preview's remote app (`REMOTE_PREVIEW_APP_URL`). */
  previewRemote: boolean;
  /** Called after an unexpected exit, once the replacement process is running. */
  onRestarted: () => void;
  /** Requests from the engine that need the main process (e.g. moving files to the Trash). Returns the reply. */
  onRequest?: (message: unknown) => Promise<unknown> | undefined;
}

/** Owns the engine utilityProcess and restarts it with backoff if it dies. */
export class EngineProcess {
  private child: UtilityProcess | undefined;
  private queued: MessagePortMain[] = [];
  private consecutiveCrashes = 0;
  private stableTimer: NodeJS.Timeout | undefined;
  private stopping = false;
  /** Messages every new process gets right after it starts (settings it keeps), by type: the latest of each. */
  private readonly standing = new Map<string, unknown>();

  constructor(private readonly options: EngineProcessOptions) {}

  start(): void {
    const args = ['--data-dir', this.options.dataDir, '--app-version', this.options.appVersion, ...(this.options.previewRemote ? ['--remote-preview'] : [])];
    const child = utilityProcess.fork(this.options.entry, args, {
      serviceName: 'Switchboard Engine',
      stdio: 'inherit',
    });
    this.child = child;
    for (const message of this.standing.values()) child.postMessage(message);
    for (const port of this.queued.splice(0)) child.postMessage({ type: 'connect' }, [port]);
    child.on('message', (message: unknown) => {
      // onRequest answers its own failures; this only keeps a bug there from becoming an unhandled rejection.
      void this.options.onRequest?.(message)?.then(
        (reply) => {
          if (reply !== undefined && this.child === child) child.postMessage(reply);
        },
        (error: unknown) => console.error('[main] engine request failed', error),
      );
    });

    // A process that stays up for a minute resets the backoff.
    this.stableTimer = setTimeout(() => (this.consecutiveCrashes = 0), 60_000);

    child.once('exit', (code) => {
      clearTimeout(this.stableTimer);
      if (this.child === child) this.child = undefined;
      if (this.stopping) return;
      const delay = Math.min(10_000, 200 * 2 ** this.consecutiveCrashes++);
      console.error(`[main] engine exited with code ${code}; restarting in ${delay}ms`);
      setTimeout(() => {
        if (this.stopping) return;
        this.start();
        this.options.onRestarted();
      }, delay);
    });
  }

  /** Sends a one-off message to the running engine (the smoke test's); a replacement process doesn't get it. */
  send(message: { type: string } & Record<string, unknown>): void {
    this.child?.postMessage(message);
  }

  /** Sends a setting to the engine now and again to every process that replaces it, so a restart keeps it. */
  sendStanding(message: { type: string } & Record<string, unknown>): void {
    this.standing.set(message.type, message);
    this.child?.postMessage(message);
  }

  /** Hands a window's port to the engine (queued while a restart is pending). */
  connect(port: MessagePortMain): void {
    if (this.child) this.child.postMessage({ type: 'connect' }, [port]);
    else this.queued.push(port);
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  /** Kills the process without stopping the supervisor (used by the smoke test to exercise restarts). */
  crash(): void {
    this.child?.kill();
  }

  stop(): void {
    this.stopping = true;
    clearTimeout(this.stableTimer);
    this.child?.kill();
  }

  /**
   * Undoes stop(), e.g. when an update didn't install and the app keeps running. Windows reconnect
   * through onRestarted, as after a crash.
   */
  resume(): void {
    if (!this.stopping) return;
    this.stopping = false;
    // Still exiting from stop(): the exit handler sees stopping is off and restarts it.
    if (this.child) return;
    this.start();
    this.options.onRestarted();
  }
}
