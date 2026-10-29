import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import type { ProjectInfo } from '@seshboard/protocol/client';
import { modKey } from '../../lib/shortcuts.ts';
import { useHomeFolder } from '../../state/homeStore.ts';
import { guardMemoryEdits } from '../../state/memoryStore.ts';
import { openProject, switchProject } from '../../state/projectPageStore.ts';
import { filterProjects } from '../../state/projectsNav.ts';
import { useMultipleProfiles, useProfile } from '../../state/profilesStore.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { Popover } from '../ui/Popover.tsx';

function ProfileName({ profileId }: { profileId: string | null }) {
  const multiple = useMultipleProfiles();
  const profile = useProfile(profileId);
  if (!multiple || !profile) return null;
  return <span className="shrink-0 text-meta text-muted">{profile.name}</span>;
}

/**
 * The project name's ▾: a search field over your projects, each with its profile. ↩ opens one on the tab on screen,
 * ⌘↩ on its Settings. How you change project when the list is folded away. A combobox with its listbox.
 */
export function ProjectSwitcher({ list, current, x, y, anchor, onClose }: { list: readonly ProjectInfo[]; current: string; x: number; y: number; anchor: RefObject<HTMLElement | null>; onClose(): void }) {
  const [query, setQuery] = useState('');
  const home = useHomeFolder();
  const shown = useMemo(() => filterProjects(list, query, home), [list, query, home]);
  const [active, setActive] = useState(() => Math.max(0, list.findIndex((p) => p.root === current)));
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const index = Math.min(active, Math.max(0, shown.length - 1));
  const highlighted = shown[index];

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const pick = (project: ProjectInfo, settings: boolean) => {
    onClose();
    guardMemoryEdits(() => (settings ? openProject(project.root, 'settings') : switchProject(project.root)));
  };

  return (
    <Popover x={x} y={y} width={300} anchor={anchor} onClose={onClose} role="dialog" aria-label="Switch project" data-project-switcher>
      <div className="px-2 pt-1 pb-1.5">
        <label className="flex h-8 items-center gap-2 rounded-md border border-edge bg-bg px-2.5 text-ui focus-within:border-accent-ink/60">
          <Search size={13} className="shrink-0 text-faint" aria-hidden />
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={highlighted ? `${listId}-${index}` : undefined}
            aria-label="Find a project"
            placeholder="Find a project"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (shown.length) setActive((index + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length);
              } else if (e.key === 'Enter' && highlighted) {
                e.preventDefault();
                pick(highlighted, modKey(e));
              }
            }}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint"
            data-project-switcher-search
          />
        </label>
      </div>
      <div ref={listRef} role="listbox" id={listId} aria-label="Projects" className="max-h-72 overflow-y-auto px-1">
        {shown.length === 0 && <p className="px-3 py-1.5 text-ui text-muted">No project matches.</p>}
        {shown.map((project, i) => (
          <div
            key={project.root}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === index}
            aria-current={project.root === current || undefined}
            onMouseMove={() => i !== index && setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => pick(project, modKey(e))}
            className={`flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-ui ${i === index ? 'bg-accent/15' : ''}`}
            data-project-switcher-option={project.root}
          >
            <ProjectIcon project={project} root={project.root} size={18} />
            <span className={`min-w-0 flex-1 truncate ${project.root === current ? 'font-semibold' : ''}`}>{project.name}</span>
            <ProfileName profileId={project.profileId} />
          </div>
        ))}
      </div>
      <p className="mx-2 mt-1.5 flex items-center gap-1 border-t border-edge px-1 pt-1.5 text-meta text-faint" data-project-switcher-footer>
        <Kbd keys="enter" /> open · <Kbd shortcut="projects.switcher-settings" /> open its Settings
      </p>
    </Popover>
  );
}
