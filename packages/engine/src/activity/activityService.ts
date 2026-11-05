import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { ACTIVITY_MAX_DAYS, RpcError, type ActivityEntry, type ActivityPr, type ActivitySummary, type ActivitySummaryExtra, type ActivitySummaryState, type SessionSummary } from '@seshboard/protocol';
import type { SessionPr } from '../links/linkStore.ts';
import { oneLine } from '../catchUp/turn.ts';
import { attributeCommits, localClock, parseCommits, prDay, sessionDays, uniquePrs, type Commit, type MessageRow, type PromptRow, type SessionDay, type UsageRow } from './activityDays.ts';
import { ActivityStore, type StoredSummary } from './activityStore.ts';
import { DAY_SUMMARY_SYSTEM_PROMPT, daySummaryInput, parseDaySummary } from './daySummary.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** No zone is further than this from UTC: rows this far around the range are read, then sorted into local days. */
const ZONE_MARGIN = 14 * HOUR;
/** How long a project's commits are good for: a page that reloads as tokens come in shouldn't run git each time. */
const GIT_TTL_MS = 60_000;
/** Git commands at once. */
const GIT_AT_ONCE = 6;
/** Today's day in short isn't written again sooner than this when you keep coming back. */
const TODAY_REWRITE_MS = 10 * 60_000;
/** The lines a session shows per day: its last ones. */
const DID_LINES = 6;

export interface ActivityServiceOptions {
  db: DatabaseSync;
  /** A session the index knows; null when its transcript is gone. */
  session(id: string): SessionSummary | null;
  /** Every session of another provider's: their transcripts aren't Claude Code's, so only their last activity counts. */
  providerSessions(): readonly SessionSummary[];
  /** The project a folder belongs to, and a project's name. */
  projectOf(cwd: string): string;
  projectName(root: string): string;
  prsOf(sessionId: string): readonly SessionPr[];
  /** Runs git in a folder; rejects when it can't. */
  git(cwd: string, args: string[]): Promise<string>;
  /** Reads what's new in the transcripts, in the background. */
  refresh(): void;
  /** Asks Haiku on the profile of the day's busiest session; null when it gave nothing in time. */
  ask(sessionIds: readonly string[], input: string, system: string): Promise<string | null>;
  /** Settings › Conversation: "Write the day in short with Haiku". */
  useModel(): boolean;
  now?(): number;
}

/** Activity's numbers and the day in short: made from what Seshboard already keeps, nothing new is tracked. */
export class ActivityService {
  private readonly store: ActivityStore;
  private readonly statements;
  private readonly gitCache = new Map<string, { since: number; at: number; commits: Commit[] }>();
  /** Summaries being written, so two asks for a day share one Haiku call. */
  private readonly writing = new Map<string, Promise<{ summary: ActivitySummary | null; state: ActivitySummaryState }>>();

