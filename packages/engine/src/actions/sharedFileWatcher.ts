import { existsSync, watch, type FSWatcher } from 'node:fs';
import { SHARED_FILE } from './sharedFile.ts';

/** How long a burst of changes (a pull, an editor's save-and-rename) is gathered into one notice. */
const SETTLE_MS = 250;
/** Projects watched at most; the one asked for longest ago is let go first. */
const MAX_WATCHED = 40;

/**
 * Watches projects' .switchboard.json (through the project folder, so a file that is created, replaced by a pull or
 * removed is seen too) and calls `onChange` with the project a moment after it changes.
 */
export class SharedFileWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly onChange: (root: string) => void) {}

  /** Starts watching a project (again asked for: it moves to the back of the line). */
  watch(root: string): void {
    const known = this.watchers.get(root);
    if (known) {
      this.watchers.delete(root);
      this.watchers.set(root, known);
      return;
    }
    if (!existsSync(root)) return;
    try {
      const watcher = watch(root, { persistent: false }, (_event, file) => {
        // Some platforms leave out the name; then any change in the folder counts.
        if (file && String(file) !== SHARED_FILE) return;
        this.changed(root);
      });
      watcher.on('error', () => this.stop(root));
      this.watchers.set(root, watcher);
    } catch {
      // A folder that can't be watched is read again whenever the list is asked for.
    }
    while (this.watchers.size > MAX_WATCHED) this.stop(this.watchers.keys().next().value!);
  }

  private changed(root: string): void {
    clearTimeout(this.timers.get(root));
    const timer = setTimeout(() => {
      this.timers.delete(root);
      this.onChange(root);
    }, SETTLE_MS);
    timer.unref?.();
    this.timers.set(root, timer);
  }

  private stop(root: string): void {
    this.watchers.get(root)?.close();
    this.watchers.delete(root);
  }

  close(): void {
    for (const root of [...this.watchers.keys()]) this.stop(root);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
