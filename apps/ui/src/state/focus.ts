import type { FocusMode, Preferences } from '@switchboard/protocol/bridge';
import type { LiveSession, PermissionRequest, SessionHostInfo, SessionSummary } from '@switchboard/protocol/client';
import type { SessionRowData } from './sessionsStore.ts';
import { HOST_TO_LIVE, isActiveHost } from './hostsStore.ts';

/**
 * The focus limit: how many sessions you have going, and whether starting another is fine, needs
 * asking, or has to wait. A session is "going" while it is an open loop on your mind: Claude is working
 * on it, it needs you, or it finished a turn you haven't read. Pure, so it can be tested; the stores
 * feed it (`useFocus`), and every start path asks `focusVerdict` through one gate.
 */

/** Why a session counts, in the order the lists show them: what gets forgotten first. */
export type FocusState = 'needs-you' | 'working' | 'unread';

export interface FocusSession {
  id: string;
  title: string;
  projectRoot: string;
  state: FocusState;
  /** Needs you: when it started waiting (its oldest open request, else its last activity). Otherwise its last activity. */
  since: number;
  /** A live session from the terminal or an IDE (only counted with `focusCountExternal`). */
  external: boolean;
  /** A session on another paired computer (only counted with `focusCountRemote`); `id` is then its sidebar row id. */
  remote: { computerName: string } | null;
}

export interface FocusInput {
  /** Sessions running in Switchboard. */
  hosts: ReadonlyMap<string, SessionHostInfo>;
  /** The live registry (`~/.claude/sessions`): Claude Code processes from every app. */
  live: ReadonlyMap<string, LiveSession>;
  /** Read and archived ("settled") state, titles and projects. */
  sessions: ReadonlyMap<string, SessionSummary>;
  /** Open permission prompts and questions, for how long a session has waited. */
  permissions?: Iterable<PermissionRequest>;
  countExternal: boolean;
  /** Sessions on other computers as sidebar rows (`remoteRows`); left out unless `countRemote`. */
  remote?: readonly Pick<SessionRowData, 'id' | 'title' | 'updatedAt' | 'remote'>[];
  countRemote?: boolean;
}

const STATE_ORDER: Record<FocusState, number> = { 'needs-you': 0, working: 1, unread: 2 };

/** Archived by hand with nothing new since: settled. Settling frees a place, like the sidebar's Archived. */
function settled(summary: SessionSummary | undefined, working: boolean): boolean {
  if (!summary || summary.archivedAt === null) return false;
  // As in the sidebar: a session archived while it works stays archived until it has finished.
  return summary.archivedAt >= summary.updatedAt || working;
}

/** The sessions that count toward the limit: needs you first (longest waiting first), then working, then unread. */
export function focusSessions(input: FocusInput): FocusSession[] {
  const waitingSince = new Map<string, number>();
  for (const request of input.permissions ?? []) {
    const seen = waitingSince.get(request.sessionId);
    if (seen === undefined || request.createdAt < seen) waitingSince.set(request.sessionId, request.createdAt);
  }
  const out: FocusSession[] = [];
  const consider = (id: string, status: LiveSession['status'] | undefined, external: boolean, fallback: { title: string | null; projectRoot: string | null; at: number }) => {
    if (!status) return;
    const summary = input.sessions.get(id);
    // An idle session only counts while its last turn is unread.
    const state: FocusState | null = status === 'needs-you' ? 'needs-you' : status === 'running' ? 'working' : summary?.unread ? 'unread' : null;
    if (!state) return;
    // A session waiting for you always counts: answering it is the way to free a place.
    if (state !== 'needs-you' && settled(summary, state === 'working')) return;
    const at = Math.max(summary?.updatedAt ?? 0, fallback.at);
    out.push({
      id,
      title: summary?.title ?? fallback.title ?? 'New session',
      projectRoot: summary?.projectRoot ?? fallback.projectRoot ?? 'Unknown folder',
      state,
      since: state === 'needs-you' ? (waitingSince.get(id) ?? at) : at,
      external,
      remote: null,
    });
  };

  const seen = new Set<string>();
  for (const host of input.hosts.values()) {
    // Closed and failed sessions never count; the same states the status dots show.
    if (!isActiveHost(host)) continue;
    seen.add(host.sessionId);
    consider(host.sessionId, HOST_TO_LIVE[host.state], false, { title: null, projectRoot: host.cwd.replace(/\/\.claude\/worktrees\/[^/]+.*$/, ''), at: host.startedAt });
  }
  if (input.countExternal) {
    for (const entry of input.live.values()) {
      // Switchboard's own processes (and its helpers) register as SDK processes: they are counted through their hosts.
      if (seen.has(entry.sessionId) || entry.origin === 'sdk' || entry.origin === 'app') continue;
      seen.add(entry.sessionId);
      consider(entry.sessionId, entry.status, true, { title: entry.name, projectRoot: entry.projectRoot ?? entry.cwd, at: entry.updatedAt ?? entry.startedAt ?? 0 });
    }
  }
  if (input.countRemote) {
    for (const row of input.remote ?? []) {
      const info = row.remote;
      // An offline computer's state is its last known one, not something going on now.
      if (!info || info.offline) continue;
      const state: FocusState | null = info.status === 'needs-you' ? 'needs-you' : info.status === 'running' ? 'working' : info.status === 'unread' ? 'unread' : null;
      if (!state) continue;
      // The project's name stands in for a folder: the lists show its last part.
      out.push({ id: row.id, title: row.title, projectRoot: info.projectName, state, since: row.updatedAt, external: false, remote: { computerName: info.computerName } });
    }
  }
  // Needs you: longest waiting first. Working and unread: most recent first.
  return out.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || (a.state === 'needs-you' ? a.since - b.since : b.since - a.since));
}