  constructor(private readonly options: ActivityServiceOptions) {
    const { db } = options;
    this.store = new ActivityStore(db);
    this.statements = {
      messages: db.prepare('SELECT session_id, at FROM usage_messages WHERE at >= ? AND at < ?'),
      prompts: db.prepare('SELECT session_id, at, text FROM usage_prompts WHERE at >= ? AND at < ?'),
      usage: db.prepare('SELECT session_id, hour, model, input, output, cache_read, cache_write, cache_write_1h FROM session_usage WHERE hour >= ? AND hour < ?'),
      turns: db.prepare('SELECT session_id, at, did_json FROM catchup_turns WHERE at >= ? AND at < ? ORDER BY at'),
      hidden: db.prepare('SELECT id FROM session_flags WHERE hidden_at IS NOT NULL'),
      cwd: db.prepare('SELECT cwd FROM usage_sessions WHERE session_id = ? AND cwd IS NOT NULL LIMIT 1'),
    };
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** `activity.range`. */
  async range(params: { from: string; to: string; timeZone: string; git?: boolean }): Promise<ActivityEntry[]> {
    const { from, to, timeZone } = params;
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`) + DAY;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > ACTIVITY_MAX_DAYS * DAY) throw new RpcError('INVALID_PARAMS', `A range goes from one day to ${ACTIVITY_MAX_DAYS} days.`);
    this.options.refresh();
    const low = start - ZONE_MARGIN;
    const high = end + ZONE_MARGIN;
    const clock = localClock(timeZone);
    const inRange = (day: string) => day >= from && day <= to;
    const hidden = new Set((this.statements.hidden.all() as Array<{ id: string }>).map((row) => row.id));
    const visible = <T extends { session_id: string }>(rows: T[]) => rows.filter((row) => !hidden.has(row.session_id));

    const days = sessionDays(
      {
        messages: visible(this.statements.messages.all(low, high) as unknown as MessageRow[]),
        prompts: visible(this.statements.prompts.all(low, high) as unknown as PromptRow[]),
        usage: visible(this.statements.usage.all(low - HOUR, high) as unknown as UsageRow[]),
      },
      clock,
      inRange,
    );

    // What the catch-ups of each turn said, per session and day.
    const did = new Map<string, string[]>();
    for (const row of this.statements.turns.all(low, high) as Array<{ session_id: string; at: number; did_json: string }>) {
      const day = clock.dayOf(row.at);
      if (!inRange(day)) continue;
      const key = `${day}\0${row.session_id}`;
      did.set(key, [...(did.get(key) ?? []), ...readLines(row.did_json)]);
    }

    const roots = new Map<SessionDay, string | null>();
    for (const day of days) roots.set(day, this.rootOf(day.sessionId));
    const commits = params.git === false ? new Map<SessionDay, Commit[]>() : await this.commitsOf(days, roots, start - ZONE_MARGIN);
    const prs = this.prsByDay(days, clock.dayOf);

    const entries = days.map((day): ActivityEntry => {
      const session = this.options.session(day.sessionId);
      const root = roots.get(day) ?? null;
      const made = commits.get(day) ?? [];
      const lines = [...new Set(did.get(`${day.day}\0${day.sessionId}`) ?? [])].slice(-DID_LINES);
      return {
        day: day.day,
        sessionId: day.sessionId,
        title: session?.title || (day.asks[0] ? oneLine(day.asks[0], 80) : 'A session that is gone'),
        parentId: session?.parentId ?? null,
        projectRoot: root,
        projectName: root ? this.options.projectName(root) : 'Other',
        firstAt: day.firstAt,
        lastAt: day.lastAt,
        activeMs: day.activeMs,
        turns: day.turns,
        costUsd: day.costUsd,
        hours: day.hours,
        commits: made.length,
        files: new Set(made.flatMap((commit) => commit.files)).size,
        prs: prs.get(`${day.day}\0${day.sessionId}`) ?? [],
        did: lines,
        asks: day.asks,
        available: session !== null,
      };
    });
    return [...entries, ...this.providerEntries(clock, inRange, hidden)];
  }

  /** The folder a session's project is in: from the index, or the folder its transcript named. */
  private rootOf(sessionId: string): string | null {
    const known = this.options.session(sessionId);
    if (known) return known.projectRoot;
    const row = this.statements.cwd.get(sessionId) as { cwd: string } | undefined;
    return row ? this.options.projectOf(row.cwd) : null;
  }

  /** Another provider's sessions have no moments here: they show on the day of their last activity, without a time. */
  private providerEntries(clock: ReturnType<typeof localClock>, inRange: (day: string) => boolean, hidden: ReadonlySet<string>): ActivityEntry[] {
    return this.options.providerSessions().flatMap((session): ActivityEntry[] => {
      const day = clock.dayOf(session.updatedAt);
      if (!inRange(day) || hidden.has(session.id)) return [];
      const hours = new Array<number>(24).fill(0);
      hours[clock.hourOf(session.updatedAt)] = 1;
      return [{
        day,
        sessionId: session.id,
        title: session.title,
        parentId: session.parentId ?? null,
        projectRoot: session.projectRoot,
        projectName: this.options.projectName(session.projectRoot),
        firstAt: session.updatedAt,
        lastAt: session.updatedAt,
        activeMs: 0,
        turns: 0,
        costUsd: null,
        hours,
        commits: 0,
        files: 0,
        prs: [],
        did: [],
        asks: [],
        available: true,
      }];
    });
  }

  /** The commits made during each session's day, project by project. */
  private async commitsOf(days: readonly SessionDay[], roots: ReadonlyMap<SessionDay, string | null>, since: number): Promise<Map<SessionDay, Commit[]>> {
    const byRoot = new Map<string, SessionDay[]>();
    for (const day of days) {
      const root = roots.get(day);
      if (root) byRoot.set(root, [...(byRoot.get(root) ?? []), day]);
    }
    const out = new Map<SessionDay, Commit[]>();
    const queue = [...byRoot];
    const work = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const [root, list] = next;
        for (const [day, commits] of attributeCommits(await this.commitsIn(root, since), list)) out.set(day, commits);
      }
    };
    await Promise.all(Array.from({ length: GIT_AT_ONCE }, work));
    return out;
  }

  /**
   * Your commits in a project since a moment, on every branch (a worktree's too). Only the lower date is given to git:
   * a rebase later on moves a commit's committer date forward, and git filters on that one. A folder that isn't a
   * repository, or is gone, simply has none.
   */
  private async commitsIn(root: string, since: number): Promise<Commit[]> {
    const cached = this.gitCache.get(root);
    if (cached && cached.since <= since && this.now() - cached.at < GIT_TTL_MS) return cached.commits;
    let commits: Commit[] = [];
    try {
      const email = (await this.options.git(root, ['config', 'user.email']).catch(() => '')).trim();
      const output = await this.options.git(root, ['log', '--all', '--no-merges', `--since=${Math.floor(since / 1000)}`, ...(email ? ['--fixed-strings', `--author=${email}`] : []), '--format=%x00%H%x09%at%x09%s', '--name-only']);
      commits = parseCommits(output);
    } catch {
      // Not a repository (any more).
    }
    this.gitCache.set(root, { since, at: this.now(), commits });
    return commits;
  }

  /** Each session's pull requests on the day they belong to. */
  private prsByDay(days: readonly SessionDay[], dayOf: (at: number) => string): Map<string, ActivityPr[]> {
    const daysOf = new Map<string, string[]>();
    for (const { sessionId, day } of days) daysOf.set(sessionId, [...(daysOf.get(sessionId) ?? []), day]);
    const out = new Map<string, ActivityPr[]>();
    for (const [sessionId, list] of daysOf) {
      for (const pr of this.options.prsOf(sessionId)) {
        const day = prDay(pr.seenAt, list, dayOf);
        if (!day) continue;
        const key = `${day}\0${sessionId}`;
        out.set(key, uniquePrs([...(out.get(key) ?? []), { number: pr.number, url: pr.url }]));
      }
    }
    return out;
  }

  /** `activity.summary`: see the contract for when it is written. */
  async summary(params: { day: string; timeZone: string; fresh: boolean; others: readonly ActivitySummaryExtra[] }): Promise<{ summary: ActivitySummary | null; state: ActivitySummaryState }> {
    const { day, timeZone, fresh, others } = params;
    if (!this.options.useModel()) return { summary: null, state: 'off' };
    const entries = await this.range({ from: day, to: day, timeZone, git: false });
    if (entries.length + others.length === 0) return { summary: null, state: 'empty' };
    const input = daySummaryInput(entries, others);
    const inputHash = createHash('sha1').update(input).digest('hex');
    const stored = this.store.get(day);
    const now = this.now();
    const past = day < localClock(timeZone).dayOf(now);
    if (stored && !fresh) {
      if (stored.final) return { summary: publicOf(stored), state: 'ok' };
      if (!past && (stored.inputHash === inputHash || now - stored.generatedAt < TODAY_REWRITE_MS)) return { summary: publicOf(stored), state: 'ok' };
    }
    const running = this.writing.get(day);
    if (running) return running;
    const write = (async () => {
      const busiest = [...entries].sort((a, b) => b.activeMs - a.activeMs).map((entry) => entry.sessionId);
      const text = parseDaySummary(await this.options.ask(busiest, input, DAY_SUMMARY_SYSTEM_PROMPT).catch(() => null));
      if (!text) return { summary: stored ? publicOf(stored) : null, state: 'failed' as const };
      const saved: StoredSummary = { text, generatedAt: this.now(), sessions: entries.length + others.length, inputHash, final: past };
      this.store.save(day, saved);
      return { summary: publicOf(saved), state: 'ok' as const };
    })();
    this.writing.set(day, write);
    return write.finally(() => this.writing.delete(day));
  }
}

const publicOf = ({ text, generatedAt, sessions }: StoredSummary): ActivitySummary => ({ text, generatedAt, sessions });

function readLines(json: string): string[] {
  try {
    const lines: unknown = JSON.parse(json);
    return Array.isArray(lines) ? lines.filter((line): line is string => typeof line === 'string') : [];
  } catch {
    return [];
  }
}
