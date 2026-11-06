import { ACTIVITY_MAX_DAYS, type ActivityEntry, type ActivitySummaryExtra } from '@seshboard/protocol/client';

/** Days in the strip, and what an arrow moves it by. */
export const WEEK_DAYS = 7;
/** How far "the last day you worked" looks back: all of last week's working days, also from a Monday. */
export const LOOK_BACK_DAYS = 7;

/** An entry of this computer, or of another one (`computer`, whose project is only a name). */
export type ActivityRow = Omit<ActivityEntry, 'projectRoot'> & {
  projectRoot: string | null;
  computer?: { id: string; name: string };
};

export const rowKey = (row: Pick<ActivityRow, 'sessionId' | 'computer'>) => `${row.computer?.id ?? ''}:${row.sessionId}`;

// --- Days ------------------------------------------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

/** The local day of a moment. */
export function dayOf(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Noon of a day, as dates only: a clock change never moves it to another day. */
const noon = (day: string) => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year!, month! - 1, date!, 12);
};

export function addDays(day: string, days: number): string {
  const date = noon(day);
  date.setDate(date.getDate() + days);
  return dayOf(date.getTime());
}

/** The Monday of a day's week. Weeks start on Monday everywhere: a region's own first day isn't what a timesheet goes by. */
export const mondayOf = (day: string): string => addDays(day, -((noon(day).getDay() + 6) % WEEK_DAYS));

/** The seven days of the week that starts on `monday`. */
export const weekOf = (monday: string): string[] => Array.from({ length: WEEK_DAYS }, (_, i) => addDays(monday, i));

/** The week the strip shows for a day: its Monday, or null for this week, so the strip follows today over a Sunday night. */
export const stripWeek = (day: string | null, today: string): string | null => (!day || mondayOf(day) === mondayOf(today) ? null : mondayOf(day));

export const weekdayShort = (day: string, locale?: string) => noon(day).toLocaleDateString(locale, { weekday: 'short' });
export const weekdayLong = (day: string, locale?: string) => noon(day).toLocaleDateString(locale, { weekday: 'long' });
export const dayNumber = (day: string) => noon(day).getDate();
export const dayTitle = (day: string, locale?: string) => noon(day).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
export const dayShort = (day: string, locale?: string) => noon(day).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

// --- A range of days -------------------------------------------------------------------------------------------------

/** From a day till another; `to` null is till today, whichever day that is. */
export interface DayRange {
  from: string;
  to: string | null;
}

/** The days a range covers now. One till today that has grown past what the engine answers keeps its end: its start moves up. */
export function rangeDays(range: DayRange, today: string): { from: string; to: string } {
  const to = range.to && range.to < today ? range.to : today;
  const earliest = addDays(to, 1 - ACTIVITY_MAX_DAYS);
  return { from: range.from < earliest ? earliest : range.from > to ? to : range.from, to };
}

/** A new start. The end moves along when it has to, so any day can be picked: January stays reachable from a range till today. */
export function pickFrom(range: DayRange, from: string, today: string): DayRange {
  const { to } = rangeDays(range, today);
  if (from > to) return { from, to: from >= today ? null : from };
  const last = addDays(from, ACTIVITY_MAX_DAYS - 1);
  return to > last ? { from, to: last } : { from, to: range.to };
}

/** A new end, null or today being till today. The start moves along when it has to. */
export function pickTill(range: DayRange, till: string | null, today: string): DayRange {
  const to = till === null || till >= today ? null : till;
  const last = to ?? today;
  const earliest = addDays(last, 1 - ACTIVITY_MAX_DAYS);
  return { from: range.from > last ? last : range.from < earliest ? earliest : range.from, to };
}

/** A day in short, with its year when that isn't this year's: a range can go back that far. */
export const dayLabel = (day: string, today: string, locale?: string) => noon(day).toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }) });

export function rangeTitle(range: DayRange, today: string, locale?: string): string {
  const { from, to } = rangeDays(range, today);
  return `${dayLabel(from, today, locale)} till ${range.to && range.to < today ? dayLabel(to, today, locale) : 'today'}`;
}

