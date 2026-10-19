import { create } from 'zustand';
import { showInMain } from './popoutsStore.ts';
import { useSessions } from './sessionsStore.ts';
import { DEFAULT_FILTER, readFilter, type UpcomingFilter, type UpcomingKind } from './upcoming.ts';

// Upcoming's filters, per window: kept in sessionStorage, so a reload keeps them and another window has its own.
const FILTER_KEY = 'ui.upcomingFilter';

function readStored(): UpcomingFilter {
  try {
    return readFilter(JSON.parse(sessionStorage.getItem(FILTER_KEY) ?? 'null'));
  } catch {
    return DEFAULT_FILTER;
  }
}
function remember(filter: UpcomingFilter): void {
  try {
    sessionStorage.setItem(FILTER_KEY, JSON.stringify(filter));
  } catch {
    // Remembering is a convenience.
  }
}

interface UpcomingState {
  filter: UpcomingFilter;
  /** A schedule whose next run should come into view (a notification's click), once. */
  focus: { scheduleId: string; seq: number } | null;
  setKind(kind: UpcomingKind): void;
  setProject(project: string | null): void;
}

let seq = 0;

export const useUpcoming = create<UpcomingState>()((set, get) => ({
  filter: readStored(),
  focus: null,
  setKind: (kind) => {
    set({ filter: { ...get().filter, kind } });
    remember(get().filter);
  },
  setProject: (project) => {
    set({ filter: { ...get().filter, project } });
    remember(get().filter);
  },
}));

/**
 * Opens Upcoming, as a main view like Home: on a filter (`kind`), and with a schedule's run in view (a notification).
 * A pop-out has no Upcoming: the main window shows it.
 */
export function openUpcoming(options: { kind?: UpcomingKind; scheduleId?: string | null } = {}): void {
  if (showInMain({ kind: 'upcoming', filter: options.kind ?? null, scheduleId: options.scheduleId ?? null })) return;
  const state = useUpcoming.getState();
  if (options.kind) state.setKind(options.kind);
  if (options.scheduleId) {
    // The run must be on screen: a filter that hides runs, or another project, gives way.
    if (state.filter.kind === 'queue') state.setKind('all');
    useUpcoming.setState({ focus: { scheduleId: options.scheduleId, seq: ++seq } });
  }
  useSessions.getState().setView('upcoming');
}
