import { create } from 'zustand';
import { addDays, dayOf, STRIP_DAYS } from '../components/activity/activityModel.ts';
import { showInMain } from './popoutsStore.ts';
import { useSessions } from './sessionsStore.ts';

interface ActivityState {
  /** The day on screen; null is today, also after midnight. */
  day: string | null;
  /** The strip's last day; null ends it on today. */
  stripEnd: string | null;
  /** The project picked in the week's bars. */
  project: string | null;
  /** The session rows opened to show what they did, per window. */
  expanded: ReadonlySet<string>;
  showDay(day: string | null): void;
  moveStrip(end: string | null, day: string | null): void;
  toggleProject(key: string): void;
  toggleExpanded(key: string): void;
}

export const useActivity = create<ActivityState>()((set) => ({
  day: null,
  stripEnd: null,
  project: null,
  expanded: new Set(),
  showDay: (day) => set({ day }),
  moveStrip: (stripEnd, day) => set({ stripEnd, day }),
  toggleProject: (key) => set((s) => ({ project: s.project === key ? null : key })),
  toggleExpanded: (key) =>
    set((s) => {
      const expanded = new Set(s.expanded);
      if (!expanded.delete(key)) expanded.add(key);
      return { expanded };
    }),
}));

/** Opens Activity, as a main view like Upcoming: on today, or a day. A pop-out has no Activity: the main window shows it. */
export function openActivity(day: string | null = null): void {
  if (showInMain({ kind: 'activity', day })) return;
  // A day in the latest strip keeps it, so today stays one click away; an older one gets a strip that ends on it.
  const today = dayOf(Date.now());
  useActivity.setState({ day: day === today ? null : day, stripEnd: day && day <= addDays(today, -STRIP_DAYS) ? day : null, project: null });
  useSessions.getState().setView('activity');
}
