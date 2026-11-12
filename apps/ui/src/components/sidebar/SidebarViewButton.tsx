import { ChevronsUpDown, ListFilter } from 'lucide-react';
import { useRef, useState } from 'react';
import { formatKeys, keysFor } from '../../lib/shortcuts.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSidebarFolds } from '../../state/sidebarFoldsStore.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { viewButtonLabel } from './sidebarView.ts';

/**
 * The View button beside the project filter: Group by (State or Project), Sort (Recent or Quickest to unblock), Show
 * (Done and Compact rows), and Collapse all projects while grouped by project. It says the grouping's name.
 */
export function SidebarViewButton({ projects }: { projects: readonly string[] }) {
  const prefs = usePreferences((s) => s.prefs);
  const update = usePreferences((s) => s.update);
  const filtered = useProjects((s) => s.filter !== null);
  const folded = useSidebarFolds((s) => s.folded);
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { label, faint, tooltip } = viewButtonLabel(prefs.sidebarGroup, filtered);
  const allFolded = projects.length > 0 && projects.every((key) => folded.has(key));
  const option = (value: string) => ({ 'data-sidebar-view-option': value });

  const entries: MenuEntry[] = [
    { heading: 'Group by' },
    { label: 'State', hint: 'Needs you, Working…', checked: prefs.sidebarGroup === 'state', data: option('group-state'), onSelect: () => update({ sidebarGroup: 'state' }) },
    { label: 'Project', checked: prefs.sidebarGroup === 'project', data: option('group-project'), onSelect: () => update({ sidebarGroup: 'project' }) },
    'separator',
    { heading: 'Sort' },
    { label: 'Recent', checked: prefs.sidebarSort === 'recent', data: option('sort-recent'), onSelect: () => update({ sidebarSort: 'recent' }) },
    { label: 'Quickest to unblock', checked: prefs.sidebarSort === 'quickest', data: option('sort-quickest'), onSelect: () => update({ sidebarSort: 'quickest' }) },
    'separator',
    { heading: 'Show' },
    { label: 'Done', checkbox: true, checked: prefs.sidebarShowDone, data: option('show-done'), onSelect: () => update({ sidebarShowDone: !prefs.sidebarShowDone }) },
    // Compact rows is the Compact sidebar style (Settings › Sidebar): one line per session.
    { label: 'Compact rows', checkbox: true, checked: prefs.sidebarStyle === 'compact', data: option('compact'), onSelect: () => update({ sidebarStyle: prefs.sidebarStyle === 'compact' ? 'standard' : 'compact' }) },
    ...(prefs.sidebarGroup === 'project' && !filtered && projects.length > 0
      ? (['separator', { label: allFolded ? 'Expand all projects' : 'Collapse all projects', hint: formatKeys(keysFor('sidebar.fold-projects')), data: option('fold-all'), onSelect: () => useSidebarFolds.getState().foldAll(projects, !allFolded) }] as MenuEntry[])
      : []),
  ];

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open !== null}
        aria-label={`View: grouped by ${label.toLowerCase()}`}
        data-tooltip={tooltip}
        data-sidebar-view={prefs.sidebarGroup}
        data-sidebar-view-faint={faint || undefined}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setOpen((current) => (current ? null : { x: Math.max(8, rect.right - 240), y: rect.bottom + 4 }));
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            e.currentTarget.click();
          }
        }}
        className={`no-drag flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-ui hover:bg-border/50 hover:text-text ${open ? 'bg-text/12 text-text' : 'bg-text/6'} ${faint ? 'text-faint' : open ? '' : 'text-muted'}`}
      >
        <ListFilter size={14} className="shrink-0" aria-hidden />
        {label}
        <ChevronsUpDown size={12} className="shrink-0" aria-hidden />
      </button>
      {open && <Menu x={open.x} y={open.y} width={240} label="View" anchor={buttonRef} entries={entries} onClose={() => setOpen(null)} />}
    </>
  );
}
