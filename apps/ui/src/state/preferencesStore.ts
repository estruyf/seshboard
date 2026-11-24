import { useEffect } from 'react';
import { create } from 'zustand';
import { DEFAULT_PREFERENCES, mergePreferences, sanitizePreferences, type Preferences, type PreferencesPatch } from '@seshboard/protocol/bridge';

interface PreferencesState {
  prefs: Preferences;
  /** Optimistic: applies here at once; main saves it and tells every window. `sounds` and `notifications` may name only some fields. */
  update(patch: PreferencesPatch): void;
  replace(prefs: Preferences): void;
}

export const usePreferences = create<PreferencesState>()((set) => ({
  // The preload reads them synchronously, so the first render already has them.
  prefs: { ...DEFAULT_PREFERENCES, ...window.seshboard?.preferences },
  update: (patch) => {
    set((s) => ({ prefs: { ...s.prefs, ...sanitizePreferences(mergePreferences(s.prefs, patch)) } }));
    window.seshboard?.setPreferences(patch);
  },
  // Over the defaults, so a key main doesn't send (a main process older than this window) keeps its default.
  replace: (prefs) => set({ prefs: { ...DEFAULT_PREFERENCES, ...prefs } }),
}));

/** Minimal mode is on (Settings › Theme, ⌘⇧.). Components read this; styles.css reads `data-minimal` only where a class would be clumsy. */
export const useMinimal = (): boolean => usePreferences((s) => s.prefs.minimalMode);

// Minimal mode is also an attribute on the root, for styles.css: set before the first paint, and on every change.
if (typeof document !== 'undefined') {
  const applyMinimal = (on: boolean) => (on ? document.documentElement.setAttribute('data-minimal', 'true') : document.documentElement.removeAttribute('data-minimal'));
  applyMinimal(usePreferences.getState().prefs.minimalMode);
  usePreferences.subscribe((s, before) => s.prefs.minimalMode !== before.prefs.minimalMode && applyMinimal(s.prefs.minimalMode));
  // Code highlighting off: styles.css draws diffs without red and green (highlight.ts takes the colour out of code).
  const applyCodePlain = (highlighting: boolean) => document.documentElement.toggleAttribute('data-code-plain', !highlighting);
  applyCodePlain(usePreferences.getState().prefs.codeHighlighting);
  usePreferences.subscribe((s, before) => s.prefs.codeHighlighting !== before.prefs.codeHighlighting && applyCodePlain(s.prefs.codeHighlighting));
}

/** Follows changes made elsewhere (the menu bar, another window). */
export function usePreferencesSync(): void {
  useEffect(() => window.seshboard?.onPreferencesChanged((prefs) => usePreferences.getState().replace(prefs)), []);
}
