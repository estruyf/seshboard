import { modKey } from '@seshboard/protocol/client';

/**
 * Whether a mod's UI shows: Show mods (the main switch) and the mod's own switch in Settings › Mods. The mod's switch
 * keeps its state while Show mods is off, for when it is turned back on. Pure, so it can be tested.
 */
export interface ModPrefs {
  showMods: boolean;
  hiddenMods: readonly string[];
}

export function modShown(prefs: ModPrefs, profileId: string | null | undefined, plugin: string): boolean {
  if (!prefs.showMods) return false;
  return !prefs.hiddenMods.includes(modKey(profileId ?? '', plugin));
}

/** The mods of a list that show. */
export function shownMods<T extends { plugin: string }>(prefs: ModPrefs, profileId: string | null | undefined, items: readonly T[]): T[] {
  return items.filter((item) => modShown(prefs, profileId, item.plugin));
}

/** `hiddenMods` with one mod's switch turned on (shown) or off (hidden). */
export function withModShown(hiddenMods: readonly string[], profileId: string, plugin: string, shown: boolean): string[] {
  const key = modKey(profileId, plugin);
  const rest = hiddenMods.filter((k) => k !== key);
  return shown ? rest : [...rest, key];
}
