import { useCallback, useEffect, useState } from 'react';
import { CHECK_EVERY_MS, parseSnooze, parseVersion, snoozeFor, updateState, type Snooze } from '../lib/update.ts';
import { useNow } from './SessionList.tsx';

/** This build, from vite.config.ts; empty while developing. */
const RUNNING: string = import.meta.env.VITE_APP_BUILD ?? '';
/** Later, kept in this browser so a reload doesn't bring the bar straight back. */
const SNOOZE_KEY = 'switchboard-remote:update-later';

function keptSnooze(): Snooze | null {
  try {
    return parseSnooze(JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? 'null'));
  } catch {
    return null;
  }
}

/**
 * Whether the site serves a newer remote app (`lib/update.ts`): asked when the app opens, each time it comes back to
 * the front and every 30 minutes while it stays there, past every cache (`no-store`: GitHub Pages keeps pages for 10
 * minutes). `later` hides the Reload bar for an hour; the state is `snoozed` meanwhile, and pull to refresh still updates.
 */
export function useUpdate(): { state: 'none' | 'ready' | 'snoozed'; later: () => void } {
  const [latest, setLatest] = useState<string | null>(null);
  const [snooze, setSnooze] = useState<Snooze | null>(keptSnooze);
  const now = useNow();

  useEffect(() => {
    if (!RUNNING) return;
    const check = () =>
      void fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((json: unknown) => {
          const version = parseVersion(json);
          if (version) setLatest(version);
        })
        // Offline, or the site is down: ask again next time.
        .catch(() => {});
    check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    const timer = setInterval(() => document.visibilityState === 'visible' && check(), CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const later = useCallback(() => {
    if (!latest) return;
    const next = snoozeFor(latest, Date.now());
    setSnooze(next);
    try {
      localStorage.setItem(SNOOZE_KEY, JSON.stringify(next));
    } catch {
      // Storage is off: Later lasts until the page closes.
    }
  }, [latest]);

  return { state: updateState({ running: RUNNING, latest, snooze, now }), later };
}
