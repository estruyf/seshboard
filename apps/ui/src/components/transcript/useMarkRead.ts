import { useEffect, useRef, useState } from 'react';
import type { EngineClient } from '../../engine/connection.ts';
import { isKeptUnread } from '../../state/keptUnread.ts';
import { markReadDelay } from '../../state/markRead.ts';
import { usePreferences } from '../../state/preferencesStore.ts';

const inFront = () => document.visibilityState === 'visible' && document.hasFocus();

/** True while this window is shown and in front: only then can you be looking at a session in it. */
function useWindowInFront(): boolean {
  const [front, setFront] = useState(inFront);
  useEffect(() => {
    // After the event: focus moving into an iframe (a mod, a file preview) blurs the window but keeps it in front.
    const update = () => setTimeout(() => setFront(inFront()), 0);
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return front;
}

/**
 * Marks the session read while you look at it (`markReadDelay`): one you opened unread after the seconds set in
 * Settings › Sessions, activity that arrives while you look almost at once. A look starts when you open the session
 * or come back to the window. `onRead` runs just before a session opened unread is marked read.
 */
export function useMarkRead(client: EngineClient | null, sessionId: string, summary: { unread: boolean; updatedAt: number } | null, onRead: () => void): void {
  const setting = usePreferences((s) => s.prefs.markReadAfter);
  const front = useWindowInFront();
  const unread = summary?.unread ?? null;
  // When this look started, and whether the session was unread then (null until its summary is known).
  const look = useRef<{ sessionId: string; at: number; unread: boolean | null } | null>(null);
  if (!front) look.current = null;
  else if (look.current?.sessionId !== sessionId) look.current = { sessionId, at: Date.now(), unread };
  if (look.current && look.current.unread === null) look.current.unread = unread;
  const readNow = useRef(onRead);
  readNow.current = onRead;

  useEffect(() => {
    const current = look.current;
    if (!client || !current || unread !== true) return;
    const unreadWhenLooked = current.unread ?? true;
    const delay = markReadDelay({ unread, keptUnread: isKeptUnread(sessionId), unreadWhenLooked, lookedFor: Date.now() - current.at, setting });
    if (delay === null) return;
    const timer = setTimeout(() => {
      if (unreadWhenLooked) readNow.current();
      void client.call('sessions.markViewed', { sessionId }).catch(() => {});
    }, delay);
    return () => clearTimeout(timer);
  }, [client, sessionId, front, unread, summary?.updatedAt, setting]);
}
