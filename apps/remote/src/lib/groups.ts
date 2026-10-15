import type { RemoteSession } from '@switchboard/protocol/remote-client';

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

/** How long ago, in a few characters (`5m`, `2h`, `3d`). */
export function age(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