/** Where the count stands against the limit, for the counter's colour. */
export type FocusLevel = 'under' | 'at' | 'over';

export const focusLevel = (count: number, limit: number): FocusLevel => (count < limit ? 'under' : count === limit ? 'at' : 'over');

export type FocusPrefs = Pick<Preferences, 'focusLimit' | 'focusMode' | 'focusCountExternal' | 'focusCountRemote'>;

/**
 * Whether something may start. `allowed`: go ahead (the limit is off, there is room, or the work goes to a
 * session that already counts). `ask`: Nudge mode at the limit, ask first. `blocked`: Strict mode at the
 * limit, finish, settle or stop a session first.
 */
export type FocusVerdict = { kind: 'allowed' } | { kind: 'ask' | 'blocked'; count: number; limit: number; mode: FocusMode; sessions: FocusSession[] };

/**
 * The gate's answer for starting work. `target` is the session a message goes to (null for a new
 * session): answering a session that already counts is never limited, it adds nothing.
 */
export function focusVerdict(sessions: readonly FocusSession[], prefs: FocusPrefs, target: string | null = null): FocusVerdict {
  const limit = prefs.focusLimit;
  if (limit === null) return { kind: 'allowed' };
  if (target !== null && sessions.some((s) => s.id === target)) return { kind: 'allowed' };
  if (sessions.length < limit) return { kind: 'allowed' };
  return { kind: prefs.focusMode === 'strict' ? 'blocked' : 'ask', count: sessions.length, limit, mode: prefs.focusMode, sessions: [...sessions] };
}

/** "4th": the position a new session would take, for "Start a 4th session?". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long a session has waited: "now", "12m", "1h 12m", "2d 3h". */
export function waitedFor(since: number, now: number): string {
  const ms = Math.max(0, now - since);
  if (ms < MINUTE) return 'now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < DAY) {
    const minutes = Math.floor((ms % HOUR) / MINUTE);
    return minutes ? `${Math.floor(ms / HOUR)}h ${minutes}m` : `${Math.floor(ms / HOUR)}h`;
  }
  const hours = Math.floor((ms % DAY) / HOUR);
  return hours ? `${Math.floor(ms / DAY)}d ${hours}h` : `${Math.floor(ms / DAY)}d`;
}

/** When a prompt was saved for later, in words: "just now", "5m ago", "3h ago", "yesterday", "3d ago", "Sep 21". */
export function savedAgo(at: number, now: number): string {
  const ms = Math.max(0, now - at);
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m ago`;
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  if (at >= midnight.getTime()) return `${Math.floor(ms / HOUR)}h ago`;
  if (at >= midnight.getTime() - DAY) return 'yesterday';
  if (ms < 7 * DAY) return `${Math.max(2, Math.round(ms / DAY))}d ago`;
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}
