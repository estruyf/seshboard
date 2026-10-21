import { FolderPlus } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { overlayOpen, otherModalOpen } from '../../lib/modalGuards.ts';
import { matches } from '../../lib/shortcuts.ts';
import { useHomeFolder } from '../../state/homeStore.ts';
import { guardMemoryEdits } from '../../state/memoryStore.ts';
import { openProject, PROJECT_TABS, switchProject, useProjectPage } from '../../state/projectPageStore.ts';
import { canReorder, filterProjects, initialProject, isNarrowProjects, keyboardMove, moveAnnouncement, neighbourProject } from '../../state/projectsNav.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { SidebarToggle } from '../sidebar/SidebarToggle.tsx';
import { Button } from '../ui/Button.tsx';
import { useWidth } from '../ui/useWidth.ts';
import { ProjectList } from './ProjectList.tsx';
import { ProjectPage } from './ProjectPage.tsx';
import { useProjectOrder } from './useProjectOrder.ts';

/** The list's width beside the project. */
const LIST_WIDTH = 270;

const inTerminal = (target: EventTarget | null) => target instanceof HTMLElement && target.closest('[data-terminal-panel]') !== null;
/** A multi-line field or rich text: ⌥↑ ⌥↓ move the caret there. One-line fields (the search, a name) don't use them. */
const inTextArea = (target: EventTarget | null) => target instanceof HTMLElement && target.closest('textarea, [contenteditable="true"]') !== null;

/**
 * Projects: the list of projects on the left (like the Settings nav) and the open project on the right, so switching
 * projects, a project's Overview and its Settings are each one click or one key away. Both the `projects` view (the
 * project last open, or the first) and the `project` view (a given one) show it. In a narrow view the list folds
 * away: the project header's ‹ shows it over the project, and the name's switcher changes project.
 */
