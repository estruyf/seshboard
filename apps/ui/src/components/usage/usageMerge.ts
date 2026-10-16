import { REMOTE_FEATURE_USAGE_TOKENS, sharesOf, weightOf, type Computer, type RemoteUsageBreakdown, type TokenCounts, type UsageBreakdown, type UsageBucket, type UsageGroup, type UsageRow } from '@switchboard/protocol/client';

/**
 * The Usage view counts the tokens of the same account on other computers (docs/remote-access.md, "Other
 * computers"): this computer's breakdown and each other computer's `usage.tokens`, made into one.
 */

/** How the breakdown groups its rows: the engine's groupings, and Computer, made here from each computer's totals. */
export type UsageViewGroup = UsageGroup | 'computer';

/** What the engine is asked for a grouping. Computer only needs totals, so it asks for the fewest rows. */
export const engineGroup = (groupBy: UsageViewGroup): UsageGroup => (groupBy === 'computer' ? 'day' : groupBy);

export interface ComputerRef {
  id: string;
  name: string;
}

/** A breakdown row, from this computer or another one. */
export type MergedRow = UsageRow & {
  /** The computer a row's sessions ran on; left out for this computer, and for rows that add up every computer (Model, Day). */
  computer?: ComputerRef;
  /** Another computer's project id and name, in the place of `projectRoot` (another computer never sends its folders). */
  remoteProject?: { id: string | null; name: string | null };
};

export type MergedBreakdown = Omit<UsageBreakdown, 'rows'> & { rows: MergedRow[] };

/** The key of the Computer row for this computer. */
export const THIS_COMPUTER_KEY = 'this-computer';

/** A paired computer whose tokens aren't counted, and why, in a sentence. */
export interface Uncounted {
  computer: ComputerRef;
  reason: string;
}

/** The paired computers to ask for an account's tokens: connected ones whose Switchboard answers `usage.tokens`. */
export function computersToAsk(computers: readonly Computer[]): { ask: ComputerRef[]; uncounted: Uncounted[] } {
  const ask: ComputerRef[] = [];
  const uncounted: Uncounted[] = [];
  for (const { id, name, state, features } of computers) {
    const computer = { id, name };
    if (state === 'connecting') uncounted.push({ computer, reason: `Connecting to ${name}.` });
    else if (state !== 'connected') uncounted.push({ computer, reason: `${name} is offline.` });
    else if (!features.includes(REMOTE_FEATURE_USAGE_TOKENS)) uncounted.push({ computer, reason: `${name} needs a newer Switchboard.` });
    else ask.push(computer);
  }
  return { ask, uncounted };
}

/** Why an asked computer isn't counted: no profile there signs in to the account, or the request failed. */
export const notCounted = (computer: ComputerRef, answer: 'no-account' | 'failed'): Uncounted => ({
  computer,
  reason: answer === 'no-account' ? `No profile on ${computer.name} signs in to this account.` : `Couldn't get the usage from ${computer.name}.`,
});

const add = (into: TokenCounts, from: TokenCounts) => {
  into.input += from.input;
  into.output += from.output;
  into.cacheRead += from.cacheRead;
  into.cacheWrite += from.cacheWrite;
};
const sum = (a: number | undefined, b: number | undefined) => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0));

/**
 * Another computer's row as a merged one, without its project. `apart` (Session, Project) keeps it as its own row: it
 * names the computer and its project, under a key no other computer's row has.
 */
function fromComputer(row: RemoteUsageBreakdown['rows'][number], computer: ComputerRef, apart: boolean): MergedRow {
  const { projectId, projectName, ...rest } = row;
  const plain = { ...rest, projectRoot: null };
  return apart ? { ...plain, key: `${computer.id}:${row.key}`, computer, remoteProject: { id: projectId, name: projectName } } : plain;
}

/** Rows with the same key (a model, a day) as one: their counts added up, the main model of the heaviest. */
function combine(rows: readonly MergedRow[]): MergedRow[] {
  const byKey = new Map<string, { row: MergedRow; weight: number }>();
  for (const row of rows) {
    const weight = weightOf(row.tokens);
    const seen = byKey.get(row.key);
    if (!seen) {
      byKey.set(row.key, { row: { ...row, tokens: { ...row.tokens } }, weight });
      continue;
    }
    const into = seen.row;
    add(into.tokens, row.tokens);
    into.sessions += row.sessions;
    into.turns += row.turns;
    into.fastTurns += row.fastTurns;
    into.largestContext = Math.max(into.largestContext, row.largestContext);
    if (weight > seen.weight) into.model = row.model;
    seen.weight += weight;
    const byAuto = sum(into.byAuto, row.byAuto);
    if (byAuto !== undefined) into.byAuto = byAuto;
    if (into.autoRouting || row.autoRouting) into.autoRouting = { picks: (into.autoRouting?.picks ?? 0) + (row.autoRouting?.picks ?? 0) };
    if (into.sideQuestions || row.sideQuestions) into.sideQuestions = { asked: (into.sideQuestions?.asked ?? 0) + (row.sideQuestions?.asked ?? 0) };
    if (into.catchUpSummaries || row.catchUpSummaries) into.catchUpSummaries = { calls: (into.catchUpSummaries?.calls ?? 0) + (row.catchUpSummaries?.calls ?? 0) };
  }
  return [...byKey.values()].map((v) => v.row);
}

