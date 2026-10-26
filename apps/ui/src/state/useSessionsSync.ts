import { useEffect } from 'react';
import { create } from 'zustand';
import type { LiveSession, SessionsChanged, SessionsSnapshot } from '@seshboard/protocol/client';
import type { EngineClient } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { usePreferences } from './preferencesStore.ts';
import { createBatcher, type Schedule } from './sessionChanges.ts';
import { toRows, useSessions } from './sessionsStore.ts';
import { startupSession } from './sidebarRows.ts';
import { createSnapshotEventQueue } from './snapshotEvents.ts';
import { loadDrafts } from './useDraftsSync.ts';
import { popoutSession } from './popoutsStore.ts';

const SELECTED_KEY = 'ui.selectedSession';

type SessionsEvent = { kind: 'changed'; change: SessionsChanged } | { kind: 'live'; live: LiveSession[] };

/**
 * The next animation frame, or 100ms when frames don't come: a hidden window gets none, and the store must
 * stay current there too (anything that reads it with getState() would see an old list).
 */
const nextFrame: Schedule = (run) => {
  const frame = requestAnimationFrame(run);
  const timer = setTimeout(run, 100);
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
};

/** Each connection's first sessions list, so the ready report can count it instead of asking again. */
const snapshots = new WeakMap<EngineClient, Promise<SessionsSnapshot>>();

/** The sessions list this connection loaded first (asked for here if the sync hasn't asked yet). */
export function firstSnapshot(client: EngineClient): Promise<SessionsSnapshot> {
  let snapshot = snapshots.get(client);
  if (!snapshot) {
    snapshot = client.call('sessions.list', {});
    snapshots.set(client, snapshot);
  }
  return snapshot;
}

/**
 * The startup choice is made once per window, not again after the engine reconnects. `starting` covers
 * the attempt in flight; `started` is set once it has been applied, so a connection that drops before
 * then (the call is rejected) lets the next one try again.
 */
let starting = false;
let started = false;
/** Whether the startup choice has been applied in this window; until then the selection isn't saved. */
const useStartup = create<{ decided: boolean }>()(() => ({ decided: false }));

/**
 * Keeps the sessions store in sync with the engine: one snapshot per
 * connection, then deltas. Also persists the selected session and, when the
 * window opens, shows Home, that session again or New session (the Startup preference).
 */
export function useSessionsSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;

  useEffect(() => {
    if (!client) return;
    const store = useSessions.getState();
    // Events are applied together once per frame. Adding a profile with a long history (or syncing ~/.claude)
    // sends hundreds of them at once; one update each re-rendered the sidebar for every one and, past about a
    // hundred, ran into React's limit on nested updates (and stalled the window).
    const batch = createBatcher<SessionsEvent>((batched) => {
      const changes = batched.flatMap((event) => (event.kind === 'changed' ? [event.change] : []));
      // The live list replaces the last one whole, and the session list and it are separate: the newest is all that counts.
      const live = batched.findLast((event) => event.kind === 'live');
      store.applyChanged(changes);
      if (live?.kind === 'live') store.setLive(live.live);
    }, nextFrame);
    const events = createSnapshotEventQueue(
      (snapshot: SessionsSnapshot) => store.applySnapshot(snapshot),
      (event: SessionsEvent) => batch.push(event),
    );
    // Events can arrive before the snapshot response; replay them after it so stale data cannot win.
    const offChanged = client.on('sessions.changed', (change) => events.event({ kind: 'changed', change }));
    const offLive = client.on('sessions.live', ({ live }) => events.event({ kind: 'live', live }));
    // The saved drafts come in with the first list, so its rows show their unsent messages from the first paint.
    // The events that came in while it loaded are applied with it, not a frame later.
    const snapshot = Promise.all([firstSnapshot(client), loadDrafts(client)]).then(([snapshot]) => {
      events.snapshot(snapshot);
      batch.flush();
    });
    // A pop-out shows its one session (PopoutApp selects it): the window to open with is the main window's to choose.
    if (!started && !starting && !popoutSession) {
      starting = true;
      void Promise.all([client.call('appState.get', { key: SELECTED_KEY }), snapshot])
        .then(([{ value }]) => {
          started = true;
          const state = useSessions.getState();
          // Someone already picked something (a notification click, ⌘N): leave it.
          if (state.selectedId !== null || state.view !== 'session') return;
          const { startupView, sessionScope } = usePreferences.getState().prefs;
          const id = startupSession(toRows(state.sessions, state.live), value, startupView, sessionScope);
          if (id) state.select(id);
          else if (startupView === 'home') state.goHome();
          else state.openNewSession();
        })
        .catch(() => {})
        .finally(() => {
          starting = false;
          // The choice is made (or the connection dropped): from now on the selection is worth saving.
          if (started) useStartup.setState({ decided: true });
        });
    }
    return () => {
      offChanged();
      offLive();
      // The next connection starts from a new list.
      batch.cancel();
    };
  }, [client]);

  // Saved only after the startup choice, so the empty selection the window opens with doesn't wipe
  // the session to reopen. Closing a session (or going Home) saves the empty selection too.
  const selectedId = useSessions((s) => s.selectedId);
  const decided = useStartup((s) => s.decided);
  useEffect(() => {
    if (client && decided && !popoutSession) void client.call('appState.set', { key: SELECTED_KEY, value: selectedId }).catch(() => {});
  }, [client, decided, selectedId]);
}
