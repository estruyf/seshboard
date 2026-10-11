import { useEffect } from 'react';
import { create } from 'zustand';
import { DEFAULT_THEME_ID, themeSlug, type ThemeEntry, type ThemeFileCheck, type ThemeState } from '@switchboard/protocol/theme-format';
import { setSyntaxThemes } from '../lib/highlight.ts';
import { applyTheme } from '../lib/themeApply.ts';
import { DEMO_TIME, exportThemeFile, resolveTheme, type ResolvedTheme } from '../lib/themeResolve.ts';
import { basename } from '../lib/format.ts';
import { usePreferences } from './preferencesStore.ts';
import { toast } from './toastStore.ts';

/** Demo Time as an entry, for a page without a bridge (and if main's list somehow lacks it). */
const DEMO_ENTRY: ThemeEntry = { id: DEFAULT_THEME_ID, builtIn: true, file: DEMO_TIME, path: null };

/** An error from main, without Electron's "Error invoking remote method…" prefix. */
export const bridgeError = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

/** The theme with this id, or Demo Time when it is gone (removed, or a file that no longer reads). */
export const themeById = (themes: readonly ThemeEntry[], id: string) => themes.find((t) => t.id === id) ?? themes.find((t) => t.id === DEFAULT_THEME_ID) ?? DEMO_ENTRY;

interface ThemesState extends ThemeState {
  /** The theme in use, resolved to every token of both modes. */
  active: { entry: ThemeEntry; resolved: ResolvedTheme };
  /** The syntax themes in use (code blocks highlight again when it changes). */
  syntaxKey: string;
  /** A file being imported: what main found in it (the import dialog shows it). */
  importing: ThemeFileCheck | null;
  replaceState(state: ThemeState): void;
  /** Uses a theme at once; `announce` shows "Switched to …" with Undo. */
  select(id: string, options?: { announce?: boolean }): void;
  /** Asks for a file, then opens the import dialog. */
  chooseImport(): Promise<void>;
  /** Opens the import dialog for a file (picked, or dropped on the window). */
  openImport(path: string): Promise<void>;
  closeImport(): void;
  /** Saves a theme as a .json file (Demo Time with every token). Resolves to the path, or null when cancelled. */
  exportTheme(id: string): Promise<string | null>;
}

function resolveActive(themes: readonly ThemeEntry[], id: string) {
  const entry = themeById(themes, id);
  const resolved = resolveTheme(entry.file);
  applyTheme(resolved);
  const syntaxKey = setSyntaxThemes({ light: resolved.light.syntax, dark: resolved.dark.syntax });
  return { active: { entry, resolved }, syntaxKey };
}

const initial: ThemeState = window.switchboard?.themes ?? { themes: [DEMO_ENTRY], problems: {} };

export const useThemes = create<ThemesState>()((set, get) => ({
  ...initial,
  // The preload read the themes with the preferences, so this runs before the first render.
  ...resolveActive(initial.themes, usePreferences.getState().prefs.themeId),
  importing: null,
  replaceState: (state) => set({ ...state, ...resolveActive(state.themes, usePreferences.getState().prefs.themeId) }),
  select: (id, options = {}) => {
    const previous = usePreferences.getState().prefs.themeId;
    if (previous === id) return;
    usePreferences.getState().update({ themeId: id });
    if (!options.announce) return;
    const entry = themeById(get().themes, id);
    const resolved = resolveTheme(entry.file);
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    toast(`Switched to ${entry.file.name}`, { dot: resolved[dark ? 'dark' : 'light'].tokens['accent-ink'], undo: () => usePreferences.getState().update({ themeId: previous }) });
  },
  chooseImport: async () => {
    const path = await window.switchboard?.chooseThemeFile();
    if (path) await get().openImport(path);
  },
  openImport: async (path) => {
    const bridge = window.switchboard;
    if (!bridge) return;
    try {
      set({ importing: await bridge.checkThemeFile(path) });
    } catch (error) {
      set({ importing: { ok: false, error: bridgeError(error), fileName: basename(path) } });
    }
  },
  closeImport: () => set({ importing: null }),
  exportTheme: async (id) => {
    const entry = themeById(get().themes, id);
    const file = exportThemeFile(entry.file, { full: entry.id === DEFAULT_THEME_ID });
    return (await window.switchboard?.exportTheme(`${themeSlug(entry.file.name)}.json`, `${JSON.stringify(file, null, 2)}\n`)) ?? null;
  },
}));

// A new theme id (from Settings, the palette, the menu bar or another window) applies at once.
usePreferences.subscribe((state, previous) => {
  if (state.prefs.themeId !== previous.prefs.themeId) useThemes.setState(resolveActive(useThemes.getState().themes, state.prefs.themeId));
});

/** Follows themes added, removed or edited (in any window, or in the themes folder). */
export function useThemesSync(): void {
  useEffect(() => window.switchboard?.onThemesChanged((state) => useThemes.getState().replaceState(state)), []);
}
