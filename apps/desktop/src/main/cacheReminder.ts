import { cacheExpiresAt, cacheRewriteCost, formatCost, isLargeContext, type ContextWarningPrefs, type CurrencyCode, type SessionHostInfo } from '@switchboard/protocol/client';

/** How long before an hour-long cache lapses its notification comes. */
export const REMIND_BEFORE_MS = 5 * 60_000;

/** What the reminder needs to know: Settings › Usage, and how it shows a cost. */
export interface CacheReminderPrefs {
  contextWarning: ContextWarningPrefs;
  showCost: boolean;
  costCurrency: CurrencyCode;
  /** The app's locale, for how the cost reads (the system's when missing). */
  locale?: string;
}

export interface CacheReminderNotice {
  sessionId: string;
  /** The context's size: "412k". */
  tokens: string;
  /** "≈$3.20" for writing it to the cache again, or null without Show estimated cost or a known price. */
  cost: string | null;
}

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1_000)}k`);

/**
 * When a session's reminder is due, or null when it gets none: Large context and its notification are on, the
 * session waits for you with at least that much context, and its cache is the hour-long one. (With the 5-minute
 * cache a notification would come as you are reading the reply; the session's own notice says it instead.)
 */
export function reminderDue(host: SessionHostInfo, prefs: ContextWarningPrefs): number | null {
  if (!prefs.notifyExpiry || host.state !== 'idle') return null;
  if (host.cacheTtl !== '1h' || host.cacheAt == null || !isLargeContext(host.contextTokens, prefs)) return null;
  return cacheExpiresAt(host.cacheAt, '1h') - REMIND_BEFORE_MS;
}

/**
 * Reminds you a few minutes before a large session's prompt cache lapses, while it waits for you: after that, the
 * next message there writes all of its context to the cache again. Once per time the cache was used.
 */
export class CacheReminder {
  readonly #hosts = new Map<string, SessionHostInfo>();
  readonly #reminded = new Set<string>();
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly options: {
      prefs: () => CacheReminderPrefs;
      remind: (notice: CacheReminderNotice) => void;
      now?: () => number;
      setTimer?: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
      clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
      /** Where a reminder that failed is logged (the console's error). */
      log?: (message: string, error: unknown) => void;
    },
  ) {}

  onHost(info: SessionHostInfo): void {
    if (info.state === 'closed' || info.state === 'error') this.#hosts.delete(info.sessionId);
    else this.#hosts.set(info.sessionId, info);
    this.schedule();
  }

  /** The settings changed: a lower percentage or the notification turned on can make one due. */
  prefsChanged(): void {
    this.schedule();
  }

  reset(): void {
    this.#hosts.clear();
    this.schedule();
  }

  dispose(): void {
    if (this.#timer) (this.options.clearTimer ?? clearTimeout)(this.#timer);
    this.#timer = undefined;
  }

  /**
   * Sends what is due now, then waits for the next one. It runs on a timer in the main process, where a throw shows a
   * crash dialog: a reminder that fails (a formatting bug, say) is logged and skipped, and the next host update
   * schedules the rest again.
   */
  check(): void {
    try {
      const now = this.#now();
      const prefs = this.options.prefs();
      for (const host of this.#hosts.values()) {
        const due = reminderDue(host, prefs.contextWarning);
        const key = `${host.sessionId}:${host.cacheAt}`;
        if (due === null || due > now || this.#reminded.has(key) || now >= cacheExpiresAt(host.cacheAt!, '1h')) continue;
        this.#reminded.add(key);
        const usd = prefs.showCost && host.model && host.contextTokens ? cacheRewriteCost(host.contextTokens, host.model, '1h') : null;
        this.options.remind({ sessionId: host.sessionId, tokens: host.contextTokens ? compact(host.contextTokens) : `${Math.round(host.contextPercent ?? 0)}%`, cost: usd === null ? null : `≈${formatCost(usd, prefs.costCurrency, prefs.locale)}` });
      }
      this.schedule(false);
    } catch (error) {
      (this.options.log ?? console.error)('[main] cache reminder failed', error);
    }
  }

  #now(): number {
    return (this.options.now ?? Date.now)();
  }

  private schedule(checkNow = true): void {
    this.dispose();
    const now = this.#now();
    const prefs = this.options.prefs().contextWarning;
    const upcoming = [...this.#hosts.values()]
      .filter((h) => !this.#reminded.has(`${h.sessionId}:${h.cacheAt}`))
      .map((h) => reminderDue(h, prefs))
      .filter((due): due is number => due !== null && now < due + REMIND_BEFORE_MS);
    if (upcoming.length === 0) return;
    const next = Math.min(...upcoming);
    if (next <= now && checkNow) return this.check();
    // Timers drift while the computer sleeps; waking up re-checks, and what lapsed meanwhile is skipped.
    this.#timer = (this.options.setTimer ?? setTimeout)(() => this.check(), Math.max(1_000, next - now));
    (this.#timer as { unref?: () => void }).unref?.();
  }
}
