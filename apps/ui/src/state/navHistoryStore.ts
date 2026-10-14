import { useEffect } from 'react';
import { create } from 'zustand';
import { guardMemoryEdits } from './memoryStore.ts';
import { emptyHistory, record, step, type NavHistory, type NavPlace } from './navHistory.ts';
import { useProjectPage } from './projectPageStore.ts';
import { useProjects } from './projectsStore.ts';
import { useSessions } from './sessionsStore.ts';
import { leafIds, removeLeaves } from './tiling.ts';
import { openUsage, useUsageView } from './usageViewStore.ts';

export const useNavHistory = create<{ history: NavHistory }>()(() => ({ history: emptyHistory }));

/** The place on screen now. */
function currentPlace(): NavPlace {
  const s = useSessions.getState();
  switch (s.view) {
    case 'session':
      return { view: 'session', layout: s.layout, active: s.selectedId };
    case 'settings':
      return { view: 'settings', section: s.settingsSection, from: s.settingsFrom };
    case 'project': {
      const { root, tab } = useProjectPage.getState();
      return root ? { view: 'project', root, tab } : { view: 'projects' };
    }
    case 'usage':
      return { view: 'usage', profileId: useUsageView.getState().profileId };
    default:
      return { view: s.view };
  }
}

const sessionExists = (id: string) => useSessions.getState().sessions.has(id) || useSessions.getState().live.has(id);

function usable(place: NavPlace): boolean {
  if (place.view === 'session') return place.layout === null || leafIds(place.layout).some(sessionExists);
  if (place.view === 'project') return useProjects.getState().projects.has(place.root);
  return true;
}

/** Set while back or forward puts a place on screen, so the change isn't recorded as a new visit. */
let restoring = false;

function show(place: NavPlace) {
  switch (place.view) {
    case 'session': {
      // Panes whose sessions are gone are left out; the others keep their places.
      const layout = removeLeaves(place.layout, leafIds(place.layout).filter((id) => !sessionExists(id)));
      const active = place.active && layout && leafIds(layout).includes(place.active) ? place.active : (leafIds(layout)[0] ?? null);
      useSessions.setState({ view: 'session', layout, paneIds: leafIds(layout), selectedId: active });
      break;
    }
    case 'settings':
      useSessions.setState({ view: 'settings', settingsSection: place.section, settingsFrom: place.from });
      break;
    case 'project':
      useProjectPage.setState({ root: place.root });
      useProjectPage.getState().setTab(place.tab);
      useSessions.getState().setView('project');
      break;
    case 'usage':
      openUsage(place.profileId);
      break;
    default:
      useSessions.getState().setView(place.view);
  }
}

/** Back (-1) or forward (1) through the places shown, as the mouse's back and forward buttons do. */
export function goInHistory(direction: 1 | -1): void {
  if (step(useNavHistory.getState().history, direction, usable) === null) return;
  // With unsaved memory edits this runs after the question, so it reads the history then.
  guardMemoryEdits(() => {
    const history = useNavHistory.getState().history;
    const index = step(history, direction, usable);
    if (index === null) return;
    restoring = true;
    try {
      show(history.entries[index]!);
    } finally {
      restoring = false;
    }
    // The entry becomes what came on screen (a split without its gone session), and a later visit adds after it.
    const landed: NavHistory = { ...history, index, at: 0 };
    useNavHistory.setState({ history: record(landed, currentPlace(), Date.now()) });
  });
}

/** Runs on every change of the stores (sessions change all the time), so it only sets anything when the place did. */
const note = () => {
  if (restoring) return;
  const { history } = useNavHistory.getState();
  const next = record(history, currentPlace(), Date.now());
  if (next !== history) useNavHistory.setState({ history: next });
};

/** Records the place on screen now and every place shown after it; returns what stops it. */
export function startRecording(): () => void {
  note();
  const stopSessions = useSessions.subscribe(note);
  const stopProject = useProjectPage.subscribe(note);
  // The Usage view's profile is part of its place.
  const stopUsage = useUsageView.subscribe(note);
  return () => {
    stopSessions();
    stopProject();
    stopUsage();
  };
}

/** Something on top (a dialog, menu or popover) keeps the mouse to itself. */
const overlayOpen = () => document.querySelector('[aria-modal="true"], [role="menu"], [data-popover]') !== null;

/**
 * Remembers the places shown, and steps through them with the mouse's back and forward buttons (buttons 3 and 4,
 * on macOS and Windows alike).
 */
export function useNavHistorySync(): void {
  useEffect(() => {
    const stopRecording = startRecording();
    const isSide = (event: MouseEvent) => event.button === 3 || event.button === 4;
    // Chromium would otherwise act on the press itself.
    const onDown = (event: MouseEvent) => {
      if (isSide(event)) event.preventDefault();
    };
    const onUp = (event: MouseEvent) => {
      if (!isSide(event)) return;
      event.preventDefault();
      if (!overlayOpen()) goInHistory(event.button === 3 ? -1 : 1);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    return () => {
      stopRecording();
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);
}