/** A row for one computer's totals, for the Computer grouping. */
function computerRow(data: Pick<UsageBreakdown, 'totals'>, key: string, label: string, computer?: ComputerRef): MergedRow {
  const { tokens, sessions, turns, fastTurns, largestContext } = data.totals;
  return { key, label, sessionId: null, projectRoot: null, model: null, sessions, turns, fastTurns, tokens, largestContext, share: 0, measured: false, ...(computer ? { computer } : {}) };
}

/** Each remote bucket into this computer's bucket that holds its start (the same hour or day, as both use this time zone). */
function mergeBuckets(base: readonly UsageBucket[], others: ReadonlyArray<readonly UsageBucket[]>): UsageBucket[] {
  const buckets = base.map((b) => ({ ...b, tokens: { ...b.tokens } }));
  for (const list of others) {
    for (const bucket of list) {
      let target: UsageBucket | undefined;
      for (const b of buckets) if (b.start <= bucket.start) target = b;
      if (!target) continue;
      add(target.tokens, bucket.tokens);
      target.turns += bucket.turns;
    }
  }
  return buckets;
}

/**
 * This computer's breakdown and other computers' for the same account, period and grouping, as one: totals and chart
 * add up; Session and Project rows stay apart per computer (another computer's are marked with it), Model and Day rows
 * add up, and Computer has a row per computer. Shares are split again over every row: a measured share (the plan's own
 * %, which counts every computer already) stays, the rest goes by weight.
 */
export function mergeBreakdowns(
  local: UsageBreakdown,
  others: ReadonlyArray<{ computer: ComputerRef; breakdown: RemoteUsageBreakdown }>,
  groupBy: UsageViewGroup,
  thisComputer = 'This Mac',
): MergedBreakdown {
  const totals = { ...local.totals, tokens: { ...local.totals.tokens } };
  for (const { breakdown } of others) {
    add(totals.tokens, breakdown.totals.tokens);
    totals.sessions += breakdown.totals.sessions;
    totals.turns += breakdown.totals.turns;
    totals.fastTurns += breakdown.totals.fastTurns;
    totals.largestContext = Math.max(totals.largestContext, breakdown.totals.largestContext);
  }

  let rows: MergedRow[];
  if (groupBy === 'computer') {
    rows = [computerRow(local, THIS_COMPUTER_KEY, thisComputer), ...others.map(({ computer, breakdown }) => computerRow(breakdown, computer.id, computer.name, computer))].filter((r) => r.turns > 0);
  } else if (groupBy === 'model' || groupBy === 'day') {
    rows = combine([...local.rows, ...others.flatMap(({ computer, breakdown }) => breakdown.rows.map((r) => fromComputer(r, computer, false)))]);
  } else {
    rows = [...local.rows, ...others.flatMap(({ computer, breakdown }) => breakdown.rows.map((r) => fromComputer(r, computer, true)))];
  }

  const measured = new Map(rows.filter((r) => r.measured).map((r) => [r.key, r.share]));
  const shares = sharesOf(
    rows.map((r) => ({ key: r.key, weight: weightOf(r.tokens) })),
    measured,
  );
  rows = rows.map((r) => ({ ...r, ...(shares.get(r.key) ?? { share: 0, measured: false }) }));
  rows.sort((a, b) => (groupBy === 'day' ? b.label.localeCompare(a.label) : b.share - a.share || b.turns - a.turns));

  const base = local.buckets.length > 0 ? local.buckets : (others.find((o) => o.breakdown.buckets.length > 0)?.breakdown.buckets ?? []);
  const buckets = mergeBuckets(
    base,
    [local.buckets, ...others.map((o) => o.breakdown.buckets)].filter((list) => list !== base),
  );

  const scans = [local.scan, ...others.map((o) => o.breakdown.scan)].filter((s) => s !== null);
  const scan = scans.length ? { done: scans.reduce((n, s) => n + s.done, 0), total: scans.reduce((n, s) => n + s.total, 0) } : null;

  return { ...local, totals, rows, buckets, scan };
}
