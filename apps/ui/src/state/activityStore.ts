import { create } from 'zustand';
import { addDays, dayOf, stripWeek, WEEK_DAYS, type DayRange } from '../components/activity/activityModel.ts';
import { showInMain } from './popoutsStore.ts';
import { useSessions } from './sessionsStore.ts';

/** What the page sums up: the day picked in the strip, the week of the strip, or a range of days. */
export type ActivitySpan = 'day' | 'week' | 'range';

interface ActivityState {
  /** The day on screen; null is today, also after midnight. */
  day: string | null;
  /** The Monday of the strip's week; null is this week. */
  week: string | null;
  span: ActivitySpan;
  /** The range picked last, kept while the page shows a day or a week. Null until Range is first opened. */
  range: DayRange | null;
  /** The project picked in the bars. Its name stays with it: the days on screen may not have the project. */
  project: { key: string; name: string } | null;
  /** The session rows opened to show what they did, per window. */
  expanded: ReadonlySet<string>;
  /** The projects opened in Range, which starts with only their names: it can hold two months of sessions. */
  openProjects: ReadonlySet<string>;
  /** Picking a day always shows that day, also from the week or a range. */
  showDay(day: string | null): void;
  setSpan(span: ActivitySpan): void;
  setRange(range: DayRange): void;
  moveStrip(week: string | null, day: string | null): void;
  toggleProject(key: string, name: string): void;
  toggleExpanded(key: string): void;
  toggleOpenProject(key: string): void;
}

const toggled = (set: ReadonlySet<string>, key: string) => {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
};

export const useActivity = create<ActivityState>()((set) => ({
  day: null,
  week: null,
  span: 'day',
  range: null,
  project: null,
  expanded: new Set(),
  openProjects: new Set(),
  showDay: (day) => set({ day, week: stripWeek(day, dayOf(Date.now())), span: 'day' }),
  // Range starts as the last seven days: they always have something in them, unlike this week on a Monday morning.
  setSpan: (span) => set((s) => ({ span, range: s.range ?? (span === 'range' ? { from: addDays(dayOf(Date.now()), 1 - WEEK_DAYS), to: null } : null) })),
  setRange: (range) => set({ range }),
  moveStrip: (week, day) => set({ week, day }),
  toggleProject: (key, name) => set((s) => ({ project: s.project?.key === key ? null : { key, name } })),
  toggleExpanded: (key) => set((s) => ({ expanded: toggled(s.expanded, key) })),
  toggleOpenProject: (key) => set((s) => ({ openProjects: toggled(s.openProjects, key) })),
}));

/** Opens Activity, as a main view like Upcoming: on today, or a day. A pop-out has no Activity: the main window shows it. */
export function openActivity(day: string | null = null): void {
  if (showInMain({ kind: 'activity', day })) return;
  const today = dayOf(Date.now());
  useActivity.setState({ day: day === today ? null : day, week: stripWeek(day, today), span: 'day', project: null });
  useSessions.getState().setView('activity');
}