/** Every day from `from` through `to`. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** The rows of the days from `from` through `to`. */
export const inDays = <T extends { day: string }>(rows: readonly T[], from: string, to: string): T[] => rows.filter((row) => row.day >= from && row.day <= to);

// --- The calendar ----------------------------------------------------------------------------------------------------

/** The first of a day's month. */
export const monthOf = (day: string): string => `${day.slice(0, 7)}-01`;

export function addMonths(month: string, months: number): string {
  const date = noon(month);
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  return dayOf(date.getTime());
}

/** The same day in another month, or the last one it has: PageDown from the 31st of January lands on February's last. */
export function sameDayInMonth(day: string, months: number): string {
  const month = addMonths(monthOf(day), months);
  const last = addDays(addMonths(month, 1), -1);
  const same = `${month.slice(0, 8)}${day.slice(8)}`;
  return same > last ? last : same;
}

export const monthTitle = (month: string, locale?: string) => noon(month).toLocaleDateString(locale, { month: 'long', year: 'numeric' });

/** A month as whole weeks from Monday, with the days of the months around it. */
export function calendarWeeks(month: string): string[][] {
  const weeks: string[][] = [];
  const next = addMonths(month, 1);
  for (let monday = mondayOf(month); monday < next; monday = addDays(monday, WEEK_DAYS)) weeks.push(weekOf(monday));
  return weeks;
}

