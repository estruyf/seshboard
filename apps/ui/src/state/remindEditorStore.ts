import { create } from 'zustand';

/** What Remind me… is open for: the sessions (one, or a selection), and what runs once it is set (catch-up moves on). */
export interface RemindTarget {
  sessionIds: string[];
  then?: () => void;
}

/** The sessions Remind me… is open for (L on a row or in catch-up, the menus, the palette), else null. */
export const useRemindEditor = create<{ target: RemindTarget | null; open(target: RemindTarget): void; close(): void }>()((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));

/** Opens Remind me… for sessions of this computer; another computer's sessions have no reminders (v1). */
export const openRemindEditor = (sessionIds: string[], then?: () => void): void => useRemindEditor.getState().open({ sessionIds, ...(then ? { then } : {}) });
