import { isSameOrInside, type CompanionSession, type CompanionStatus, type LiveSession, type PermissionRequest, type SessionHostInfo, type SessionSummary } from '@switchboard/protocol';

/** What the engine knows about sessions: transcripts, running processes, and the ones this app runs. */
export interface SessionSources {
  summaries: readonly SessionSummary[];
  live: readonly LiveSession[];
  hosts: readonly SessionHostInfo[];
  /** Permission prompts, questions and plans the sessions this app runs are waiting on. */
  permissions?: readonly PermissionRequest[];
}

const activeHost = (host: SessionHostInfo | undefined): host is SessionHostInfo => !!host && host.state !== 'closed' && host.state !== 'error';

/** A running host's state in the registry's terms, as the sidebar merges them (`hostAsLive` in the UI). */
function hostLive(host: SessionHostInfo): Pick<LiveSession, 'status' | 'background'> {
  const status = host.state === 'needs-you' ? 'needs-you' : host.state === 'idle' ? 'idle' : 'running';
  return { status, background: host.backgroundTasks.map((t) => t.description) };
}

/** How a session is doing, in the sidebar's order of urgency (`rowStatus` in the UI). */
export function companionStatus(summary: SessionSummary | null, live: LiveSession | null, host: SessionHostInfo | undefined): CompanionStatus {
  // Sessions running in this app report their own state; it is more precise than the registry.
  const state = activeHost(host) ? hostLive(host) : live;
  if (state?.status === 'needs-you') return 'needs-you';
  if (state?.status === 'running') return 'working';
  if (host?.state === 'error') return 'error';
  if (summary?.unread) return 'unread';
  if (state?.status === 'idle') return state.background?.length ? 'background' : 'idle';
  return 'stopped';
}

const realBranch = (branch: string | null) => (branch && branch !== 'HEAD' ? branch : null);

/** Sessions with activity in this window stay in the sidebar's main list (`RECENT_MS` in the UI). */
export const RECENT_MS = 48 * 60 * 60 * 1000;

interface Listing {
  status: CompanionStatus;
  pinned: boolean;
  archivedAt: number | null;
  unread: boolean;
  updatedAt: number;
  /** Running in this app, or a process this app started. */
  openInApp: boolean;
}

/**
 * Whether Switchboard's sidebar shows the session in its main list rather than under Archived (`isActive` in the
 * UI): what needs you, failed or is pinned; nothing archived by hand until there's news; then what works, is open
 * in the app, is unread, or had activity in the last 48 hours.
 */
export function listedInSidebar(s: Listing, now: number): boolean {
  if (s.status === 'needs-you' || s.status === 'error' || s.pinned) return true;
  // A session archived while it works stays archived until it has finished.
  if (s.archivedAt !== null && (s.archivedAt >= s.updatedAt || s.status === 'working')) return false;
  if (s.status === 'working') return true;
  return s.openInApp || s.unread || now - s.updatedAt < RECENT_MS;
}

export interface ListingOptions {
  now?: number;
  /** The session open in Switchboard: listed even when archived or out of scope, as the sidebar keeps it. */
  keep?: string | null;
  /** The sidebar's choice: only sessions from Switchboard (the default), or every session. */
  scope?: 'switchboard' | 'all';
}

/**
 * The sessions Switchboard's sidebar lists outside Archived, under its scope: indexed ones, and running ones that
 * haven't written a transcript yet.
 */
