import type { SidebarGroup } from '@seshboard/protocol/bridge';

/**
 * What the sidebar's View button says: the grouping's name. With one project picked the list is not grouped by
 * project, so a Project grouping reads "State" in faint text, and the tooltip says why.
 */
export function viewButtonLabel(group: SidebarGroup, filtered: boolean): { label: 'State' | 'Project'; faint: boolean; tooltip: string } {
  if (group === 'project' && filtered) return { label: 'State', faint: true, tooltip: 'Grouping by project shows with All projects.' };
  return { label: group === 'project' ? 'Project' : 'State', faint: false, tooltip: 'Group, sort and show sessions' };
}

/** Whether the list shows grouped by project: chosen, and no one project picked. */
export const groupedByProject = (group: SidebarGroup, filter: string | null): boolean => group === 'project' && filter === null;
