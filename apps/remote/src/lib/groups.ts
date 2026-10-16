import type { RemoteSession } from '@switchboard/protocol/remote-client';
import { inBackground } from './background.ts';

/** The sidebar's sections on the computer (apps/ui sidebarRows.ts), without Pinned: what needs attention, then by day. */
export type SessionGroup = 'needs-you' | 'working' | 'today' | 'yesterday' | 'earlier';

export const GROUP_LABEL: Record<SessionGroup, string> = {
  'needs-you': 'Needs you',
  working: 'Working',
  today: 'Today',
  yesterday: 'Yesterday',
  earlier: 'Earlier',
};

const ORDER: readonly SessionGroup[] = ['needs-you', 'working', 'today', 'yesterday', 'earlier'];

/** Local midnight of the day `now` falls on, so "Today" follows the calendar. */
export function startOfDay(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function sessionGroup(session: RemoteSession, now: number): SessionGroup {
  if (session.status === 'needs-you') return 'needs-you';
  if (session.status === 'working') return 'working';
  const today = startOfDay(now);
  if (session.updatedAt >= today) return 'today';
  // A day can be 23 or 25 hours long across a clock change, hence the second midnight.
  if (session.updatedAt >= startOfDay(today - 1)) return 'yesterday';
  return 'earlier';
}

/** The non-empty sections in order, each newest first. */
export function groupSessions(sessions: readonly RemoteSession[], now: number): Array<{ group: SessionGroup; sessions: RemoteSession[] }> {
  const byGroup = new Map<SessionGroup, RemoteSession[]>();
  for (const session of sessions) {
    const group = sessionGroup(session, now);
    byGroup.set(group, [...(byGroup.get(group) ?? []), session]);
  }
  return ORDER.filter((group) => byGroup.has(group)).map((group) => ({ group, sessions: byGroup.get(group)!.sort((a, b) => b.updatedAt - a.updatedAt) }));
}

export type TileTone = 'needs-you' | 'working' | 'idle';

/** A project tile's status line, as on the computer's New session: needs you first, then working, else how long it's been quiet. */
export function projectStatus(projectId: string, sessions: readonly RemoteSession[], now: number): { tone: TileTone; label: string } {
  const mine = sessions.filter((s) => s.projectId === projectId);
  const needsYou = mine.filter((s) => s.status === 'needs-you').length;
  if (needsYou) return { tone: 'needs-you', label: `${needsYou} needs you` };
  const working = mine.filter((s) => s.status === 'working').length;
  if (working) return { tone: 'working', label: `${working} working` };
  const last = Math.max(0, ...mine.map((s) => s.updatedAt));
  return { tone: 'idle', label: last ? `Idle · ${age(last, now)}` : 'No recent sessions' };
}

/** When each project last had a session, by project id. */
function lastActivity(sessions: readonly RemoteSession[]): Map<string, number> {
  const last = new Map<string, number>();
  for (const s of sessions) last.set(s.projectId, Math.max(last.get(s.projectId) ?? 0, s.updatedAt));
  return last;
}

/** Projects by their latest session, newest first (the computer's default order); projects without any keep their order after those. */
export function recentProjects<P extends { id: string }>(projects: readonly P[], sessions: readonly RemoteSession[]): P[] {
  const last = lastActivity(sessions);
  return projects
    .map((project, index) => ({ project, index, at: last.get(project.id) ?? 0 }))
    .sort((a, b) => b.at - a.at || a.index - b.index)
    .map((p) => p.project);
}

/**
 * The project New session starts with, so most of the time you only type: the one you last started a session in from
 * this device, else the one with the newest session, else the only one. Null when there's nothing to go on.
 */
export function suggestedProject(projects: readonly { id: string }[], sessions: readonly RemoteSession[], lastUsed: string | null): string | null {
  if (lastUsed && projects.some((p) => p.id === lastUsed)) return lastUsed;
  if (projects.length === 1) return projects[0]!.id;
  const last = lastActivity(sessions);
  const newest = recentProjects(projects, sessions)[0];
  return newest && last.has(newest.id) ? newest.id : null;
}

/** How long ago, in a few characters (`5m`, `2h`, `3d`). */
export function age(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** The home view's heading on a wide screen: what needs you, and next to it what works and what finished today. */
export function homeHeadline(sessions: readonly RemoteSession[], now: number): { title: string; counts: string } {
  const needsYou = sessions.filter((s) => s.status === 'needs-you').length;
  const working = sessions.filter((s) => s.status === 'working').length;
  const finished = sessions.filter((s) => sessionGroup(s, now) === 'today').length;
  const title = needsYou === 0 ? 'Nothing needs you' : `${needsYou} ${needsYou === 1 ? 'session needs' : 'sessions need'} you`;
  const counts = [working ? `${working} working` : null, finished ? `${finished} finished today` : null].filter(Boolean).join(' · ');
  return { title, counts };
}

/** Finished sessions you haven't read, newest first: Finished, ready to review. Not while a task still runs in the background. */
export function toReview(sessions: readonly RemoteSession[], max = 6): RemoteSession[] {
  return sessions
    .filter((s) => s.status === 'unread' && !inBackground(s))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, max);
}

/**
 * The session ⌘⇧U opens, as on the computer: those waiting for you first (the longest waiting first), then finished
 * ones you haven't read, newest first. From the one open now it goes on to the next, and round again.
 */
export function nextNeedsYou(list: { sessions: readonly RemoteSession[]; prompts: ReadonlyArray<{ sessionId: string; createdAt: number }> }, currentId: string | null): string | null {
  const waitingSince = new Map<string, number>();
  for (const p of list.prompts) waitingSince.set(p.sessionId, Math.min(waitingSince.get(p.sessionId) ?? Infinity, p.createdAt));
  const waiting = list.sessions.filter((s) => s.status === 'needs-you').sort((a, b) => (waitingSince.get(a.id) ?? a.updatedAt) - (waitingSince.get(b.id) ?? b.updatedAt));
  const order = [...waiting, ...toReview(list.sessions, Infinity)].map((s) => s.id);
  if (!order.length) return null;
  const at = currentId ? order.indexOf(currentId) : -1;
  return order[(at + 1) % order.length]!;
}
