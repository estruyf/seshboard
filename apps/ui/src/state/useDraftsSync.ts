import { useEffect } from 'react';
import type { EngineClient } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { changedDrafts, parseDrafts, parseFirstPrompts, serializeDrafts } from './drafts.ts';
import { useDrafts, type ComposerDraft } from './draftsStore.ts';
import { useHosts } from './hostsStore.ts';
import { useSessions } from './sessionsStore.ts';

/** Where unsent messages are kept between launches, next to the sidebar's width and sections. */
const DRAFTS_KEY = 'ui.drafts';
const SAVE_DELAY_MS = 400;
/** Changes for the other windows go together, a few keystrokes at a time (a draft can carry images). */
const RELAY_DELAY_MS = 120;

/** Each connection reads the saved drafts once; the sessions list waits for it, so rows show their pen from the first paint. */
const reads = new WeakMap<EngineClient, Promise<void>>();

/** Reads the saved drafts into the store (once per connection). Never rejects: without them, the app starts with none. */
export function loadDrafts(client: EngineClient): Promise<void> {
  let read = reads.get(client);
  if (!read) {
    read = client.call('appState.get', { key: DRAFTS_KEY }).then(
      ({ value }) => useDrafts.getState().load(parseDrafts(value), parseFirstPrompts(value)),
      () => useDrafts.getState().load({}),
    );
    reads.set(client, read);
  }
  return read;
}

/**
 * Restores unsent messages (their text, not images) and saves them, a moment after each change and when the window
 * goes. Only the main window saves; a pop-out's drafts reach it through main (`useDraftsRelay`), so two windows
 * never write over each other's.
 */
export function useDraftsSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useDraftsRelay();

  useEffect(() => {
    if (!client) return;
    void loadDrafts(client);
    let saved = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      clearTimeout(timer);
      const { drafts, firstPrompts, loaded } = useDrafts.getState();
      // Until the saved ones are read, writing would wipe them.
      if (!loaded || window.seshboard?.popout) return;
      const value = serializeDrafts(drafts, firstPrompts);
      const json = JSON.stringify(value);
      if (json === saved) return;
      saved = json;
      // Plain JSON by construction; its interfaces just don't carry the index signature the JSON type wants.
      void client.call('appState.set', { key: DRAFTS_KEY, value: value as never }).catch(() => {
        saved = '';
      });
    };
    void loadDrafts(client).then(() => {
      const { drafts, firstPrompts } = useDrafts.getState();
      saved = JSON.stringify(serializeDrafts(drafts, firstPrompts));
      settle();
    });
    const off = useDrafts.subscribe((state, previous) => {
      if (state.drafts === previous.drafts && state.firstPrompts === previous.firstPrompts && state.loaded === previous.loaded) return;
      clearTimeout(timer);
      timer = setTimeout(save, SAVE_DELAY_MS);
    });
    // New sessions' first prompts follow their sessions: forgotten once there is a transcript, shown when one failed.
    const settle = () => {
      const sessions = useSessions.getState();
      const hosts = useHosts.getState().hosts;
      useDrafts.getState().settleFirstPrompts({
        ready: sessions.loaded && sessions.complete && useHosts.getState().loaded,
        hasTranscript: (id) => sessions.sessions.has(id),
        hostState: (id) => hosts.get(id)?.state,
      });
    };
    const offSessions = useSessions.subscribe((state, previous) => {
      if (state.sessions !== previous.sessions || state.complete !== previous.complete || state.loaded !== previous.loaded) settle();
    });
    const offHosts = useHosts.subscribe((state, previous) => {
      if (state.hosts !== previous.hosts || state.loaded !== previous.loaded) settle();
    });
    const offFirst = useDrafts.subscribe((state, previous) => {
      if (state.firstPrompts !== previous.firstPrompts) settle();
    });
    // Quitting right after typing: save what's there rather than wait for the timer.
    window.addEventListener('pagehide', save);
    return () => {
      off();
      offSessions();
      offHosts();
      offFirst();
      clearTimeout(timer);
      window.removeEventListener('pagehide', save);
    };
  }, [client]);
}

/**
 * Keeps unsent messages the same in every window: changes made here go to the others (through main), theirs
 * come in. Only while there is another window to tell. A new pop-out first asks the main window for all of them.
 */
function useDraftsRelay(): void {
  useEffect(() => {
    const bridge = window.seshboard;
    if (!bridge) return;
    const popout = bridge.popout !== null;
    let others = popout || bridge.popouts.length > 0;
    let applying = false;
    let pending: Record<string, ComposerDraft | null> = {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      clearTimeout(timer);
      timer = undefined;
      if (Object.keys(pending).length > 0) bridge.relayDrafts(pending);
      pending = {};
    };
    const offStore = useDrafts.subscribe((state, previous) => {
      // Reading the saved drafts isn't a change, and drafts from another window go back to none.
      if (applying || !others || state.drafts === previous.drafts || !previous.loaded) return;
      Object.assign(pending, changedDrafts(previous.drafts, state.drafts));
      timer ??= setTimeout(flush, RELAY_DELAY_MS);
    });
    const offRelayed = bridge.onDraftsRelayed((change) => {
      applying = true;
      try {
        useDrafts.getState().applyRelayed(change as Record<string, ComposerDraft | null>);
      } finally {
        applying = false;
      }
    });
    const offPopouts = bridge.onPopoutsChanged((ids) => {
      others = popout || ids.length > 0;
    });
    const offRequested = bridge.onDraftsRequested(() => {
      flush();
      bridge.relayDrafts(useDrafts.getState().drafts);
    });
    if (popout) bridge.requestDrafts();
    window.addEventListener('pagehide', flush);
    return () => {
      flush();
      offStore();
      offRelayed();
      offPopouts();
      offRequested();
      window.removeEventListener('pagehide', flush);
    };
  }, []);
}
