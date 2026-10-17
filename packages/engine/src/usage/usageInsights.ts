import type { DatabaseSync } from 'node:sqlite';
import type { LogLevel, PlanHistory, UsageBreakdown, UsageGroup, UsagePeriod, UsageScan, UsageSnapshot, WindowCost } from '@switchboard/protocol';
import { PlanHistoryStore, type RateLimitInfo } from './planHistory.ts';
import { breakdown, periodRange, sessionCost, windowCosts, windowCostsFrom, type PlanWindow, type SessionLookup } from './usageQuery.ts';
import { scopeOf, UsageScanner } from './usageScanner.ts';

/** How often a request for numbers reads the transcripts again. */
const RESCAN_MS = 15_000;
/** How often, at most, the UI hears that new tokens were read. */
const NOTIFY_MS = 1_000;

export interface UsageInsightsOptions {
  db: DatabaseSync;
  /** Every profile and its config folder. */
  profiles: () => Array<{ id: string; configDir: string }>;
  lookup: SessionLookup;
  /** The profile's latest /usage numbers, for when the current window started and how much of it is used. */
  snapshot: (profileId: string) => UsageSnapshot | null;
  /** New tokens were read for these profiles. */
  onTokens: (profileIds: string[], scan: UsageScan | null) => void;
  log: (level: LogLevel, message: string) => void;
}

/**
 * The Usage view's numbers: token totals read from each config folder's transcripts, and plan % history. Profiles
 * that share a config folder share everything here (their login and limits are the same).
 */
export class UsageInsights {
  private readonly scanner: UsageScanner;
  private readonly history: PlanHistoryStore;
  private lastScan = 0;
  private scanning = false;
  /** The first read's progress per scope, while it runs. */
  private readonly progress = new Map<string, UsageScan>();
  private notifyTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly dirty = new Set<string>();

  constructor(private readonly options: UsageInsightsOptions) {
    this.scanner = new UsageScanner(options.db);
    this.history = new PlanHistoryStore(options.db);
  }

  private configDirOf(profileId: string): string | null {
    return this.options.profiles().find((p) => p.id === profileId)?.configDir ?? null;
  }

  private scopeOfProfile(profileId: string): string | null {
    const dir = this.configDirOf(profileId);
    return dir ? scopeOf(dir) : null;
  }

  /** The profiles reading a scope. */
  private profilesIn(scope: string): string[] {
    return this.options.profiles().filter((p) => scopeOf(p.configDir) === scope).map((p) => p.id);
  }

  /** Reads what's new in every profile's transcripts, unless that happened a moment ago. Runs in the background. */
  refresh(force = false): void {
    if (this.scanning || (!force && Date.now() - this.lastScan < RESCAN_MS)) return;
    this.scanning = true;
    const targets = this.options.profiles().map((p) => ({ scope: scopeOf(p.configDir), configDir: p.configDir }));
    void this.scanner
      .scan(targets, {
        // Progress is shown for the first read only; later reads are quick and quiet.
        onProgress: (scope, progress) => {
          if (this.scanner.hasScanned(scope)) return;
          this.progress.set(scope, progress);
          this.dirty.add(scope);
          this.notifySoon();
        },
        onFile: (scope) => {
          this.dirty.add(scope);
          this.notifySoon();
        },
      })
      .catch((error: unknown) => this.options.log('warn', `Reading token usage failed: ${(error as Error).message}`))
      .finally(() => {
        this.scanning = false;
        this.lastScan = Date.now();
        for (const scope of this.progress.keys()) this.dirty.add(scope);
        this.progress.clear();
        this.notifySoon(true);
      });
  }

  private notifySoon(now = false): void {
    // A scan that was still reading when the engine closed has nothing left to tell (and no database to ask).
    if (this.closed) return;
    const flush = () => {
      this.notifyTimer = undefined;
      const scopes = [...this.dirty];
      this.dirty.clear();
      for (const scope of scopes) this.options.onTokens(this.profilesIn(scope), this.progress.get(scope) ?? null);
    };
    if (now) {
      clearTimeout(this.notifyTimer);
      flush();
      return;
    }
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(flush, NOTIFY_MS);
    this.notifyTimer.unref?.();
  }

