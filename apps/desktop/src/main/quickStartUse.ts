import { readJsonFile, writeFileAtomic } from './jsonFile.ts';

/** Quick start's panel is loaded at launch only for someone who opened it within this long. */
export const PREWARM_WITHIN_MS = 14 * 24 * 60 * 60_000;
/** The last use is written at most this often: the 14 days don't need more, and a press shouldn't touch the disk. */
const WRITE_EVERY_MS = 60 * 60_000;

/**
 * Whether to make the Quick start panel (a whole renderer, about 100 MB) while the app starts, so the first press opens it
 * at once: only with a shortcut that works, for someone who used it lately. Anyone else gets it made on the first press.
 */
export function shouldPrewarm(input: { lastUsedAt: number | null; now: number; registered: boolean }): boolean {
  if (!input.registered || input.lastUsedAt === null) return false;
  return input.now - input.lastUsedAt < PREWARM_WITHIN_MS;
}

/**
 * When Quick start was last opened, kept in a small file of its own in the data folder (not a preference: nothing syncs
 * or exports it). `initial` stands in for the file where a run must not read the real one (the smoke test).
 */
export class QuickStartUse {
  #lastUsedAt: number | null;
  #written: number | null;

  constructor(
    private readonly file: string | null,
    initial?: number | null,
  ) {
    const stored = initial !== undefined ? initial : file ? parseLastUsed(readJsonFile(file)) : null;
    this.#lastUsedAt = stored;
    this.#written = stored;
  }

  get lastUsedAt(): number | null {
    return this.#lastUsedAt;
  }

  /** The panel was opened. */
  markUsed(now: number): void {
    this.#lastUsedAt = now;
    if (!this.file || (this.#written !== null && now - this.#written < WRITE_EVERY_MS)) return;
    this.#written = now;
    try {
      writeFileAtomic(this.file, `${JSON.stringify({ lastUsedAt: now })}\n`);
    } catch {
      // Only the next launch's prewarm depends on it.
    }
  }
}

function parseLastUsed(raw: unknown): number | null {
  const value = (raw as { lastUsedAt?: unknown } | null)?.lastUsedAt;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
