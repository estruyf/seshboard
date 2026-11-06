import type { UsageLimit, UsageSnapshot } from '@seshboard/protocol';
import type { GetAccountRateLimitsResponse, RateLimitSnapshot, RateLimitWindow } from './protocol.ts';

type Loose = Record<string, unknown>;

const obj = (v: unknown): Loose => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Codex's own bucket of limits. */
const MAIN = 'codex';
const FIVE_HOURS = 300;
const WEEK = 7 * 24 * 60;

/** A window's length in words, for a window that is neither 5 hours nor a week: "3 hours", "2 days". */
function windowScope(mins: number | null): string | null {
  if (mins === null || mins <= 0) return null;
  if (mins % 1440 === 0) return `${mins / 1440} ${mins === 1440 ? 'day' : 'days'}`;
  if (mins % 60 === 0) return `${mins / 60} ${mins === 60 ? 'hour' : 'hours'}`;
  return `${mins} minutes`;
}

/**
 * One window as a plan meter, in the kinds Claude Code's plan usage has, so the same meters show it: the 5-hour window
 * is `session`, the week `weekly_all` (`*_scoped`, with the bucket's name, for another bucket), any other length
 * `window` with its length as the scope. Codex grades nothing: 75% used is a warning, 90% or a reached limit critical.
 */
function limitOf(window: unknown, bucket: Loose, main: boolean): UsageLimit | null {
  const w = obj(window);
  const percent = num(w.usedPercent);
  if (percent === null) return null;
  const mins = num(w.windowDurationMins);
  const resets = num(w.resetsAt);
  const name = str(bucket.limitName) ?? str(bucket.normalModelSlug) ?? str(bucket.limitId);
  const reached = percent >= 100;
  const base = {
    percent: Math.max(0, Math.min(100, percent)),
    resetsAt: resets === null ? null : resets < 1e12 ? resets * 1000 : resets,
    severity: reached || percent >= 90 ? 'critical' : percent >= 75 ? 'warning' : 'normal',
    isActive: reached,
  };
  if (mins === FIVE_HOURS) return { ...base, kind: main ? 'session' : 'session_scoped', group: 'session', scope: main ? null : name };
  if (mins === WEEK) return { ...base, kind: main ? 'weekly_all' : 'weekly_scoped', group: 'weekly', scope: main ? null : name };
  const length = windowScope(mins);
  return { ...base, kind: 'window', group: 'window', scope: main ? length : [name, length].filter(Boolean).join(' · ') || null };
}

/**
 * Codex's rate limits (`account/rateLimits/read`) as Claude Code's plan usage: each bucket's windows as plan meters,
 * Codex's own bucket first. Null when Codex has no limits to report (signed in with an API key, or not at all).
 */
export function codexUsageSnapshot(response: unknown, now = Date.now()): UsageSnapshot | null {
  const r = obj(response);
  const single = obj(r.rateLimits);
  const byId = obj(r.rateLimitsByLimitId);
  const buckets: Array<[string, Loose]> = Object.keys(byId).length ? Object.entries(byId).map(([id, b]) => [id, obj(b)]) : [[str(single.limitId) ?? MAIN, single]];
  const mainId = buckets.some(([id]) => id === MAIN) ? MAIN : (str(single.limitId) ?? buckets[0]?.[0]);
  buckets.sort(([a], [b]) => Number(b === mainId) - Number(a === mainId));
  const limits = buckets.flatMap(([id, bucket]) => [bucket.primary, bucket.secondary].map((w) => limitOf(w, bucket, id === mainId)).filter((l): l is UsageLimit => l !== null));
  return limits.length ? { fetchedAt: now, limits, extraUsage: null } : null;
}

/** A window from a rolling update over the one known: a window the update leaves out stays as it was. */
const windowOver = (update: RateLimitWindow | null | undefined, known: RateLimitWindow | null | undefined) => update ?? known ?? null;

/**
 * A rolling update (`account/rateLimits/updated`) over the last full read. Codex sends updates sparse: what one leaves
 * out (null) doesn't clear what is known.
 */
export function mergeRateLimits(known: GetAccountRateLimitsResponse | null, update: unknown): GetAccountRateLimitsResponse {
  const next = obj(obj(update).rateLimits) as unknown as RateLimitSnapshot;
  const id = str(next.limitId) ?? MAIN;
  const before = known?.rateLimitsByLimitId?.[id] ?? (known && (known.rateLimits.limitId ?? MAIN) === id ? known.rateLimits : null);
  const merged: RateLimitSnapshot = {
    limitId: id,
    limitName: str(next.limitName) ?? before?.limitName ?? null,
    primary: windowOver(next.primary, before?.primary),
    secondary: windowOver(next.secondary, before?.secondary),
    planType: str(next.planType) ?? before?.planType ?? null,
    rateLimitReachedType: next.rateLimitReachedType === undefined ? (before?.rateLimitReachedType ?? null) : next.rateLimitReachedType,
  };
  const single = !known || (known.rateLimits.limitId ?? MAIN) === id ? merged : known.rateLimits;
  return { rateLimits: single, rateLimitsByLimitId: { ...(known?.rateLimitsByLimitId ?? {}), [id]: merged } };
}

export interface CodexUsageOptions {
  /** `account/rateLimits/read` on the profile's app-server. */
  read(): Promise<GetAccountRateLimitsResponse>;
  /** A read is reused for this long, unless asked to refresh. */
  maxAgeMs?: number;
  now?: () => number;
}

/** How long a read of the limits is reused, as Claude Code's plan usage is. */
const MAX_AGE_MS = 60_000;

/**
 * One Codex profile's rate limits as plan usage: read when asked (reused for a minute), and kept up to date from the
 * rolling updates Codex sends while it runs. Signed out, or Codex missing, the usage is null. Listeners hear every
 * change (not a read that changed nothing).
 */
export class CodexUsage {
  private known: GetAccountRateLimitsResponse | null = null;
  private snapshot: UsageSnapshot | null = null;
  private readAt = 0;
  private reading: Promise<UsageSnapshot | null> | null = null;
  private readonly listeners = new Set<(usage: UsageSnapshot | null) => void>();

  constructor(private readonly options: CodexUsageOptions) {}

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** The limits now: the last read when it is fresh, else a new one. */
  get(refresh = false): Promise<UsageSnapshot | null> {
    if (!refresh && this.readAt && this.now() - this.readAt < (this.options.maxAgeMs ?? MAX_AGE_MS)) return Promise.resolve(this.snapshot);
    this.reading ??= this.options
      .read()
      .then(
        (response) => {
          this.known = response;
          return codexUsageSnapshot(response, this.now());
        },
        // Signed out (Codex refuses), or Codex isn't there: no usage to show.
        () => {
          this.known = null;
          return null;
        },
      )
      .then((snapshot) => {
        this.readAt = this.now();
        this.set(snapshot);
        return snapshot;
      })
      .finally(() => {
        this.reading = null;
      });
    return this.reading;
  }

  /** A rolling update from Codex (`account/rateLimits/updated`'s params). */
  update(params: unknown): void {
    if (!Object.keys(obj(obj(params).rateLimits)).length) return;
    this.known = mergeRateLimits(this.known, params);
    this.set(codexUsageSnapshot(this.known, this.now()));
  }

  onChange(listener: (usage: UsageSnapshot | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(snapshot: UsageSnapshot | null): void {
    const same = JSON.stringify(snapshot?.limits ?? null) === JSON.stringify(this.snapshot?.limits ?? null);
    this.snapshot = snapshot;
    if (same) return;
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // A listener's failure is its own.
      }
    }
  }
}
