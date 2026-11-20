import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { LogLevel, UsageSnapshot } from '@seshboard/protocol';
import type { SdkRuntime } from './hostManager.ts';

/** The usage report attached to the assistant message that answers `/usage` (SDKUsageReport). */
interface RawUsageReport {
  rate_limits?: {
    limits?: Array<{
      kind?: unknown;
      group?: unknown;
      percent?: unknown;
      resets_at?: unknown;
      scope?: { model?: { display_name?: unknown } | null; surface?: { display_name?: unknown } | null } | null;
      severity?: unknown;
      is_active?: unknown;
    }> | null;
    extra_usage?: { is_enabled?: unknown; monthly_limit?: unknown; used_credits?: unknown; currency?: unknown } | null;
  } | null;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** Maps Claude Code's usage report to the snapshot the UI shows. Null when there's no plan data. */
export function toUsageSnapshot(report: RawUsageReport | undefined, now = Date.now()): UsageSnapshot | null {
  const limits = report?.rate_limits?.limits;
  if (!Array.isArray(limits)) return null;
  const extra = report?.rate_limits?.extra_usage;
  return {
    fetchedAt: now,
    limits: limits.flatMap((l) => {
      const percent = num(l.percent);
      const kind = str(l.kind);
      if (percent === null || !kind) return [];
      const resets = str(l.resets_at);
      const parsed = resets ? Date.parse(resets) : NaN;
      return [
        {
          kind,
          group: str(l.group) ?? kind,
          percent,
          resetsAt: Number.isFinite(parsed) ? parsed : null,
          scope: str(l.scope?.model?.display_name) ?? str(l.scope?.surface?.display_name),
          severity: str(l.severity) ?? 'normal',
          isActive: l.is_active === true,
        },
      ];
    }),
    extraUsage: extra
      ? { enabled: extra.is_enabled === true, usedCredits: num(extra.used_credits), monthlyLimit: num(extra.monthly_limit), currency: str(extra.currency) }
      : null,
  };
}

export interface UsageMonitorOptions {
  sdk: () => Promise<SdkRuntime>;
  env: () => Promise<Record<string, string>>;
  claudePath: () => Promise<string | undefined>;
  onChange: (usage: UsageSnapshot | null) => void;
  /** Every fetch that brought numbers, changed or not (the plan % history records each check). */
  onFetched?: (usage: UsageSnapshot) => void;
  log: (level: LogLevel, message: string) => void;
  /** Helper processes register in the live registry while they run; tell the engine to ignore them. */
  ephemeral: { add(sessionId: string): void; delete(sessionId: string): void };
  refreshMs?: number;
  /** Retry after a failed fetch (default 30 s). */
  retryMs?: number;
  /** A nudge fetches this long after it (default 15 s), or later when the floor says so. */
  nudgeMs?: number;
  /** The least time between two fetches that nobody asked for (nudges), per monitor, so per profile (default 60 s). */
  minGapMs?: number;
  /** Give up on a fetch after this long (default 20 s). */
  timeoutMs?: number;
  /** Report these numbers and never start Claude Code (the website's screenshots, whose demo logins have no plan). */
  fixed?: UsageSnapshot;
}

const STALE_MS = 60_000;
const NUDGE_MS = 15_000;
const MIN_GAP_MS = 60_000;

/**
 * Plan usage for the band above the composer. Asks Claude Code for its
 * `/usage` report in a short-lived process that writes no transcript
 * (~1 s, no tokens), every few minutes and shortly after a turn ends. Every start of that process runs the settings'
 * startup work, so no more than one starts a minute for nothing but a nudge, and hooks never run in it.
 */
export class UsageMonitor {
  private snapshot: UsageSnapshot | null = null;
  private error: string | null = null;
  private inflight: Promise<void> | undefined;
  private nudgeTimer: ReturnType<typeof setTimeout> | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;
  /** Set by stop(): the monitor is being thrown away (profile removed, engine quitting) and starts nothing more. */
  private stopped = false;
  /** Fetches in a row that brought no numbers; only the first is retried soon. */
  private misses = 0;
  /** When the last helper started (0: none yet), for the floor between nudged fetches. */
  private lastStart = 0;

  constructor(private readonly options: UsageMonitorOptions) {}

  /** `maxAgeMs`: how old the numbers may be without `refresh` before they are fetched again (default a minute). */
  async get(refresh: boolean, maxAgeMs = STALE_MS): Promise<{ usage: UsageSnapshot | null; error: string | null }> {
    if (this.options.fixed) {
      this.snapshot ??= this.options.fixed;
      return { usage: this.snapshot, error: null };
    }
    const stale = !this.snapshot || Date.now() - this.snapshot.fetchedAt > maxAgeMs;
    if (refresh || stale) await this.fetch();
    if (!this.stopped) this.start();
    return { usage: this.snapshot, error: this.error };
  }

