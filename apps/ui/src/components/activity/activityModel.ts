import type { ActivityEntry, ActivitySummaryExtra } from '@seshboard/protocol/client';

/** Days in the strip: today and the same weekday a week ago, so a day can be compared with last week's. */
export const STRIP_DAYS = 8;
/** What an arrow moves the strip by. */
export const STRIP_STEP = 7;

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

/** The days of the strip that ends on `last`, oldest first. */
export const stripDays = (last: string): string[] => Array.from({ length: STRIP_DAYS }, (_, i) => addDays(last, i - STRIP_DAYS + 1));

export const weekdayShort = (day: string, locale?: string) => noon(day).toLocaleDateString(locale, { weekday: 'short' });
export const weekdayLong = (day: string, locale?: string) => noon(day).toLocaleDateString(locale, { weekday: 'long' });
export const dayNumber = (day: string) => noon(day).getDate();
export const dayTitle = (day: string, locale?: string) => noon(day).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
export const dayShort = (day: string, locale?: string) => noon(day).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

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

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

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

/** Sessions per day, for the strip. */
export function countsByDay(rows: readonly ActivityRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.day, (counts.get(row.day) ?? 0) + 1);
  return counts;
}

/** The bar's height in the strip: the busiest day fills it, and an empty day still shows a stub. */
export const barHeight = (count: number, max: number, full = 44) => (count <= 0 || max <= 0 ? 3 : Math.max(4, Math.round((count / max) * full)));

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

/** Rows grouped by project, the most time first; inside one, sessions by when they started. */
export function projectGroups(rows: readonly ActivityRow[]): ProjectGroup[] {
  const rootsByName = new Map(rows.flatMap((row) => (row.projectRoot ? [[row.projectName, row.projectRoot] as const] : [])));
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

/** The rows of a project picked in the week's bars; every row with none picked. */
export function inProject(rows: readonly ActivityRow[], key: string | null): ActivityRow[] {
  if (!key) return [...rows];
  const rootsByName = new Map(rows.flatMap((row) => (row.projectRoot ? [[row.projectName, row.projectRoot] as const] : [])));
  return rows.filter((row) => projectKeyOf(row, rootsByName) === key);
}

/** A project's bar in the week: its share of the week's time. A week with no time known shares by sessions. */
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

/** The last day with sessions before `today` (a Monday's yesterday is Friday's work), up to the strip's length back. Null without one. */
export function lastActiveDay(today: string, counts: ReadonlyMap<string, number>): string | null {
  for (let back = 1; back < STRIP_DAYS; back++) {
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

// --- Copy for standup ------------------------------------------------------------------------------------------------

export type StandupFormat = 'markdown' | 'plain';

/** Each session once over the days (the latest title), with all its pull requests. */
function sessionsOnce(rows: readonly ActivityRow[]): ActivityRow[] {
  const byKey = new Map<string, ActivityRow>();
  for (const row of [...rows].sort((a, b) => a.firstAt - b.firstAt)) {
    const known = byKey.get(rowKey(row));
    if (!known) byKey.set(rowKey(row), row);
    else byKey.set(rowKey(row), { ...known, title: row.title, prs: [...known.prs, ...row.prs.filter((pr) => !known.prs.some((k) => k.url === pr.url))] });
  }
  return [...byKey.values()];
}

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
