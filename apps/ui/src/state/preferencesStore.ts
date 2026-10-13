import { useEffect } from 'react';
import { create } from 'zustand';
import { DEFAULT_PREFERENCES, mergePreferences, sanitizePreferences, type Preferences, type PreferencesPatch } from '@switchboard/protocol/bridge';

interface PreferencesState {
  prefs: Preferences;
  /** Optimistic: applies here at once; main saves it and tells every window. `sounds` and `notifications` may name only some fields. */
  update(patch: PreferencesPatch): void;
  replace(prefs: Preferences): void;
}

export const usePreferences = create<PreferencesState>()((set) => ({
  // The preload reads them synchronously, so the first render already has them.
  prefs: { ...DEFAULT_PREFERENCES, ...window.switchboard?.preferences },
  update: (patch) => {
    set((s) => ({ prefs: { ...s.prefs, ...sanitizePreferences(mergePreferences(s.prefs, patch)) } }));
    window.switchboard?.setPreferences(patch);
  },
  replace: (prefs) => set({ prefs }),
}));

/** Follows changes made elsewhere (the menu bar, another window). */
export function usePreferencesSync(): void {
  useEffect(() => window.switchboard?.onPreferencesChanged((prefs) => usePreferences.getState().replace(prefs)), []);
}