  /** The last numbers fetched, without fetching. */
  current(): UsageSnapshot | null {
    return this.snapshot;
  }

  /** Something used the plan (a turn finished): refresh soon, once, and no sooner than `minGapMs` after the last fetch. */
  nudge(): void {
    if (this.nudgeTimer || this.stopped) return;
    this.armNudge(this.options.nudgeMs ?? NUDGE_MS);
  }

  /** How much of the floor is left since the last helper started: never more than the floor itself, as the clock can jump back. */
  private floorLeft(): number {
    const left = this.lastStart + (this.options.minGapMs ?? MIN_GAP_MS) - Date.now();
    return left > (this.options.minGapMs ?? MIN_GAP_MS) ? 0 : Math.max(0, left);
  }

  private armNudge(delay: number): void {
    this.nudgeTimer = setTimeout(() => {
      this.nudgeTimer = undefined;
      // Something else fetched in the meantime (Refresh, a miss's retry): wait out the rest of the floor.
      const left = this.floorLeft();
      if (left > 0) this.armNudge(left);
      else void this.fetch();
    }, Math.max(delay, this.floorLeft()));
    this.nudgeTimer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.interval) clearInterval(this.interval);
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * After a failed fetch: once more in 30 s rather than waiting for the next 5-minute refresh.
   * Only after the first miss in a row; when that fails too (API key sign-in, offline), the regular refresh takes over.
   */
  private retrySoon(): void {
    this.misses++;
    if (this.retryTimer || this.stopped || this.misses > 1) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.fetch();
    }, this.options.retryMs ?? 30_000);
    this.retryTimer.unref?.();
  }

  private start(): void {
    if (this.interval) return;
    // The regular check stays out of the way of a fetch that just ran (a nudge, a Refresh).
    this.interval = setInterval(() => {
      if (this.floorLeft() === 0) void this.fetch();
    }, this.options.refreshMs ?? 5 * 60_000);
    this.interval.unref?.();
  }

  private fetch(): Promise<void> {
    if (this.stopped || this.options.fixed) return Promise.resolve();
    this.inflight ??= this.run().finally(() => (this.inflight = undefined));
    return this.inflight;
  }

  private async run(): Promise<void> {
    this.lastStart = Date.now();
    const sessionId = randomUUID();
    this.options.ephemeral.add(sessionId);
    let query: ReturnType<SdkRuntime['query']> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      const [env, claudePath, sdk] = await Promise.all([this.options.env(), this.options.claudePath(), this.options.sdk()]);
      const prompt: AsyncIterable<SDKUserMessage> = {
        async *[Symbol.asyncIterator]() {
          yield { type: 'user', message: { role: 'user', content: '/usage' }, parent_tool_use_id: null };
          await new Promise(() => {});
        },
      };
      query = sdk.query({
        prompt,
        // The user's settings stay (their `env`, a proxy or `apiKeyHelper` decide whether and where /usage is asked), but
        // no hook runs (a SessionStart hook, a git pull, would run on every one of these starts) and no MCP server starts.
        options: { cwd: homedir(), env, pathToClaudeCodeExecutable: claudePath, sessionId, persistSession: false, settingSources: ['user'], settings: { disableAllHooks: true }, strictMcpConfig: true },
      });
      let report: RawUsageReport | undefined;
      deadline = setTimeout(() => {
        timedOut = true;
        query?.close();
      }, this.options.timeoutMs ?? 20_000);
      for await (const message of query) {
        if (message.type === 'assistant' && 'usage_report' in message && message.usage_report) report = message.usage_report as RawUsageReport;
        if (message.type === 'result') break;
      }
      const next = toUsageSnapshot(report);
      this.error = next
        ? null
        : timedOut
          ? 'Claude Code did not report plan usage in time'
          : 'No plan usage available (API key sign-in, or the usage endpoint is unreachable)';
      if (next) {
        this.misses = 0;
        this.options.onFetched?.(next);
      }
      if (!next) {
        // A miss (the endpoint can be briefly unavailable): keep the last good numbers, try again soon.
        this.retrySoon();
      } else if (JSON.stringify(next.limits) !== JSON.stringify(this.snapshot?.limits) || !this.snapshot) {
        this.snapshot = next;
        this.options.onChange(next);
      } else {
        this.snapshot = next;
      }
    } catch (error) {
      this.error = timedOut ? 'Claude Code did not report plan usage in time' : (error as Error).message;
      this.options.log('debug', `Usage fetch failed: ${(error as Error).message}`);
      this.retrySoon();
    } finally {
      clearTimeout(deadline);
      query?.close();
      // Let the helper leave the live registry before we stop hiding it.
      setTimeout(() => this.options.ephemeral.delete(sessionId), 5_000).unref?.();
    }
  }
}
