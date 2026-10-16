import { useMemo } from 'react';
import { create } from 'zustand';
import { focusLevel, focusSessions, focusVerdict, type FocusLevel, type FocusSession, type FocusVerdict } from './focus.ts';
import { useHosts } from './hostsStore.ts';
import { currentRemoteRows, openRow, useRemoteRows } from './useRemoteRows.ts';
import { usePreferences } from './preferencesStore.ts';
import { useSessions } from './sessionsStore.ts';

/** The focus limit as the UI shows it: on or off, what counts, and where the count stands. */
export interface FocusSummary {
  /** Null while the limit is off. */
  limit: number | null;
  mode: 'nudge' | 'strict';
  sessions: FocusSession[];
  count: number;
  level: FocusLevel;
}

/** What counts right now, for the counter, the note in New session and the gate. Follows every store it reads. */
export function useFocus(): FocusSummary {
  const hosts = useHosts((s) => s.hosts);
  const permissions = useHosts((s) => s.permissions);
  const live = useSessions((s) => s.live);
  const sessions = useSessions((s) => s.sessions);
  const limit = usePreferences((s) => s.prefs.focusLimit);
  const mode = usePreferences((s) => s.prefs.focusMode);
  const countExternal = usePreferences((s) => s.prefs.focusCountExternal);
  const countRemote = usePreferences((s) => s.prefs.focusCountRemote);
  const remote = useRemoteRows();
  const counted = useMemo(
    // Off, nothing needs counting.
    () => (limit === null ? [] : focusSessions({ hosts, live, sessions, permissions: permissions.values(), countExternal, remote, countRemote })),
    [limit, hosts, live, sessions, permissions, countExternal, remote, countRemote],
  );
  return { limit, mode, sessions: counted, count: counted.length, level: limit === null ? 'under' : focusLevel(counted.length, limit) };
}

/** The gate's verdict now, from the stores' current state (outside React). */
export function currentVerdict(target: string | null = null): FocusVerdict {
  const prefs = usePreferences.getState().prefs;
  if (prefs.focusLimit === null) return { kind: 'allowed' };
  const { hosts, permissions } = useHosts.getState();
  const { live, sessions } = useSessions.getState();
  const counted = focusSessions({ hosts, live, sessions, permissions: permissions.values(), countExternal: prefs.focusCountExternal, remote: currentRemoteRows(), countRemote: prefs.focusCountRemote });
  return focusVerdict(counted, prefs, target);
}

/** How the person answered the dialog: start anyway, keep the prompt and do nothing, add it to the queue, or open a session. */
export type GateChoice = { kind: 'start' } | { kind: 'cancel' } | { kind: 'later' } | { kind: 'open'; sessionId: string };

/** The dialog on screen: the verdict it shows, and whether this start can wait in the queue instead. */
export interface GateRequest {
  verdict: Exclude<FocusVerdict, { kind: 'allowed' }>;
  canSaveForLater: boolean;
  /** What the queue button says: "Add to queue", or "Keep it queued" for an item started from the queue. */
  saveLabel: string;
  resolve(choice: GateChoice): void;
}

export const useFocusGate = create<{ request: GateRequest | null }>()(() => ({ request: null }));

/** What the caller should do after the gate: start, stop (the prompt stays where it is), or the prompt went to the queue. */
export type GateOutcome = 'start' | 'stop' | 'saved';

/**
 * The one gate every start path goes through: New session, a message to a session that doesn't count
 * yet (which brings it back), project actions that prompt Claude, and Claude in the terminal. Under the
 * limit (or with it off) it answers at once. At the limit it asks in an alertdialog and never starts
 * silently over it: Nudge can start anyway, Strict can't. `target` is the session the work goes to (null
 * for a new one); `saveForLater` is offered when the start has a prompt that can wait in the queue, as `saveLabel`.
 */
export async function passFocusGate(options: { target?: string | null; saveForLater?: () => Promise<unknown>; saveLabel?: string } = {}): Promise<GateOutcome> {
  const verdict = currentVerdict(options.target ?? null);
  if (verdict.kind === 'allowed') return 'start';
  // One question at a time: a second start while the dialog is open waits for nothing and stops.
  if (useFocusGate.getState().request) return 'stop';
  const choice = await new Promise<GateChoice>((resolve) => {
    useFocusGate.setState({
      request: {
        verdict,
        canSaveForLater: !!options.saveForLater,
        saveLabel: options.saveLabel ?? 'Add to queue',
        resolve: (choice) => {
          useFocusGate.setState({ request: null });
          resolve(choice);
        },
      },
    });
  });
  switch (choice.kind) {
    case 'start':
      // Strict never starts over the limit, whatever asked.
      return verdict.kind === 'ask' ? 'start' : 'stop';
    case 'later':
      if (!options.saveForLater) return 'stop';
      await options.saveForLater();
      return 'saved';
    case 'open':
      openRow(choice.sessionId);
      return 'stop';
    case 'cancel':
      return 'stop';
  }
}
