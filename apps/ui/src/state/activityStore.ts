import { create } from 'zustand';
import { addDays, dayOf, STRIP_DAYS } from '../components/activity/activityModel.ts';
import { showInMain } from './popoutsStore.ts';
import { useSessions } from './sessionsStore.ts';

/** What the page sums up: the day picked in the strip, or the week it ends on. */
export type ActivitySpan = 'day' | 'week';

interface ActivityState {
  /** The day on screen; null is today, also after midnight. */
  day: string | null;
  /** The strip's last day; null ends it on today. */
  stripEnd: string | null;
  span: ActivitySpan;
  /** The project picked in the bars. Its name stays with it: the days on screen may not have the project. */
  project: { key: string; name: string } | null;
  /** The session rows opened to show what they did, per window. */
  expanded: ReadonlySet<string>;
  /** Picking a day always shows that day, also from the week. */
  showDay(day: string | null): void;
  setSpan(span: ActivitySpan): void;
  moveStrip(end: string | null, day: string | null): void;
  toggleProject(key: string, name: string): void;
  toggleExpanded(key: string): void;
}

export const useActivity = create<ActivityState>()((set) => ({
  day: null,
  stripEnd: null,
  span: 'day',
  project: null,
  expanded: new Set(),
  showDay: (day) => set({ day, span: 'day' }),
  setSpan: (span) => set({ span }),
  moveStrip: (stripEnd, day) => set({ stripEnd, day }),
  toggleProject: (key, name) => set((s) => ({ project: s.project?.key === key ? null : { key, name } })),
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
  useActivity.setState({ day: day === today ? null : day, stripEnd: day && day <= addDays(today, -STRIP_DAYS) ? day : null, span: 'day', project: null });
  useSessions.getState().setView('activity');
}
