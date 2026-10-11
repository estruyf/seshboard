import { existsSync, watch, type FSWatcher } from 'node:fs';

/** How long a burst of changes (Claude writing a memory and its MEMORY.md line) is gathered into one notice. */
const SETTLE_MS = 250;
/** Folders watched at most; the oldest project is let go first. */
const MAX_WATCHED = 40;

/**
 * Watches memory folders and calls `onChange` with the project they belong to (null for the personal folder) a moment
 * after files there change: Claude writes memory during a session, and a sync tool brings in another Mac's. Folders that
 * don't exist yet are skipped; asking again once they do starts watching them.
 */
export class MemoryWatcher {
  private readonly watchers = new Map<string, { watcher: FSWatcher; key: string | null }>();
  private readonly timers = new Map<string | null, ReturnType<typeof setTimeout>>();

  constructor(private readonly onChange: (root: string | null) => void) {}

  /** Watches these folders for `key` (a project root, or null for personal), and stops watching ones it had before. */
  watch(key: string | null, dirs: readonly string[]): void {
    for (const [dir, entry] of this.watchers) {
      if (entry.key === key && !dirs.includes(dir)) this.stop(dir);
    }
    for (const dir of dirs) {
      if (this.watchers.has(dir) || !existsSync(dir)) continue;
      try {
        const watcher = watch(dir, { persistent: false }, (_event, file) => {
          if (file && !String(file).endsWith('.md')) return;
          this.changed(key);
        });
        watcher.on('error', () => this.stop(dir));
        this.watchers.set(dir, { watcher, key });
      } catch {
        // A folder we can't watch is read again when the view asks.
      }
    }
    while (this.watchers.size > MAX_WATCHED) {
      const oldest = [...this.watchers].find(([, e]) => e.key !== null)?.[0];
      if (!oldest) break;
      this.stop(oldest);
    }
  }

  private changed(key: string | null): void {
    clearTimeout(this.timers.get(key));
    const timer = setTimeout(() => {
      this.timers.delete(key);
      this.onChange(key);
    }, SETTLE_MS);
    timer.unref?.();
    this.timers.set(key, timer);
  }

  private stop(dir: string): void {
    this.watchers.get(dir)?.watcher.close();
    this.watchers.delete(dir);
  }

  close(): void {
    for (const dir of [...this.watchers.keys()]) this.stop(dir);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
