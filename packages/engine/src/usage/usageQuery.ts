import type { DatabaseSync } from 'node:sqlite';
import { tierOf, type TokenCounts, UsageBreakdown, UsageBucket, UsageGroup, UsagePeriod, UsageRow } from '@switchboard/protocol';
import { hourOf } from './transcriptUsage.ts';
import { measuredDeltas, sharesOf, weightOf, type PlanSample } from './shares.ts';

const HOUR = 3_600_000;

/** The key of the Auto routing row: Haiku's calls that picked a model for new sessions. */
export const AUTO_ROUTING_KEY = 'auto-routing';
/** The key of the Side questions row: what Ask about this session used to answer. */
export const SIDE_QUESTIONS_KEY = 'side-questions';
/** The key of the Catch-up summaries row: Haiku's calls that wrote the briefings on finished turns. */
export const CATCHUP_KEY = 'catch-up-summaries';

/** `YYYY-MM-DD` of a moment in a time zone (UTC when the zone is unknown). */
export function dayKeyFormatter(timeZone: string): (at: number) => string {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    format = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  return (at) => format.format(at);
}

/**
 * Where a period starts, and whether its chart counts hours or local days. The current window starts when the plan
 * says (`windowStart`, five hours before its reset) or five hours ago; 7 and 30 days start at local midnight, so the
 * first day is whole. Days are found hour by hour, as totals are kept per UTC hour.
 */
export function periodRange(period: UsagePeriod, now: number, timeZone: string, windowStart: number | null = null): { from: number; to: number; bucket: 'hour' | 'day' } {
  if (period === 'window') return { from: windowStart ?? now - 5 * HOUR, to: now, bucket: 'hour' };
  if (period === 'day') return { from: now - 24 * HOUR, to: now, bucket: 'hour' };
  const days = period === 'week' ? 7 : 30;
  const dayOf = dayKeyFormatter(timeZone);
  let hour = hourOf(now);
  let seen = 1;
  let key = dayOf(hour);
  // Step back to the first hour of the day `days - 1` days before today.
  for (let i = 0; i < 24 * 32; i++) {
    const previous = dayOf(hour - HOUR);
    if (previous !== key) {
      if (seen === days) break;
      seen++;
      key = previous;
    }
    hour -= HOUR;
  }
  return { from: hour, to: now, bucket: 'day' };
}

const empty = (): TokenCounts => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const addTo = (into: TokenCounts, from: TokenCounts) => {
  into.input += from.input;
  into.output += from.output;
  into.cacheRead += from.cacheRead;
  into.cacheWrite += from.cacheWrite;
};

/** What the breakdown knows about sessions beyond their tokens: the session index, or the folder their transcript named. */
export interface SessionLookup {
  /** A session's title and project, when the session index has it. */
  session(id: string): { title: string; projectRoot: string } | null;
  /** The project a folder belongs to. */
  projectOf(cwd: string): string;
  /** A project's name. */
  projectName(root: string): string;
}

export interface BreakdownQuery {
  scope: string;
  period: UsagePeriod;
  from: number;
  to: number;
  bucket: 'hour' | 'day';
  groupBy: UsageGroup;
  model: string | null;
  timeZone: string;
  /**
   * For the current window: how much of it is used (plan %) and its readings, so sessions that ran alone get a
   * measured share. Left out for other periods.
   */
  measure?: { percent: number; samples: readonly PlanSample[] } | null;
}

interface Hourly {
  session_id: string;
  hour: number;
  model: string;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  turns: number;
  fast_turns: number;
  max_context: number;
}

interface Group {
  key: string;
  tokens: TokenCounts;
  turns: number;
  fastTurns: number;
  largestContext: number;
  sessions: Set<string>;
  /** Weight per model, for a session's main model. */
  models: Map<string, number>;
  /** Helper calls folded in (Auto routing picks, catch-up summaries). */
  picks: number;
  /** Questions about a session folded in. */
  asked: Set<string>;
}

