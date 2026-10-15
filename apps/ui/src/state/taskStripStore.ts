import { create } from 'zustand';

/** The lists the strip above the message box can open: Claude's task list, or what runs in the background. */
export type TaskStrip = 'todos' | 'background';

/** Clicking a strip's pill opens it, closes it when it is the open one, and swaps it for the other one. */
export const toggledStrip = (open: TaskStrip | null, strip: TaskStrip): TaskStrip | null => (open === strip ? null : strip);

interface TaskStripState {
  open: ReadonlyMap<string, TaskStrip>;
  toggle(sessionId: string, strip: TaskStrip): void;
}

/**
 * Which strip is open, per session. Kept here rather than in the session view so it stays when you go to another
 * session and come back, or hide the session and show it again. Not saved across restarts.
 */
export const useTaskStrip = create<TaskStripState>()((set) => ({
  open: new Map(),
  toggle: (sessionId, strip) =>
    set((s) => {
      const next = new Map(s.open);
      const now = toggledStrip(s.open.get(sessionId) ?? null, strip);
      if (now) next.set(sessionId, now);
      else next.delete(sessionId);
      return { open: next };
    }),
}));
