/** A command that keeps the computer awake for as long as it runs. */
export interface AwakeCommand {
  file: string;
  args: string[];
}

/**
 * What keeps a Mac awake: `caffeinate -s` holds system sleep off while on power (the display can still sleep), and
 * `-w` ends it with Seshboard's process, so a crash doesn't leave it running. `onBattery` uses `-i` instead, which
 * holds idle sleep off on battery too: for Keep awake until done, which lets go by itself. Null elsewhere: Windows and
 * Linux use Electron's sleep blocker instead.
 */
export function awakeCommand(platform: string, pid: number, onBattery = false): AwakeCommand | null {
  return platform === 'darwin' ? { file: '/usr/bin/caffeinate', args: [onBattery ? '-i' : '-s', '-w', String(pid)] } : null;
}

/** The part of a child process Keep awake uses. */
export interface AwakeChild {
  on(event: 'exit' | 'error', listener: () => void): unknown;
  kill(): unknown;
}

/** Electron's `powerSaveBlocker`, or a fake in the tests. */
export interface SleepBlocker {
  start(): number;
  stop(id: number): void;
}

export interface KeepAwakeOptions {
  platform: string;
  /** Seshboard's own process, which `caffeinate` waits for. */
  pid: number;
  spawn(file: string, args: string[]): AwakeChild;
  blocker: SleepBlocker;
  /** Hold sleep off on battery too (see `awakeCommand`). */
  onBattery?: boolean;
}

/**
 * Settings › General › Keep awake, and the sessions set to Keep awake until done: holds sleep off while it is on. `apply` is called with the preference at launch and
 * after every change, so it does something only when the state really changes. A `caffeinate` that exits by itself
 * isn't restarted on the spot (no restart loop); the next `apply(true)` starts it again.
 *
 * On a Mac the sleep blocker runs next to `caffeinate`: `caffeinate`'s power assertion is its own process's, so with
 * the display off macOS could still put Seshboard itself in App Nap, which slows its timers and sockets (Remote's
 * phones then drop). An assertion Seshboard holds itself keeps it out of App Nap.
 */
export class KeepAwake {
  #child: AwakeChild | null = null;
  #blockerId: number | null = null;
  readonly #options: KeepAwakeOptions;

  constructor(options: KeepAwakeOptions) {
    this.#options = options;
  }

  /** Whether sleep is held off right now, for the line under the switch: `caffeinate` on a Mac, the blocker elsewhere. */
  get active(): boolean {
    return this.#command() ? this.#child !== null : this.#blockerId !== null;
  }

  #command(): AwakeCommand | null {
    return awakeCommand(this.#options.platform, this.#options.pid, this.#options.onBattery);
  }

  apply(on: boolean): void {
    if (on) this.#start();
    else this.#stop();
  }

  /** On quit. `-w` covers a crash. */
  dispose(): void {
    this.#stop();
  }

  #start(): void {
    if (this.#blockerId === null) this.#blockerId = this.#options.blocker.start();
    const command = this.#command();
    if (!command || this.#child) return;
    let child: AwakeChild;
    try {
      child = this.#options.spawn(command.file, command.args);
    } catch {
      return;
    }
    this.#child = child;
    // A missing caffeinate reports an error, a killed one exits: either way it no longer holds sleep off.
    const gone = () => {
      if (this.#child === child) this.#child = null;
    };
    child.on('exit', gone);
    child.on('error', gone);
  }

  #stop(): void {
    const child = this.#child;
    this.#child = null;
    if (child) {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }
    if (this.#blockerId !== null) {
      this.#options.blocker.stop(this.#blockerId);
      this.#blockerId = null;
    }
  }
}