interface Routed {
  id: string;
  at: number;
  model: string;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

/** Where the scope's tokens went in a period: totals, a row per group with its estimated share, and the chart's buckets. */
export function breakdown(db: DatabaseSync, query: BreakdownQuery, lookup: SessionLookup): Omit<UsageBreakdown, 'scan'> {
  const { scope, from, to, groupBy, model, bucket } = query;
  const rows = db
    .prepare(
      `SELECT session_id, hour, model, input, output, cache_read, cache_write, turns, fast_turns, max_context
       FROM session_usage WHERE scope = ? AND hour >= ? AND hour <= ? ${model ? 'AND model = ?' : ''}`,
    )
    .all(...([scope, hourOf(from), to, ...(model ? [model] : [])] as Array<string | number>)) as unknown as Hourly[];

  const dayOf = dayKeyFormatter(query.timeZone);
  const cwds = new Map<string, string | null>();
  const cwdOf = db.prepare('SELECT cwd FROM usage_sessions WHERE scope = ? AND session_id = ?');
  const sessionCwd = (id: string) => {
    if (!cwds.has(id)) cwds.set(id, ((cwdOf.get(scope, id) as { cwd: string | null } | undefined)?.cwd) ?? null);
    return cwds.get(id) ?? null;
  };
  const projectOf = (id: string): string | null => {
    const known = lookup.session(id);
    if (known) return known.projectRoot;
    const cwd = sessionCwd(id);
    return cwd ? lookup.projectOf(cwd) : null;
  };

  const keyOf = (row: Hourly): string => {
    if (groupBy === 'session') return row.session_id;
    if (groupBy === 'model') return row.model;
    if (groupBy === 'day') return dayOf(row.hour);
    return projectOf(row.session_id) ?? '';
  };

  const groups = new Map<string, Group>();
  const newGroup = (key: string): Group => ({ key, tokens: empty(), turns: 0, fastTurns: 0, largestContext: 0, sessions: new Set(), models: new Map(), picks: 0, asked: new Set() });
  const totals = { tokens: empty(), sessions: new Set<string>(), turns: 0, fastTurns: 0, largestContext: 0 };
  const buckets = new Map<string, UsageBucket>();
  const bucketKey = (hour: number) => (bucket === 'hour' ? String(hour) : dayOf(hour));
  // Every bucket of the period, also empty ones, in order.
  for (let hour = hourOf(from); hour <= to; hour += HOUR) {
    const key = bucketKey(hour);
    if (!buckets.has(key)) buckets.set(key, { start: hour, tokens: empty(), turns: 0 });
  }

  for (const row of rows) {
    const tokens: TokenCounts = { input: row.input, output: row.output, cacheRead: row.cache_read, cacheWrite: row.cache_write };
    const key = keyOf(row);
    let group = groups.get(key);
    if (!group) groups.set(key, (group = newGroup(key)));
    addTo(group.tokens, tokens);
    group.turns += row.turns;
    group.fastTurns += row.fast_turns;
    group.largestContext = Math.max(group.largestContext, row.max_context);
    group.sessions.add(row.session_id);
    group.models.set(row.model, (group.models.get(row.model) ?? 0) + weightOf(tokens));
    addTo(totals.tokens, tokens);
    totals.turns += row.turns;
    totals.fastTurns += row.fast_turns;
    totals.largestContext = Math.max(totals.largestContext, row.max_context);
    totals.sessions.add(row.session_id);
    const b = buckets.get(bucketKey(row.hour));
    if (b) {
      addTo(b.tokens, tokens);
      b.turns += row.turns;
    }
  }

  // Auto model's routing calls and the catch-up summaries leave no transcript, so the scanner never sees them: they
  // are kept apart and shown as a row each (in Day, inside their day), so their tokens are never hidden.
  const routed = db
    .prepare(`SELECT id, at, model, input, output, cache_read, cache_write FROM auto_routing WHERE scope = ? AND at >= ? AND at <= ? ${model ? 'AND model = ?' : ''}`)
    .all(...([scope, hourOf(from), to, ...(model ? [model] : [])] as Array<string | number>)) as unknown as Routed[];
  // Ask about this session answers from a short-lived fork that leaves no transcript either: the same, as Side questions.
  const asked = db
    .prepare(`SELECT id, at, model, input, output, cache_read, cache_write FROM side_question_usage WHERE scope = ? AND at >= ? AND at <= ? ${model ? 'AND model = ?' : ''}`)
    .all(...([scope, hourOf(from), to, ...(model ? [model] : [])] as Array<string | number>)) as unknown as Routed[];
  const spoken = db
    .prepare(`SELECT id, at, model, input, output, cache_read, cache_write FROM catchup_usage WHERE scope = ? AND at >= ? AND at <= ? ${model ? 'AND model = ?' : ''}`)
    .all(...([scope, hourOf(from), to, ...(model ? [model] : [])] as Array<string | number>)) as unknown as Routed[];
  const addApart = (row: Routed, rowKey: string, count: (group: Group) => void) => {
    const tokens: TokenCounts = { input: row.input, output: row.output, cacheRead: row.cache_read, cacheWrite: row.cache_write };
    const hour = hourOf(row.at);
    const key = groupBy === 'day' ? dayOf(hour) : rowKey;
    let group = groups.get(key);
    if (!group) groups.set(key, (group = newGroup(key)));
    addTo(group.tokens, tokens);
    group.turns += 1;
    count(group);
    group.models.set(row.model, (group.models.get(row.model) ?? 0) + weightOf(tokens));
    addTo(totals.tokens, tokens);
    totals.turns += 1;
    const b = buckets.get(bucketKey(hour));
    if (b) {
      addTo(b.tokens, tokens);
      b.turns += 1;
    }
  };
  for (const route of routed) addApart(route, AUTO_ROUTING_KEY, (group) => (group.picks += 1));
  // One question can use more than one model: a row per model, `<question id>:<model>`.
  for (const row of asked) addApart(row, SIDE_QUESTIONS_KEY, (group) => group.asked.add(row.id.slice(0, row.id.lastIndexOf(':'))));
  for (const row of spoken) addApart(row, CATCHUP_KEY, (group) => (group.picks += 1));
  /** The model Auto picked for each session, for "· 4 by Auto" on the model rows. */
  const autoPicked =
    groupBy === 'model'
      ? new Map(
          (db.prepare('SELECT session_id AS sessionId, picked FROM auto_routing WHERE scope = ? AND session_id IS NOT NULL AND picked IS NOT NULL').all(scope) as Array<{ sessionId: string; picked: string }>).map(
            (r) => [r.sessionId, r.picked],
          ),
        )
      : new Map<string, string>();

  // Measured shares only mean something per session, in the current window, for everything that ran in it.
  let measured = new Map<string, number>();
  if (groupBy === 'session' && !model && query.measure && query.measure.percent > 0) {
    const messages = db
      .prepare('SELECT at, session_id AS sessionId FROM usage_messages WHERE scope = ? AND at >= ? AND at <= ? ORDER BY at')
      .all(scope, from, to) as Array<{ at: number; sessionId: string }>;
    const points = measuredDeltas(query.measure.samples, messages);
    measured = new Map([...points].filter(([id]) => groups.has(id)).map(([id, delta]) => [id, delta / query.measure!.percent]));
  }
  const shares = sharesOf(
    [...groups.values()].map((g) => ({ key: g.key, weight: weightOf(g.tokens) })),
    measured,
  );

  const result: UsageRow[] = [...groups.values()].map((g) => {
    const share = shares.get(g.key) ?? { share: 0, measured: false };
    const mainModel = [...g.models].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    if (g.key === AUTO_ROUTING_KEY && groupBy !== 'day') {
      return { key: g.key, label: 'Auto routing', sessionId: null, projectRoot: null, model: mainModel, sessions: 0, turns: g.turns, fastTurns: 0, tokens: g.tokens, largestContext: 0, share: share.share, measured: false, autoRouting: { picks: g.picks } };
    }
    if (g.key === SIDE_QUESTIONS_KEY && groupBy !== 'day') {
      return { key: g.key, label: 'Side questions', sessionId: null, projectRoot: null, model: mainModel, sessions: 0, turns: g.turns, fastTurns: 0, tokens: g.tokens, largestContext: 0, share: share.share, measured: false, sideQuestions: { asked: g.asked.size } };
    }
    if (g.key === CATCHUP_KEY && groupBy !== 'day') {
      return { key: g.key, label: 'Catch-up summaries', sessionId: null, projectRoot: null, model: mainModel, sessions: 0, turns: g.turns, fastTurns: 0, tokens: g.tokens, largestContext: 0, share: share.share, measured: false, catchUpSummaries: { calls: g.picks } };
    }
    const base = { key: g.key, sessions: g.sessions.size, turns: g.turns, fastTurns: g.fastTurns, tokens: g.tokens, largestContext: g.largestContext, share: share.share, measured: share.measured };
    if (groupBy === 'session') {
      const known = lookup.session(g.key);
      const root = known?.projectRoot ?? projectOf(g.key);
      return { ...base, label: known?.title ?? 'Session', sessionId: g.key, projectRoot: root, model: mainModel };
    }
    if (groupBy === 'project') return { ...base, label: g.key ? lookup.projectName(g.key) : 'Unknown folder', sessionId: null, projectRoot: g.key || null, model: mainModel };
    if (groupBy === 'model') {
      const tier = tierOf(g.key);
      const byAuto = tier ? [...g.sessions].filter((id) => autoPicked.get(id) === tier).length : 0;
      return { ...base, label: g.key, sessionId: null, projectRoot: null, model: g.key, ...(byAuto ? { byAuto } : {}) };
    }
    return { ...base, label: g.key, sessionId: null, projectRoot: null, model: mainModel };
  });
  // Days in order, newest first; everything else by share.
  result.sort((a, b) => (groupBy === 'day' ? b.label.localeCompare(a.label) : b.share - a.share || b.turns - a.turns));

  return {
    period: query.period,
    from,
    to,
    bucket,
    totals: { tokens: totals.tokens, sessions: totals.sessions.size, turns: totals.turns, fastTurns: totals.fastTurns, largestContext: totals.largestContext },
    rows: result,
    buckets: [...buckets.values()],
  };
}
