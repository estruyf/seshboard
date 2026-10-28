import { z } from 'zod';

/** One plan meter from Claude Code's usage report (the server decides which exist and how severe they are). */
export const UsageLimit = z.object({
  /** The server's meter kind: 'session' (5-hour window), 'weekly_all', 'weekly_scoped', … */
  kind: z.string(),
  group: z.string(),
  /** Share of the window used, 0–100. */
  percent: z.number(),
  resetsAt: z.number().nullable(),
  /** What a scoped meter is for, e.g. a model name. */
  scope: z.string().nullable(),
  /** The server's grading for colour: 'normal', 'warning', 'critical'. */
  severity: z.string(),
  isActive: z.boolean(),
});
export type UsageLimit = z.infer<typeof UsageLimit>;

export const UsageSnapshot = z.object({
  fetchedAt: z.number(),
  limits: z.array(UsageLimit),
  /** Extra-usage spend this billing period, in minor units of `currency`. */
  extraUsage: z
    .object({
      enabled: z.boolean(),
      usedCredits: z.number().nullable(),
      monthlyLimit: z.number().nullable(),
      currency: z.string().nullable(),
    })
    .nullable(),
});
export type UsageSnapshot = z.infer<typeof UsageSnapshot>;

/**
 * What the tokens of one plan window would cost at API list prices (`costEstimate.ts`), in US dollars: from when the
 * window started (its reset minus its length) until now. An estimate, never a charge.
 */
export const WindowCost = z.object({
  /** The plan meter's kind and scope, as in `UsageLimit`. */
  kind: z.string(),
  scope: z.string().nullable(),
  from: z.number(),
  usd: z.number(),
  /** Tokens of models without a known price were left out. */
  partial: z.boolean(),
});
export type WindowCost = z.infer<typeof WindowCost>;

/** The Usage view's periods: the current 5-hour window, the last 24 hours, the last 7 and 30 days (local days). */
export const UsagePeriod = z.enum(['window', 'day', 'week', 'month']);
export type UsagePeriod = z.infer<typeof UsagePeriod>;

/** How the Tokens tab groups its breakdown. */
export const UsageGroup = z.enum(['session', 'project', 'model', 'day']);
export type UsageGroup = z.infer<typeof UsageGroup>;

/** Tokens by type, as Claude Code's transcripts report them. Thinking tokens are part of `output`. */
export const TokenCounts = z.object({
  /** Uncached input. */
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
});
export type TokenCounts = z.infer<typeof TokenCounts>;

/** One line of the breakdown: a session, a project, a model or a local day. */
export const UsageRow = z.object({
  key: z.string(),
  /** A session's title, a project's name, a model id, or the day as YYYY-MM-DD. */
  label: z.string(),
  sessionId: z.string().nullable(),
  projectRoot: z.string().nullable(),
  /** The model of a model row, or the model a session used most. */
  model: z.string().nullable(),
  sessions: z.number(),
  /** API responses (one per request Claude Code made). */
  turns: z.number(),
  /** Turns in fast mode (`usage.speed` is `fast`), which use the plan faster. */
  fastTurns: z.number(),
  tokens: TokenCounts,
  /**
   * What the row's tokens would cost at API list prices, in US dollars, each model at its own price (`costEstimate.ts`).
   * An estimate, never a charge. Left out by a computer on an older Seshboard.
   */
  cost: z.number().optional(),
  /** The largest context of a single turn: its input, cache read and cache write together. */
  largestContext: z.number(),
  /** Estimated share of the period's activity, 0–1. Never a share of a plan limit. */
  share: z.number(),
  /** The share comes from measured changes in plan % (the session ran alone), not from token weights. */
  measured: z.boolean(),
  /** The Auto routing row: Haiku's calls that picked a model, and how many there were. */
  autoRouting: z.object({ picks: z.number() }).optional(),
  /** The Side questions row: what Ask about this session used, and how many questions were answered. */
  sideQuestions: z.object({ asked: z.number() }).optional(),
  /** The Catch-up summaries row: Haiku's calls that wrote the briefings on finished turns, and how many there were. */
  catchUpSummaries: z.object({ calls: z.number() }).optional(),
  /** A model row: how many of its sessions Auto picked it for. */
  byAuto: z.number().optional(),
});
export type UsageRow = z.infer<typeof UsageRow>;

/** Tokens in one hour or one local day, for the chart. */
export const UsageBucket = z.object({ start: z.number(), tokens: TokenCounts, turns: z.number(), /** As on `UsageRow`. */ cost: z.number().optional() });
export type UsageBucket = z.infer<typeof UsageBucket>;

/** How far the first read of the transcripts is (files read, of how many). */
export const UsageScan = z.object({ done: z.number(), total: z.number() });
export type UsageScan = z.infer<typeof UsageScan>;

export const UsageBreakdown = z.object({
  period: UsagePeriod,
  from: z.number(),
  to: z.number(),
  bucket: z.enum(['hour', 'day']),
  /** `cost` as on `UsageRow`. */
  totals: z.object({ tokens: TokenCounts, cost: z.number().optional(), sessions: z.number(), turns: z.number(), fastTurns: z.number(), largestContext: z.number() }),
  rows: z.array(UsageRow),
  buckets: z.array(UsageBucket),
  /** Set while transcripts are being read for the first time: the numbers grow as it goes. */
  scan: UsageScan.nullable(),
});
export type UsageBreakdown = z.infer<typeof UsageBreakdown>;

/** One plan window's % used over time, from /usage results and rate-limit updates. */
export const PlanSeries = z.object({
  kind: z.string(),
  scope: z.string().nullable(),
  points: z.array(z.object({ at: z.number(), percent: z.number() })),
  /** When the window reset within the period. */
  resets: z.array(z.number()),
});
export type PlanSeries = z.infer<typeof PlanSeries>;

export const PlanHistory = z.object({
  /** The first recorded value for this profile; null before any. */
  since: z.number().nullable(),
  series: z.array(PlanSeries),
});
export type PlanHistory = z.infer<typeof PlanHistory>;
