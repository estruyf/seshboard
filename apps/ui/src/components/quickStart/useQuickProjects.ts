import { useMemo } from 'react';
import { useHomeFolder } from '../../state/homeStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useListedRows } from '../../state/useQueue.ts';
import { useMinute } from '../focus/useMinute.ts';
import { activityByProject, latestBranches } from '../newSession/projectTiles.ts';
import { quickStartProjects, type QuickProject } from './quickStartModel.ts';

/**
 * Your projects for quick start and the menu bar's new work, in New session's order with their branch and state,
 * filtered by `filter`. One list for both, so they never disagree.
 */
export function useQuickProjects(filter: string): QuickProject[] {
  const projects = useProjects((s) => s.projects);
  const sessions = useSessions((s) => s.sessions);
  const order = usePreferences((s) => s.prefs.projectOrder);
  const rows = useListedRows();
  const home = useHomeFolder();
  const now = useMinute();
  const activity = useMemo(() => activityByProject(rows), [rows]);
  const branches = useMemo(() => latestBranches(sessions.values()), [sessions]);
  return useMemo(() => quickStartProjects({ projects, activity, branches, order, filter, home, now }), [projects, activity, branches, order, filter, home, now]);
}
