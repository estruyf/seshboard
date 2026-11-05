import { costOf, type ActivityPr } from '@seshboard/protocol';

/** A pause longer than this isn't work: you were away, or Claude waited for you. */
export const IDLE_MS = 5 * 60_000;
/** How close to a moment of a session a commit must be to count as made in it. */
export const COMMIT_NEAR_MS = 5 * 60_000;

const SLOT = 15 * 60_000;

/** The local day and hour of a moment. Zones change on the quarter hour, so each quarter is only worked out once. */
export function localClock(timeZone: string): { dayOf(at: number): string; hourOf(at: number): number } {
  let format: Intl.DateTimeFormat;
  const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' } as const;
  try {
    format = new Intl.DateTimeFormat('en-CA', { ...options, timeZone });
  } catch {
    format = new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' });
  }
  const slots = new Map<number, { day: string; hour: number }>();
  const slotOf = (at: number) => {
    const slot = Math.floor(at / SLOT);
    let known = slots.get(slot);
    if (!known) {
      const parts = Object.fromEntries(format.formatToParts(slot * SLOT).map((p) => [p.type, p.value]));
      known = { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
      slots.set(slot, known);
    }
    return known;
  };
  return { dayOf: (at) => slotOf(at).day, hourOf: (at) => slotOf(at).hour };
}

export interface MessageRow {
  session_id: string;
  at: number;
}
export interface PromptRow extends MessageRow {
  text: string;
}
export interface UsageRow {
  session_id: string;
  hour: number;
  model: string;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  cache_write_1h: number;
}

/** A session's day, from its transcript alone. */
export interface SessionDay {
  day: string;
  sessionId: string;
  /** Every moment of it, in order. */
  moments: number[];
  firstAt: number;
  lastAt: number;
  activeMs: number;
  hours: number[];
  turns: number;
  asks: string[];
  costUsd: number | null;
}

/**
 * Splits the transcripts' moments into a session's days. Working time adds up the gaps between moments, leaving out the
 * pauses (`IDLE_MS`), and counts for the hour a gap ends in. Tokens are kept per UTC hour, so the cost of an hour that
 * crosses midnight in a half-hour zone goes to the day that hour starts in, or else the day it ends in.
 */
export function sessionDays(rows: { messages: readonly MessageRow[]; prompts: readonly PromptRow[]; usage: readonly UsageRow[] }, clock: ReturnType<typeof localClock>, inRange: (day: string) => boolean): SessionDay[] {
  const days = new Map<string, SessionDay>();
  const at = (sessionId: string, day: string) => {
    const key = `${day}\0${sessionId}`;
    let found = days.get(key);
    if (!found) {
      found = { day, sessionId, moments: [], firstAt: 0, lastAt: 0, activeMs: 0, hours: new Array<number>(24).fill(0), turns: 0, asks: [], costUsd: null };
      days.set(key, found);
    }
    return found;
  };
  for (const { session_id, at: when } of rows.messages) {
    const day = clock.dayOf(when);
    if (inRange(day)) at(session_id, day).moments.push(when);
  }
  // Oldest first, as the asks read in order.
  for (const { session_id, at: when, text } of [...rows.prompts].sort((a, b) => a.at - b.at)) {
    const day = clock.dayOf(when);
    if (!inRange(day)) continue;
    const entry = at(session_id, day);
    entry.moments.push(when);
    entry.turns++;
    entry.asks.push(text);
  }
  for (const entry of days.values()) {
    entry.moments.sort((a, b) => a - b);
    entry.firstAt = entry.moments[0]!;
    entry.lastAt = entry.moments[entry.moments.length - 1]!;
    for (let i = 1; i < entry.moments.length; i++) {
      const gap = entry.moments[i]! - entry.moments[i - 1]!;
      if (gap > IDLE_MS) continue;
      entry.activeMs += gap;
      entry.hours[clock.hourOf(entry.moments[i]!)]! += gap;
    }
    // A moment on its own is still a moment of work: the ribbon shows that hour.
    if (entry.activeMs === 0) entry.hours[clock.hourOf(entry.firstAt)]! += 1;
  }
  for (const row of rows.usage) {
    const entry = days.get(`${clock.dayOf(row.hour)}\0${row.session_id}`) ?? days.get(`${clock.dayOf(row.hour + 3_599_999)}\0${row.session_id}`);
    if (!entry) continue;
    const cost = costOf({ input: row.input, output: row.output, cacheRead: row.cache_read, cacheWrite: row.cache_write, cacheWrite1h: row.cache_write_1h }, row.model);
    if (cost !== null) entry.costUsd = (entry.costUsd ?? 0) + cost;
  }
  return [...days.values()];
}

export interface Commit {
  hash: string;
  /** When it was written (the author's date, which a rebase keeps). */
  at: number;
  subject: string;
  files: string[];
}

/** Reads `git log --format=%x00%H%x09%at%x09%s --name-only`. A commit a rebase copied, with the same time and subject, counts once. */
export function parseCommits(output: string): Commit[] {
  const seen = new Set<string>();
  const commits: Commit[] = [];
  for (const chunk of output.split('\0')) {
    const lines = chunk.split('\n');
    const [hash, at, ...subject] = (lines[0] ?? '').split('\t');
    const seconds = Number(at);
    if (!hash || !Number.isFinite(seconds)) continue;
    const key = `${at}\t${subject.join('\t')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    commits.push({ hash, at: seconds * 1000, subject: subject.join('\t'), files: lines.slice(1).map((l) => l.trim()).filter(Boolean) });
  }
  return commits;
}

/** A commit's session and day: the session of the moment nearest to it, within `COMMIT_NEAR_MS`. */
export function attributeCommits(commits: readonly Commit[], days: readonly SessionDay[]): Map<SessionDay, Commit[]> {
  const moments = days.flatMap((day) => day.moments.map((at) => ({ at, day }))).sort((a, b) => a.at - b.at);
  const out = new Map<SessionDay, Commit[]>();
  if (moments.length === 0) return out;
  for (const commit of commits) {
    let low = 0;
    let high = moments.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (moments[middle]!.at < commit.at) low = middle + 1;
      else high = middle;
    }
    const after = moments[low]!;
    const before = moments[low - 1];
    const nearest = before && commit.at - before.at <= Math.abs(after.at - commit.at) ? before : after;
    if (Math.abs(nearest.at - commit.at) > COMMIT_NEAR_MS) continue;
    out.set(nearest.day, [...(out.get(nearest.day) ?? []), commit]);
  }
  return out;
}

/**
 * The day a pull request belongs on: the day it was seen, or else the session's last day before it (a session whose
 * transcript was only read later, as a branch's pull request is found later). Null when it came before them all.
 */
export function prDay(seenAt: number, sessionDayList: readonly string[], dayOf: (at: number) => string): string | null {
  const seen = dayOf(seenAt);
  const earlier = sessionDayList.filter((day) => day <= seen).sort();
  return earlier[earlier.length - 1] ?? null;
}

/** Each pull request once, keeping the order. */
export function uniquePrs(prs: readonly ActivityPr[]): ActivityPr[] {
  return [...new Map(prs.map((pr) => [pr.url, pr])).values()];
}
