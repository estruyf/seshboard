import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { PlanHistory, PlanSeries, UsageSnapshot } from '@switchboard/protocol';
import type { PlanSample } from './shares.ts';

/** Readings older than this are dropped: the longest period shown is 30 days. */
const KEEP_MS = 35 * 24 * 3_600_000;

/**
 * The /usage kind a rate-limit update is about. Model-scoped weekly updates name the model family rather than the
 * plan's display name, so they can't be matched to a meter and are left out.
 */
const EVENT_KINDS: Record<string, string> = { five_hour: 'session', seven_day: 'weekly_all' };

/** Claude Code's rate-limit update, as `rate_limit_event` carries it. */
export interface RateLimitInfo {
  rateLimitType?: string;
  /** Share of the window used, as a fraction (0.42). */
  utilization?: number;
  /** Unix time of the reset, in seconds. */
  resetsAt?: number;
}

/**
 * Plan % over time per scope (a config folder: its login's limits): every /usage result the usage monitor fetches,
 * and rate-limit updates during turns. No extra /usage calls are made for it, so history starts when it does.
 */
export class PlanHistoryStore {
  private readonly insert: StatementSync;
  private readonly prune: StatementSync;
  private lastPrune = 0;

  constructor(private readonly db: DatabaseSync) {
    this.insert = db.prepare('INSERT INTO plan_usage (scope, at, kind, limit_scope, percent, resets_at, source, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    this.prune = db.prepare('DELETE FROM plan_usage WHERE at < ?');
  }

  /** Records a /usage result: one reading per meter. */
  recordSnapshot(scope: string, snapshot: UsageSnapshot): void {
    for (const limit of snapshot.limits) this.insert.run(scope, snapshot.fetchedAt, limit.kind, limit.scope ?? '', limit.percent, limit.resetsAt, 'usage', null);
    this.pruneNowAndThen(snapshot.fetchedAt);
  }

  /** Records a rate-limit update during a session's turn. Updates for windows /usage doesn't name are left out. */
  recordEvent(scope: string, sessionId: string, info: RateLimitInfo, at = Date.now()): void {
    const kind = info.rateLimitType ? EVENT_KINDS[info.rateLimitType] : undefined;
    if (!kind || typeof info.utilization !== 'number' || !Number.isFinite(info.utilization)) return;
    // A fraction in the event, a percentage everywhere else.
    const percent = Math.max(0, Math.min(100, info.utilization <= 1 ? info.utilization * 100 : info.utilization));
    const resetsAt = typeof info.resetsAt === 'number' && Number.isFinite(info.resetsAt) ? (info.resetsAt < 1e12 ? info.resetsAt * 1000 : info.resetsAt) : null;
    this.insert.run(scope, at, kind, '', percent, resetsAt, 'event', sessionId);
  }

  /** Readings recorded elsewhere (the website's screenshots), added only while the scope has none. */
  seed(scope: string, readings: ReadonlyArray<{ at: number; kind: string; scope?: string | null; percent: number; resetsAt: number | null }>): void {
    const { n } = this.db.prepare('SELECT COUNT(*) AS n FROM plan_usage WHERE scope = ?').get(scope) as { n: number };
    if (n > 0) return;
    for (const r of readings) this.insert.run(scope, r.at, r.kind, r.scope ?? '', r.percent, r.resetsAt, 'usage', null);
  }

  private pruneNowAndThen(now: number): void {
    if (now - this.lastPrune < 3_600_000) return;
    this.lastPrune = now;
    this.prune.run(now - KEEP_MS);
  }

  /** One window's readings in a time range, oldest first, for measured shares. */
  samples(scope: string, kind: string, from: number, to: number): PlanSample[] {
    return (
      this.db
        .prepare("SELECT at, percent, resets_at AS resetsAt, session_id AS sessionId FROM plan_usage WHERE scope = ? AND kind = ? AND limit_scope = '' AND at >= ? AND at <= ? ORDER BY at")
        .all(scope, kind, from, to) as unknown as PlanSample[]
    );
  }

  /** Each window's % over a period, with the resets that fell in it. */
  history(scope: string, from: number, to: number): PlanHistory {
    const first = this.db.prepare('SELECT MIN(at) AS at FROM plan_usage WHERE scope = ?').get(scope) as { at: number | null };
    const rows = this.db
      .prepare('SELECT at, kind, limit_scope AS limitScope, percent, resets_at AS resetsAt FROM plan_usage WHERE scope = ? AND at >= ? AND at <= ? ORDER BY at')
      .all(scope, from, to) as Array<{ at: number; kind: string; limitScope: string; percent: number; resetsAt: number | null }>;
    const series = new Map<string, PlanSeries>();
    for (const row of rows) {
      const key = `${row.kind}\0${row.limitScope}`;
      let found = series.get(key);
      if (!found) series.set(key, (found = { kind: row.kind, scope: row.limitScope || null, points: [], resets: [] }));
      found.points.push({ at: row.at, percent: row.percent });
      if (row.resetsAt !== null && row.resetsAt >= from && row.resetsAt <= to && !found.resets.some((r) => Math.abs(r - row.resetsAt!) < 120_000)) found.resets.push(row.resetsAt);
    }
    return { since: first.at ?? null, series: [...series.values()] };
  }
}
