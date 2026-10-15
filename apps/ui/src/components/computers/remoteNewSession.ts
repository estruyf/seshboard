import type { RemoteProject, RemoteSessions } from '@switchboard/protocol/client';

/** A project tile in New session on another computer: the project, and how its sessions there are. */
export interface RemoteTile {
  id: string;
  project: RemoteProject;
  tone: 'needs-you' | 'working' | 'idle';
  /** "needs you", "1 working", "idle". */
  label: string;
}

/**
 * Another computer's projects as New session's tiles (pure, so it can be tested): the ones with something going on
 * first (needs you, then working), then the most recently active, then by name. The state comes from that computer's
 * session list, with the same rules as its sidebar: an open prompt is needs you.
 */
export function remoteProjectTiles(projects: readonly RemoteProject[], list: RemoteSessions | null): RemoteTile[] {
  const asking = new Set(list?.prompts.map((p) => p.sessionId));
  const stats = new Map<string, { needs: number; working: number; last: number }>();
  for (const session of list?.sessions ?? []) {
    const entry = stats.get(session.projectId) ?? { needs: 0, working: 0, last: 0 };
    if (asking.has(session.id) || session.status === 'needs-you') entry.needs++;
    else if (session.status === 'working' || session.status === 'background') entry.working++;
    entry.last = Math.max(entry.last, session.updatedAt);
    stats.set(session.projectId, entry);
  }
  const rank = (id: string) => {
    const s = stats.get(id);
    return s?.needs ? 0 : s?.working ? 1 : 2;
  };
  return [...projects]
    .sort((a, b) => rank(a.id) - rank(b.id) || (stats.get(b.id)?.last ?? 0) - (stats.get(a.id)?.last ?? 0) || a.name.localeCompare(b.name))
    .map((project) => {
      const s = stats.get(project.id);
      if (s?.needs) return { id: project.id, project, tone: 'needs-you' as const, label: 'needs you' };
      if (s?.working) return { id: project.id, project, tone: 'working' as const, label: `${s.working} working` };
      return { id: project.id, project, tone: 'idle' as const, label: 'idle' };
    });
}
