import type { Effort, PermissionMode } from '@switchboard/protocol/client';
import { create } from 'zustand';

/** What a session that isn't running resumes with: the model chip, effort and permission mode saved for it. */
export interface SavedSettings {
  /** null is Claude Code's default model. */
  model: string | null;
  effort: Effort | null;
  permissionMode: PermissionMode;
}

interface SavedSettingsState {
  bySession: Record<string, SavedSettings>;
  /** Sets a session's saved settings; an updater gets the current ones (undefined while not loaded). */
  set(sessionId: string, next: SavedSettings | ((current: SavedSettings | undefined) => SavedSettings | undefined)): void;
}

/**
 * The saved settings of sessions that aren't running, shared so the Large context notice prices the model the chip
 * shows, not the one the session last ran with.
 */
export const useSavedSettings = create<SavedSettingsState>((set) => ({
  bySession: {},
  set: (sessionId, next) =>
    set((state) => {
      const value = typeof next === 'function' ? next(state.bySession[sessionId]) : next;
      if (!value) return state;
      return { bySession: { ...state.bySession, [sessionId]: value } };
    }),
}));
