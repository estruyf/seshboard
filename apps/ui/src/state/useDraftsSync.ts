import { useEffect } from 'react';
import type { EngineClient } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { parseDrafts, parseFirstPrompts, serializeDrafts } from './drafts.ts';
import { useDrafts } from './draftsStore.ts';
import { useHosts } from './hostsStore.ts';
import { useSessions } from './sessionsStore.ts';

/** Where unsent messages are kept between launches, next to the sidebar's width and sections. */
const DRAFTS_KEY = 'ui.drafts';
const SAVE_DELAY_MS = 400;

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

/** Restores unsent messages (their text, not images) and saves them, a moment after each change and when the window goes. */
export function useDraftsSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;

  useEffect(() => {
    if (!client) return;
    void loadDrafts(client);
    let saved = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      clearTimeout(timer);
      const { drafts, firstPrompts, loaded } = useDrafts.getState();
      // Until the saved ones are read, writing would wipe them.
      if (!loaded) return;
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
