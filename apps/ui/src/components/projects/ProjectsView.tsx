import { FolderPlus } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { overlayOpen, otherModalOpen } from '../../lib/modalGuards.ts';
import { matches } from '../../lib/shortcuts.ts';
import { useHomeFolder } from '../../state/homeStore.ts';
import { guardMemoryEdits } from '../../state/memoryStore.ts';
import { openProject, PROJECT_TABS, switchProject, useProjectPage } from '../../state/projectPageStore.ts';
import { canReorder, filterProjects, initialProject, isNarrowProjects, keyboardMove, moveAnnouncement, neighbourProject } from '../../state/projectsNav.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useSidebarList } from '../../state/browserViewStore.ts';
import { usePanelView } from '../../state/panelSlotStore.ts';
import { useShownSidebar, useSidebar } from '../../state/sidebarStore.ts';
import { Button } from '../ui/Button.tsx';
import { PANE_HEADER } from '../ui/paneHeader.ts';
import { useWidth } from '../ui/useWidth.ts';
import { ProjectList } from './ProjectList.tsx';
import { ProjectPage } from './ProjectPage.tsx';
import { useProjectOrder } from './useProjectOrder.ts';

const inTerminal = (target: EventTarget | null) => target instanceof HTMLElement && target.closest('[data-terminal-panel]') !== null;
/** A multi-line field or rich text: ⌥↑ ⌥↓ move the caret there. One-line fields (the search, a name) don't use them. */
const inTextArea = (target: EventTarget | null) => target instanceof HTMLElement && target.closest('textarea, [contenteditable="true"]') !== null;

/**
 * Projects: the list of projects in the panel beside the nav rail (a portal into `usePanelSlot`, like the Browser's
 * tabs) and the open project in the main area, so switching projects, a project's Overview and its Settings are each one
 * click or one key away. Both the `projects` view (the project last open, or the first) and the `project` view (a given
 * one) show it. With the panel closed or on another list, the project header's ‹ shows the list there again.
 */
/** Opens the panel on the projects list. */
function showProjectsList(): void {
  useSidebarList.getState().setList('projects');
  useSidebar.getState().setState('open');
}

export function ProjectsView() {
  const ref = useRef<HTMLDivElement>(null);
  const narrow = isNarrowProjects(useWidth(ref));
  const { list, current, save } = useProjectOrder();
  const [query, setQuery] = useState('');
  const home = useHomeFolder();
  const shown = useMemo(() => filterProjects(list, query, home), [list, query, home]);
  const view = useSessions((s) => s.view);
  const root = useProjectPage((s) => s.root);
  const loaded = useProjects((s) => s.loaded);
  const showAdd = useProjects((s) => s.showAdd);
  const searchRef = useRef<HTMLInputElement>(null);
  const slot = usePanelView('projects');
  const panelShowsList = useShownSidebar().state === 'open' && slot !== null;
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

  const keyMove = (target: string, delta: -1 | 1) => {
    const moved = keyboardMove(current(), target, delta);
    if (!moved) return;
    void save(moved.order);
    setAnnouncement(moveAnnouncement(list.find((p) => p.root === target)?.name ?? target, moved.to, moved.order.length));
  };

  const findProject = () => {
    showProjectsList();
    // The panel may only now open on the list: its field is there two frames on.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        searchRef.current?.focus();
        searchRef.current?.select();
      }),
    );
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
      // The projects list is in the panel too: its keys count, the sessions' don't.
      if (inTerminal(target) || (target instanceof HTMLElement && target.closest('[data-sidebar]') && !target.closest('[data-project-list]'))) return;
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
      onSave={(order) => void save(order)}
      onKeyMove={keyMove}
      announcement={announcement}
    />
  );
  const empty = loaded && list.length === 0;

  return (
    <div ref={ref} className="relative flex h-full min-h-0" data-projects-view data-narrow={narrow || undefined}>
      {slot && createPortal(listPane, slot)}
      <div className="flex min-w-0 flex-1 flex-col">
        {empty ? (
          <div className="flex h-full min-h-0 flex-col" data-project-page>
            <header className={PANE_HEADER} />
            <div className="mx-auto grid max-w-md justify-items-center gap-2 px-6 py-16 text-center" data-no-projects>
              <p className="text-title font-semibold">No projects yet</p>
              <p className="text-ui text-muted">Add the folders you want to start Claude Code sessions in. Folders you have used Claude Code in are suggested.</p>
              <Button variant="primary" icon={<FolderPlus size={13} aria-hidden />} onClick={() => showAdd(true)} className="mt-2" data-empty-add-project>
                Add a project folder
              </Button>
            </div>
          </div>
        ) : (
          <ProjectPage list={shown} narrow={narrow} onShowList={panelShowsList ? undefined : showProjectsList} />
        )}
      </div>
    </div>
  );
}
