import { create } from 'zustand';

interface UltrathinkState {
  /** Message boxes (by draft key: a session's id) whose next message goes with ultrathink. */
  armed: Record<string, true>;
  set(key: string, on: boolean): void;
}

/**
 * "Ultrathink this turn" on the effort chip: the next message from that box gets the word, then it turns itself off.
 * Kept in memory only: a restart is a fresh start, and the choice is about one message, not the session.
 */
export const useUltrathink = create<UltrathinkState>((set) => ({
  armed: {},
  set: (key, on) =>
    set((state) => {
      if (!!state.armed[key] === on) return state;
      if (on) return { armed: { ...state.armed, [key]: true } };
      const { [key]: _off, ...rest } = state.armed;
      return { armed: rest };
    }),
}));