/** How much time reads: "48m", "2h 05m", "13h"; under a minute "<1m", none at all "–". */
export function formatWorked(ms: number): string {
  if (ms <= 0) return '–';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return '<1m';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${pad(rest)}m`;
}

/** The same in short, for under a bar: "45m", "16h" (rounded to the hour); under a minute "<1m", none at all "–". */
export function formatWorkedShort(ms: number): string {
  if (ms <= 0) return '–';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return '<1m';
  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
}

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** How many pills a session's row has for its pull requests. A session can have dozens; the open row lists them all. */
const ROW_PR_PILLS = 2;

/** The pull requests a session's row names, and the rest, which share one pill with their count. */
export function rowPrs(prs: ActivityRow['prs']): { named: ActivityRow['prs']; rest: ActivityRow['prs'] } {
  const named = prs.length <= ROW_PR_PILLS ? prs : prs.slice(0, ROW_PR_PILLS - 1);
  return { named, rest: prs.slice(named.length) };
}

// --- Numbers ---------------------------------------------------------------------------------------------------------

export interface ActivityStats {
  /** Each session once, however many days it spans. */
  sessions: number;
  turns: number;
  activeMs: number;
  commits: number;
  /** Each pull request once. */
  prs: number;
  /** Null when no session's cost is known. */
  costUsd: number | null;
}

export function statsOf(rows: readonly ActivityRow[]): ActivityStats {
  const known = rows.filter((row) => row.costUsd !== null);
  return {
    sessions: new Set(rows.map(rowKey)).size,
    turns: rows.reduce((sum, row) => sum + row.turns, 0),
    activeMs: rows.reduce((sum, row) => sum + row.activeMs, 0),
    commits: rows.reduce((sum, row) => sum + row.commits, 0),
    prs: new Set(rows.flatMap((row) => row.prs.map((pr) => pr.url))).size,
    costUsd: known.length ? known.reduce((sum, row) => sum + row.costUsd!, 0) : null,
  };
}

/** Sessions per day: whether a day had any, and what an empty day says about the days around it. */
export function countsByDay(rows: readonly ActivityRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.day, (counts.get(row.day) ?? 0) + 1);
  return counts;
}

/** Each day's numbers, for the strip's bars and their tooltips. A day without rows has none. */
export function statsByDay(rows: readonly ActivityRow[]): Map<string, ActivityStats> {
  const byDay = new Map<string, ActivityRow[]>();
  for (const row of rows) byDay.set(row.day, [...(byDay.get(row.day) ?? []), row]);
  return new Map([...byDay].map(([day, ofDay]) => [day, statsOf(ofDay)]));
}

// --- The activity score ----------------------------------------------------------------------------------------------

/**
 * A day's bar is its activity score: each part is the day's number over the same number on a typical day, capped at
 * `SCORE_CAP` so one huge number (a bulk rename's 184 commits) can't take the bar over, then weighted and summed, ×100.
 * So 100 is a typical day. Sessions and cost are left out: a session is a container, not work, and cost follows the
 * model more than the work. Both stay in the tooltip.
 */
export const SCORE_WEIGHTS = { time: 0.45, turns: 0.3, shipped: 0.25 } as const;
export type ScorePart = keyof typeof SCORE_WEIGHTS;
/** From the bottom of the bar up. */
export const SCORE_PARTS: readonly ScorePart[] = ['time', 'turns', 'shipped'];
export const SCORE_CAP = 3;
/** The strip's scale never goes under this, so a quiet week looks quiet instead of stretching to full height. */
export const SCORE_SCALE_MIN = 200;
/** A pull request counts as this many commits in what a day shipped. */
export const PR_WEIGHT = 3;
/** The typical day is the median of the active days in this many days before the strip's first day. */
export const TYPICAL_DAYS = 28;
/** With fewer active days than this in those weeks, the typical day is the median of the days on screen. */
export const TYPICAL_MIN_DAYS = 5;
/**
 * The least a typical day counts for each part. A typical day without commits (or, in theory, without time or turns)
 * would make any commit infinitely many typical days: the part is capped anyway, and this keeps one commit at one.
 */
const TYPICAL_FLOOR: Record<ScorePart, number> = { time: 60_000, turns: 1, shipped: 1 };

/** What a day shipped: its commits, and each pull request (counted once that day) as `PR_WEIGHT` commits. */
export const shippedOf = (stats: Pick<ActivityStats, 'commits' | 'prs'>) => stats.commits + PR_WEIGHT * stats.prs;

const partsOf = (stats: ActivityStats): Record<ScorePart, number> => ({ time: stats.activeMs, turns: stats.turns, shipped: shippedOf(stats) });

/** A typical day's numbers. `fromShown`: there was too little history, so it is the days on screen. */
export interface TypicalDay {
  time: number;
  turns: number;
  shipped: number;
  fromShown: boolean;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/**
 * The typical day: per part, the median over the active days (days with a session) of `history`, the weeks before the
 * strip. With fewer than `TYPICAL_MIN_DAYS` of those, the median of the active days in `shown`. Null when neither has
 * one. Pass every project's rows: with a project picked, its bars read as a share of a normal day.
 */
export function typicalDay(history: readonly ActivityRow[], shown: readonly ActivityRow[]): TypicalDay | null {
  const before = [...statsByDay(history).values()];
  const fromShown = before.length < TYPICAL_MIN_DAYS;
  const days = fromShown ? [...statsByDay(shown).values()] : before;
  if (!days.length) return null;
  const parts = days.map(partsOf);
  const typical = (part: ScorePart) => Math.max(TYPICAL_FLOOR[part], median(parts.map((p) => p[part])));
  return { time: typical('time'), turns: typical('turns'), shipped: typical('shipped'), fromShown };
}

/** A day's score, and what each part adds to it. */
export interface DayScore {
  total: number;
  parts: Record<ScorePart, number>;
}

export function dayScore(stats: ActivityStats | undefined, typical: TypicalDay | null): DayScore {
  const parts: Record<ScorePart, number> = { time: 0, turns: 0, shipped: 0 };
  if (stats && typical) {
    const values = partsOf(stats);
    for (const part of SCORE_PARTS) parts[part] = 100 * SCORE_WEIGHTS[part] * Math.min(SCORE_CAP, values[part] / typical[part]);
  }
  return { total: parts.time + parts.turns + parts.shipped, parts };
}

/** The score at the top of the strip: the busiest day on it, but never under `SCORE_SCALE_MIN`. */
export const scoreScale = (scores: Iterable<DayScore>) => Math.max(SCORE_SCALE_MIN, ...[...scores].map((s) => s.total));

/** "1.5× a typical day". */
export const timesTypical = (score: DayScore) => `${(score.total / 100).toFixed(1)}× a typical day`;

/** The height of the strip's bars, and the gap between a bar's parts. */
export const BAR_FULL = 56;
export const BAR_GAP = 2;
/** The bar of a day without anything to count. */
export const BAR_STUB = 3;

/**
 * A day's bar in pixels: its parts from the bottom up, the empty ones left out, with `BAR_GAP` between them. Null for a
 * day without a score, which shows a stub. Each part keeps at least a pixel, so a bar can come out a little taller.
 */
export function barParts(score: DayScore, scale: number, full = BAR_FULL): Array<{ part: ScorePart; px: number }> | null {
  if (score.total <= 0 || scale <= 0) return null;
  const shown = SCORE_PARTS.filter((part) => score.parts[part] > 0);
  const gaps = BAR_GAP * (shown.length - 1);
  const height = Math.max(4, Math.round((score.total / scale) * full));
  const room = Math.max(shown.length, height - gaps);
  const parts = shown.map((part) => ({ part, px: Math.max(1, Math.round((room * score.parts[part]) / score.total)) }));
  // Rounding can leave the sum a pixel off: the largest part takes the difference.
  const largest = parts.reduce((a, b) => (b.px > a.px ? b : a));
  largest.px = Math.max(1, largest.px + room - parts.reduce((sum, p) => sum + p.px, 0));
  return parts;
}

/** The strip's bars: each day's numbers and score, and the scale they are drawn on. */
export interface StripBars {
  stats: ReadonlyMap<string, ActivityStats>;
  scores: ReadonlyMap<string, DayScore>;
  scale: number;
  typical: TypicalDay | null;
}

export function stripBars(days: readonly string[], rows: readonly ActivityRow[], typical: TypicalDay | null): StripBars {
  const stats = statsByDay(inDays(rows, days[0] ?? '', days[days.length - 1] ?? ''));
  const scores = new Map(days.map((day) => [day, dayScore(stats.get(day), typical)]));
  return { stats, scores, scale: scoreScale(scores.values()), typical };
}

/** Where the typical-day line sits, in pixels from the bottom of the bars. */
export const typicalLine = (scale: number, full = BAR_FULL) => Math.round((100 / scale) * full);

/** The hour ribbon: the time worked per hour, and how strong each cell shows (0 nothing, 4 the busiest). */
export function ribbonOf(rows: readonly ActivityRow[]): Array<{ ms: number; level: 0 | 1 | 2 | 3 | 4 }> {
  const hours = Array.from({ length: 24 }, (_, hour) => rows.reduce((sum, row) => sum + (row.hours[hour] ?? 0), 0));
  const max = Math.max(...hours);
  return hours.map((ms) => ({ ms, level: ms <= 0 ? 0 : (Math.max(1, Math.ceil((ms / max) * 4)) as 1 | 2 | 3 | 4) }));
}

// --- Projects --------------------------------------------------------------------------------------------------------

export interface ProjectGroup {
  key: string;
  name: string;
  /** This computer's folder for it; null when it is only on another computer. */
  root: string | null;
  /** The computer of a project that is only there, for its icon. */
  computerId: string | null;
  rows: ActivityRow[];
  activeMs: number;
  /** Sessions, each once. */
  sessions: number;
}

/**
 * A project a row counts under. The same project on another computer has the same name, so it joins this computer's;
 * a project only there has a key of its own.
 */
export function projectKeyOf(row: ActivityRow, rootsByName: ReadonlyMap<string, string>): string {
  if (row.projectRoot) return row.projectRoot;
  return rootsByName.get(row.projectName) ?? `name:${row.projectName}`;
}

/**
 * Rows grouped by project, the most time first; inside one, sessions by when they started. `known` are the rows that say
 * which folder a name belongs to: a day with only another computer's session keeps the key the whole strip gives its project.
 */
export function projectGroups(rows: readonly ActivityRow[], known: readonly ActivityRow[] = rows): ProjectGroup[] {
  const rootsByName = new Map(known.flatMap((row) => (row.projectRoot ? [[row.projectName, row.projectRoot] as const] : [])));
  const groups = new Map<string, ProjectGroup>();
  for (const row of rows) {
    const key = projectKeyOf(row, rootsByName);
    let group = groups.get(key);
    if (!group) {
      const root = row.projectRoot ?? rootsByName.get(row.projectName) ?? null;
      group = { key, name: row.projectName, root, computerId: root ? null : (row.computer?.id ?? null), rows: [], activeMs: 0, sessions: 0 };
      groups.set(key, group);
    }
    group.rows.push(row);
    group.activeMs += row.activeMs;
  }
  for (const group of groups.values()) {
    group.rows.sort((a, b) => a.firstAt - b.firstAt);
    group.sessions = new Set(group.rows.map(rowKey)).size;
  }
  return [...groups.values()].sort((a, b) => b.activeMs - a.activeMs || b.sessions - a.sessions || a.name.localeCompare(b.name));
}

/** The rows of a project picked in the bars; every row with none picked. */
export function inProject(rows: readonly ActivityRow[], key: string | null): ActivityRow[] {
  if (!key) return [...rows];
  const rootsByName = new Map(rows.flatMap((row) => (row.projectRoot ? [[row.projectName, row.projectRoot] as const] : [])));
  return rows.filter((row) => projectKeyOf(row, rootsByName) === key);
}

/** A project's bar: its share of the time on screen. With no time known it shares by sessions. */
export function projectShare(group: ProjectGroup, groups: readonly ProjectGroup[]): number {
  const time = groups.reduce((sum, g) => sum + g.activeMs, 0);
  if (time > 0) return group.activeMs / time;
  const sessions = groups.reduce((sum, g) => sum + g.sessions, 0);
  return sessions ? group.sessions / sessions : 0;
}

// --- An empty day ----------------------------------------------------------------------------------------------------

/** What a day without sessions says about the days around it: "← Saturday had 1 · Monday had 8 →". Today has no day after. */
export function neighbourLine(day: string, today: string, counts: ReadonlyMap<string, number>, locale?: string): string {
  const say = (other: string) => `${weekdayLong(other, locale)} had ${counts.get(other) ?? 0}`;
  const before = `← ${say(addDays(day, -1))}`;
  const next = addDays(day, 1);
  return next > today ? before : `${before} · ${say(next)} →`;
}

/** The last day with sessions before `today` (a Monday's yesterday is Friday's work), up to `LOOK_BACK_DAYS` back. Null without one. */
export function lastActiveDay(today: string, counts: ReadonlyMap<string, number>): string | null {
  for (let back = 1; back <= LOOK_BACK_DAYS; back++) {
    const day = addDays(today, -back);
    if ((counts.get(day) ?? 0) > 0) return day;
  }
  return null;
}

/** What that day is called: "Yesterday", else its weekday. */
export const lastDayLabel = (day: string, today: string, locale?: string) => (day === addDays(today, -1) ? 'Yesterday' : weekdayLong(day, locale));

// --- The day in short ------------------------------------------------------------------------------------------------

/** The summary's text as plain parts and the project names Haiku marked with `**`. Never parsed as HTML. */
export function summaryParts(text: string): Array<{ text: string; bold: boolean }> {
  return text
    .split('**')
    .map((part, i, all) => ({ text: part, bold: i % 2 === 1 && i < all.length - 1 }))
    .filter((part) => part.text);
}

/** The summary as one plain line, for where bold doesn't show. */
export const summaryPlain = (text: string) => text.replaceAll('**', '');

/** The other computers' rows, for the day in short (the engine only knows its own). */
export function summaryExtras(rows: readonly ActivityRow[]): ActivitySummaryExtra[] {
  return rows
    .filter((row) => row.computer)
    .slice(0, 200)
    .map((row) => ({ title: row.title.slice(0, 300), projectName: row.projectName.slice(0, 300), activeMs: row.activeMs, did: row.did.slice(-8).map((l) => l.slice(0, 300)), asks: row.asks.slice(0, 8).map((l) => l.slice(0, 300)) }));
}

// --- Sessions over days ----------------------------------------------------------------------------------------------

/** Each session once over the days: on its first day, with the latest title, everything it did and its numbers added up. */
export function sessionsOnce(rows: readonly ActivityRow[]): ActivityRow[] {
  const byKey = new Map<string, ActivityRow>();
  for (const row of [...rows].sort((a, b) => a.firstAt - b.firstAt)) {
    const known = byKey.get(rowKey(row));
    if (!known) {
      byKey.set(rowKey(row), row);
      continue;
    }
    byKey.set(rowKey(row), {
      ...known,
      title: row.title,
      lastAt: Math.max(known.lastAt, row.lastAt),
      activeMs: known.activeMs + row.activeMs,
      turns: known.turns + row.turns,
      costUsd: known.costUsd === null && row.costUsd === null ? null : (known.costUsd ?? 0) + (row.costUsd ?? 0),
      hours: known.hours.map((ms, hour) => ms + (row.hours[hour] ?? 0)),
      commits: known.commits + row.commits,
      files: known.files + row.files,
      prs: [...known.prs, ...row.prs.filter((pr) => !known.prs.some((k) => k.url === pr.url))],
      did: [...known.did, ...row.did],
      asks: [...known.asks, ...row.asks],
      available: known.available || row.available,
    });
  }
  return [...byKey.values()];
}

// --- Copy for standup ------------------------------------------------------------------------------------------------

export type StandupFormat = 'markdown' | 'plain';

/** One line per session, grouped by project: the title, and its pull requests. */
export function standupText(rows: readonly ActivityRow[], format: StandupFormat): string {
  return projectGroups(rows)
    .map((group) => {
      const heading = format === 'markdown' ? `**${group.name}**` : group.name;
      const lines = sessionsOnce(group.rows).map((row) => `- ${oneLine(row.title)}${prNote(row)}`);
      return [heading, ...lines].join('\n');
    })
    .join('\n');
}

const prNote = (row: ActivityRow) => (row.prs.length ? ` (PR ${row.prs.map((pr) => `#${pr.number}`).join(', ')})` : '');
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

// --- Export ----------------------------------------------------------------------------------------------------------

const clock = (at: number) => {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** A cell of CSV. One that starts like a formula gets a `'`: a spreadsheet would run a session title as one. */
function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const CSV_COLUMNS = ['Date', 'Project', 'Session', 'Computer', 'Start', 'End', 'Minutes', 'Turns', 'Commits', 'Files', 'Pull requests', 'Cost (USD)'];

/** For a timesheet: a line per session per day. */
export function activityCsv(rows: readonly ActivityRow[]): string {
  const lines = [...rows]
    .sort((a, b) => a.firstAt - b.firstAt)
    .map((row) =>
      [
        row.day,
        row.projectName,
        oneLine(row.title),
        row.computer?.name ?? '',
        clock(row.firstAt),
        clock(row.lastAt),
        Math.round(row.activeMs / 60_000),
        row.turns,
        row.commits,
        row.files,
        row.prs.map((pr) => `#${pr.number}`).join(' '),
        row.costUsd === null ? '' : row.costUsd.toFixed(2),
      ]
        .map(csvCell)
        .join(','),
    );
  return `${[CSV_COLUMNS.join(','), ...lines].join('\n')}\n`;
}

/** Day by day, then by project: each session with its time and what it did. */
export function activityMarkdown(rows: readonly ActivityRow[], locale?: string): string {
  const days = [...new Set(rows.map((row) => row.day))].sort();
  const parts = days.map((day) => {
    const ofDay = rows.filter((row) => row.day === day);
    const stats = statsOf(ofDay);
    const groups = projectGroups(ofDay).map((group) => {
      const sessions = group.rows.map((row) => {
        const details = (row.did.length ? row.did : row.asks).map((line) => `  - ${oneLine(line)}`);
        return [`- ${oneLine(row.title)} (${clock(row.firstAt)}, ${formatWorked(row.activeMs)})${prNote(row)}`, ...details].join('\n');
      });
      return [`### ${group.name}`, '', ...sessions].join('\n');
    });
    return [`## ${dayTitle(day, locale)}`, '', `${plural(stats.sessions, 'session')}, ${formatWorked(stats.activeMs)}, ${plural(stats.commits, 'commit')}`, '', groups.join('\n\n')].join('\n');
  });
  return `${parts.join('\n\n')}\n`;
}

/** The name an export suggests: "activity-2026-11-02.md", or the first and last day for a week. */
export const exportFileName = (from: string, to: string, extension: 'md' | 'csv') => `activity-${from === to ? from : `${from}-to-${to}`}.${extension}`;