export function companionSessions(sources: SessionSources, { now = Date.now(), keep = null, scope = 'all' }: ListingOptions = {}): CompanionSession[] {
  const live = new Map(sources.live.map((l) => [l.sessionId, l]));
  const hosts = new Map(sources.hosts.map((h) => [h.sessionId, h]));
  const out: CompanionSession[] = [];
  const seen = new Set<string>();
  for (const summary of sources.summaries) {
    seen.add(summary.id);
    const l = live.get(summary.id) ?? null;
    const host = hosts.get(summary.id);
    const status = companionStatus(summary, l, host);
    const updatedAt = Math.max(summary.updatedAt, l && l.status !== 'idle' ? (l.updatedAt ?? 0) : 0);
    const openInApp = activeHost(host) || l?.origin === 'app';
    const inApp = summary.inApp || l?.origin === 'app';
    if (summary.id !== keep) {
      if (scope === 'switchboard' && !inApp) continue;
      if (!listedInSidebar({ status, pinned: summary.pinned, archivedAt: summary.archivedAt, unread: summary.unread, updatedAt, openInApp }, now)) continue;
    }
    out.push({
      id: summary.id,
      title: summary.customTitle ?? (l?.name || summary.title),
      cwd: (activeHost(host) ? host.cwd : null) ?? summary.cwd,
      projectRoot: summary.projectRoot,
      branch: summary.worktree?.branch ?? realBranch(summary.gitBranch),
      status,
      updatedAt,
      inApp,
    });
  }
  const pending = [...sources.hosts.filter(activeHost).map((h) => ({ id: h.sessionId, cwd: h.cwd, origin: 'app' as const, name: null, at: h.startedAt })), ...sources.live.map((l) => ({ id: l.sessionId, cwd: l.cwd, origin: l.origin, name: l.name, at: l.updatedAt ?? l.startedAt ?? 0 }))];
  for (const p of pending) {
    // SDK processes without a conversation are helpers (command lists, usage), not sessions.
    if (seen.has(p.id) || p.origin === 'sdk') continue;
    seen.add(p.id);
    const host = hosts.get(p.id);
    const l = live.get(p.id) ?? null;
    const status = companionStatus(null, l, host);
    if (p.id !== keep) {
      if (scope === 'switchboard' && p.origin !== 'app') continue;
      if (!listedInSidebar({ status, pinned: false, archivedAt: null, unread: false, updatedAt: p.at, openInApp: p.origin === 'app' }, now)) continue;
    }
    out.push({
      id: p.id,
      title: p.name ?? 'New session',
      cwd: p.cwd,
      projectRoot: l?.projectRoot ?? p.cwd?.replace(/\/\.claude\/worktrees\/[^/]+.*$/, '') ?? 'Unknown folder',
      branch: null,
      status,
      updatedAt: p.at,
      inApp: p.origin === 'app',
    });
  }
  return out;
}

/**
 * `path` is `folder` or inside it. On Windows without regard to case or slash: VS Code reports `c:\…` where
 * Claude Code writes `C:\…`.
 */
export const isWithin = (path: string, folder: string) => isSameOrInside(path, folder);

/**
 * Whether a session belongs to one of the workspace folders: it works in one of them (or below it), or one of them
 * is inside the folder it works in. No folders means every session.
 */
export function inFolders(session: Pick<CompanionSession, 'cwd' | 'projectRoot'>, folders: readonly string[]): boolean {
  if (folders.length === 0) return true;
  const where = session.cwd ?? session.projectRoot;
  return folders.some((folder) => isWithin(where, folder) || isWithin(folder, where));
}

const URGENCY: Record<CompanionStatus, number> = { 'needs-you': 0, working: 1, error: 2, unread: 3, background: 4, idle: 5, stopped: 6 };

/** The sessions for some folders: what needs you first, then what is working, then the most recent. */
export function sessionsFor(all: readonly CompanionSession[], folders: readonly string[], limit = 50): CompanionSession[] {
  return all
    .filter((s) => inFolders(s, folders))
    .sort((a, b) => URGENCY[a.status] - URGENCY[b.status] || b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

/** The prompts of these sessions, oldest first. */
export function promptsFor(permissions: readonly PermissionRequest[], sessions: readonly Pick<CompanionSession, 'id'>[]): PermissionRequest[] {
  const ids = new Set(sessions.map((s) => s.id));
  return permissions.filter((p) => ids.has(p.sessionId)).sort((a, b) => a.createdAt - b.createdAt);
}
