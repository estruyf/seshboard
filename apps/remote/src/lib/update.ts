/**
 * A newer remote app on the site. A Home Screen app on an iPhone is suspended rather than closed, so it can run the
 * same code for days: it asks for `version.json` when it comes back to the front, and offers Reload when the site has
 * a newer build. Pure, with tests; `useUpdate` does the asking.
 */

/** How long Later hides the Reload bar. A newer version than the one put off shows it again at once. */
export const SNOOZE_MS = 60 * 60_000;
/** While the app stays in front, it asks again this often. */
export const CHECK_EVERY_MS = 30 * 60_000;

export interface Snooze {
  /** The version Later was for. */
  version: string;
  until: number;
}

/** The build in `version.json` (`{ "build": "…" }`), or null for anything else. */
export function parseVersion(json: unknown): string | null {
  const build = (json as { build?: unknown } | null)?.build;
  return typeof build === 'string' && build.trim() ? build.trim() : null;
}

/**
 * What to show: nothing while this is the latest build (or the site said nothing), `snoozed` while Later holds for
 * that version, else `ready` (the Reload bar, and pull to refresh reloads the app).
 */
export function updateState({ running, latest, snooze, now }: { running: string; latest: string | null; snooze: Snooze | null; now: number }): 'none' | 'ready' | 'snoozed' {
  // A development build has no version to compare.
  if (!latest || !running || latest === running) return 'none';
  if (snooze && snooze.version === latest && now < snooze.until) return 'snoozed';
  return 'ready';
}

/** Later, for this version. */
export const snoozeFor = (version: string, now: number): Snooze => ({ version, until: now + SNOOZE_MS });

/** A kept snooze, if it still reads as one. */
export function parseSnooze(json: unknown): Snooze | null {
  const value = json as Partial<Snooze> | null;
  return value && typeof value.version === 'string' && typeof value.until === 'number' ? { version: value.version, until: value.until } : null;
}