export function ProjectsView() {
  const ref = useRef<HTMLDivElement>(null);
  const narrow = isNarrowProjects(useWidth(ref));
  const [listOpen, setListOpen] = useState(false);
  const { list, current, save } = useProjectOrder();
  const [query, setQuery] = useState('');
  const home = useHomeFolder();
  const shown = useMemo(() => filterProjects(list, query, home), [list, query, home]);
  const view = useSessions((s) => s.view);
  const root = useProjectPage((s) => s.root);
  const loaded = useProjects((s) => s.loaded);
  const showAdd = useProjects((s) => s.showAdd);
  const searchRef = useRef<HTMLInputElement>(null);
  const [announcement, setAnnouncement] = useState('');

  // The `projects` view settles on a project at once (before it paints), so everything that asks which project is
  // on screen (⌘N, the window's terminal, the palette) finds it in the `project` view.
  useLayoutEffect(() => {
    if (view !== 'projects') return;
    const initial = initialProject(list, root);
    if (initial) openProject(initial);
  }, [view, list, root]);

  // The open project was removed: the one that took its place opens (or the empty state, after the last one).
  const before = useRef(list);
  useEffect(() => {
    const previous = before.current;
    before.current = list;
    if (useSessions.getState().view !== 'project' || !root || list.some((p) => p.root === root)) return;
    const index = previous.findIndex((p) => p.root === root);
    if (index === -1) return;
    const next = list[Math.min(index, list.length - 1)];
    if (next) switchProject(next.root);
    else useSessions.getState().setView('projects');
  }, [list, root]);

  useEffect(() => {
    if (!narrow) setListOpen(false);
  }, [narrow]);

  // The list over a narrow view takes focus on the open project's row (Esc or a pick hands it back to the page).
  useEffect(() => {
    if (!listOpen) return;
    const frame = requestAnimationFrame(() => {
      const overlay = document.querySelector<HTMLElement>('[data-project-list-overlay]');
      (overlay?.querySelector<HTMLElement>('[role=option][aria-selected=true]') ?? overlay?.querySelector<HTMLElement>('[data-project-search]'))?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [listOpen]);

  const keyMove = (target: string, delta: -1 | 1) => {
    const moved = keyboardMove(current(), target, delta);
    if (!moved) return;
    void save(moved.order);
    setAnnouncement(moveAnnouncement(list.find((p) => p.root === target)?.name ?? target, moved.to, moved.order.length));
  };

  const findProject = () => {
    if (narrow) setListOpen(true);
    requestAnimationFrame(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
  };

  // The view's keys: ⌘F finds a project, ⌥↑ ⌥↓ switch (same tab), ⌥⇧↑ ⌥⇧↓ move the open project, ⌘1 to ⌘8 pick a tab.
  // Not from the sidebar, the terminal, Settings over the view, or while a dialog or menu is open.
  const keys = useRef({ shown, root, query, narrow, keyMove, findProject });
  keys.current = { shown, root, query, narrow, keyMove, findProject };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const { view: now } = useSessions.getState();
      if (now !== 'project' && now !== 'projects') return;
      const target = event.target;
      if (inTerminal(target) || (target instanceof HTMLElement && target.closest('[data-sidebar]'))) return;
      if (otherModalOpen() || overlayOpen()) return;
      const { shown, root, query, keyMove, findProject } = keys.current;
      if (matches(event, 'projects.find')) {
        event.preventDefault();
        findProject();
      } else if (matches(event, 'projects.move')) {
        if (!root || !canReorder(query) || inTextArea(target)) return;
        event.preventDefault();
        keyMove(root, event.key === 'ArrowUp' ? -1 : 1);
      } else if (matches(event, 'projects.switch')) {
        if (inTextArea(target)) return;
        const next = neighbourProject(shown, root, event.key === 'ArrowUp' ? -1 : 1);
        event.preventDefault();
        if (next) guardMemoryEdits(() => switchProject(next.root));
      } else if (matches(event, 'projects.tab') && root) {
        const tab = PROJECT_TABS[Number(event.key) - 1];
        if (!tab) return;
        event.preventDefault();
        guardMemoryEdits(() => useProjectPage.getState().setTab(tab));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const listPane = (
    <ProjectList
      list={list}
      shown={shown}
      query={query}
      onQuery={setQuery}
      searchRef={searchRef}
      onPicked={narrow ? () => setListOpen(false) : undefined}
      onSave={(order) => void save(order)}
      onKeyMove={keyMove}
      announcement={announcement}
    />
  );
  const empty = loaded && list.length === 0;

  return (
    <div ref={ref} className="relative flex h-full min-h-0" data-projects-view data-narrow={narrow || undefined}>
      {!narrow && (
        <div className="shrink-0 border-r border-border" style={{ width: LIST_WIDTH }}>
          {listPane}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {empty ? (
          <div className="flex h-full min-h-0 flex-col" data-project-page>
            <header className="drag flex h-13 shrink-0 items-center gap-3 border-b border-border px-6">{narrow && <SidebarToggle />}</header>
            <div className="mx-auto grid max-w-md justify-items-center gap-2 px-6 py-16 text-center" data-no-projects>
              <p className="text-title font-semibold">No projects yet</p>
              <p className="text-ui text-muted">Add the folders you want to start Claude Code sessions in. Folders you have used Claude Code in are suggested.</p>
              <Button variant="primary" icon={<FolderPlus size={13} aria-hidden />} onClick={() => showAdd(true)} className="mt-2" data-empty-add-project>
                Add a project folder
              </Button>
            </div>
          </div>
        ) : (
          <ProjectPage list={shown} narrow={narrow} onShowList={() => setListOpen(true)} />
        )}
      </div>
      {/* A narrow view shows the list over the project, from the header's ‹; a click outside or Esc closes it. */}
      {narrow && listOpen && (
        <>
          <div className="absolute inset-0 z-30" aria-hidden onClick={() => setListOpen(false)} />
          <div
            role="dialog"
            aria-label="Projects"
            className="overlay absolute inset-y-0 left-0 z-40 rounded-none border-y-0 border-l-0"
            style={{ width: LIST_WIDTH }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !e.defaultPrevented) {
                e.preventDefault();
                setListOpen(false);
              }
            }}
            data-project-list-overlay
          >
            {listPane}
          </div>
        </>
      )}
    </div>
  );
}