  private sessionLimit(profileId: string) {
    return this.options.snapshot(profileId)?.limits.find((l) => l.kind === 'session') ?? null;
  }

  /** A period's range; the current window starts five hours before the plan says it resets. */
  private rangeFor(profileId: string, params: { period: UsagePeriod; timeZone: string }, now: number) {
    const session = this.sessionLimit(profileId);
    const windowStart = session?.resetsAt && session.resetsAt > now ? session.resetsAt - 5 * 3_600_000 : null;
    return periodRange(params.period, now, params.timeZone, windowStart);
  }

  /** Where a profile's tokens went in a period. Starts reading new transcript lines in the background. */
  breakdown(profileId: string, params: { period: UsagePeriod; groupBy: UsageGroup; model: string | null; timeZone: string }, now = Date.now()): UsageBreakdown {
    this.refresh();
    const scope = this.scopeOfProfile(profileId);
    const session = this.sessionLimit(profileId);
    const range = this.rangeFor(profileId, params, now);
    const scan = scope ? (this.progress.get(scope) ?? (this.scanner.hasScanned(scope) ? null : { done: 0, total: 0 })) : null;
    if (!scope) {
      const empty = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      return { period: params.period, ...range, totals: { tokens: empty, sessions: 0, turns: 0, fastTurns: 0, largestContext: 0 }, rows: [], buckets: [], scan: null };
    }
    const measure =
      params.period === 'window' && session && session.percent > 0 ? { percent: session.percent, samples: this.history.samples(scope, 'session', range.from, range.to) } : null;
    const result = breakdown(this.options.db, { scope, ...params, ...range, measure }, this.options.lookup);
    return { ...result, scan };
  }

  /** The estimated API cost of each of a profile's running plan windows. Starts reading new transcript lines in the background. */
  windowCosts(profileId: string, now = Date.now()): WindowCost[] {
    this.refresh();
    const scope = this.scopeOfProfile(profileId);
    const limits = this.options.snapshot(profileId)?.limits ?? [];
    return scope ? windowCosts(this.options.db, scope, limits, now) : [];
  }

  /** The estimated API cost of one session of a profile, since it started; null before any of its tokens were read. */
  sessionCost(profileId: string, sessionId: string): { usd: number; partial: boolean } | null {
    this.refresh();
    const scope = this.scopeOfProfile(profileId);
    return scope ? sessionCost(this.options.db, scope, sessionId) : null;
  }

  /** The estimated API cost of a profile's tokens in windows whose start another computer gave. */
  windowCostsFrom(profileId: string, windows: readonly PlanWindow[], now = Date.now()): WindowCost[] {
    this.refresh();
    const scope = this.scopeOfProfile(profileId);
    return scope ? windowCostsFrom(this.options.db, scope, windows, now) : [];
  }

  /** A profile's plan % over a period. */
  planHistory(profileId: string, params: { period: UsagePeriod; timeZone: string }, now = Date.now()): PlanHistory {
    const scope = this.scopeOfProfile(profileId);
    if (!scope) return { since: null, series: [] };
    const { from, to } = this.rangeFor(profileId, params, now);
    return this.history.history(scope, from, to);
  }

  /** Plan % history recorded elsewhere, for a config folder (the website's screenshots). */
  seedHistory(configDir: string, readings: Parameters<PlanHistoryStore['seed']>[1]): void {
    this.history.seed(scopeOf(configDir), readings);
  }

  recordSnapshot(profileId: string, snapshot: UsageSnapshot): void {
    const scope = this.scopeOfProfile(profileId);
    if (scope) this.history.recordSnapshot(scope, snapshot);
  }

  recordRateLimit(profileId: string, sessionId: string, info: RateLimitInfo): void {
    const scope = this.scopeOfProfile(profileId);
    if (scope) this.history.recordEvent(scope, sessionId, info);
  }

  private closed = false;

  close(): void {
    this.closed = true;
    clearTimeout(this.notifyTimer);
  }
}
