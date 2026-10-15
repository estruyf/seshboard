import { useEffect } from 'react';
import { create } from 'zustand';
import type { AskEvent } from '@switchboard/protocol/client';
import type { EngineClient as Client } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useRightPanel } from './rightPanelStore.ts';
import { closed, currentThread, EMPTY_ASK, newThread, opened, pickedThread, withAsked, withEvent, withoutItem, withThreads, type SessionAsk } from './ask.ts';

/**
 * Ask about this session, per session: the panel's threads, which one is on screen, whether it is open, and the
 * answers coming in. Nothing here touches the conversation, Up next or the session's status.
 */
interface AskState {
  sessions: ReadonlyMap<string, SessionAsk>;
  /** Answers that came in before the window knew the question's id (the ask's reply was still on its way). */
  early: ReadonlyMap<string, AskEvent[]>;
  /** Bumped to put the focus in a session's panel field (the Ask button with an empty box, the palette). */
  focus: { sessionId: string; nonce: number } | null;
  update(sessionId: string, change: (state: SessionAsk) => SessionAsk): void;
  /** An answer coming in, from any window. */
  receive(event: AskEvent): void;
}

export const useAsk = create<AskState>()((set) => ({
  sessions: new Map(),
  early: new Map(),
  focus: null,
  update: (sessionId, change) =>
    set((s) => {
      const sessions = new Map(s.sessions);
      sessions.set(sessionId, change(s.sessions.get(sessionId) ?? EMPTY_ASK));
      return { sessions };
    }),
  receive: (event) =>
    set((s) => {
      const state = s.sessions.get(event.sessionId);
      if (state?.threads.some((t) => t.items.some((item) => item.id === event.id))) {
        const sessions = new Map(s.sessions);
        sessions.set(event.sessionId, withEvent(state, event));
        return { sessions };
      }
      // Not this window's (yet): hold it until the ask's reply names it; another window's is dropped when it ends.
      const early = new Map(s.early);
      if (event.done) early.delete(event.id);
      else early.set(event.id, [...(early.get(event.id) ?? []), event]);
      return { early };
    }),
}));

/** One session's Ask panel, as it shows it. */
export function useSessionAsk(sessionId: string): SessionAsk {
  return useAsk((s) => s.sessions.get(sessionId)) ?? EMPTY_ASK;
}

const update = (sessionId: string, change: (state: SessionAsk) => SessionAsk) => useAsk.getState().update(sessionId, change);

/** Reads the threads the engine keeps for a session. */
export async function loadAskThreads(client: Client, sessionId: string): Promise<void> {
  const list = await client.call('session.askThreads', { sessionId });
  update(sessionId, (state) => withThreads(state, list));
}

/**
 * Asks a question in the thread on screen (a new thread when none is, or `threadId`), and opens the panel; the
 * answer comes in there. `replaces` is a failed question asked again.
 */
export async function askAbout(client: Client, sessionId: string, question: string, options: { threadId?: string; replaces?: string } = {}): Promise<void> {
  const state = useAsk.getState().sessions.get(sessionId) ?? EMPTY_ASK;
  const threadId = options.threadId ?? currentThread(state)?.id;
  const asked = await client.call('session.ask', { sessionId, question, ...(threadId ? { threadId } : {}), ...(options.replaces ? { replaces: options.replaces } : {}) });
  const early = useAsk.getState().early.get(asked.id) ?? [];
  update(sessionId, (s) => early.reduce(withEvent, opened(withAsked(s, { ...asked, question }))));
  useRightPanel.getState().setTab('ask');
  if (early.length) {
    useAsk.setState((s) => {
      const left = new Map(s.early);
      left.delete(asked.id);
      return { early: left };
    });
  }
}

/** Try again: the failed question goes, and is asked again at the end of its thread. */
export function retryAsk(client: Client, sessionId: string, threadId: string, id: string, question: string): Promise<void> {
  update(sessionId, (state) => withoutItem(state, threadId, id));
  return askAbout(client, sessionId, question, { threadId, replaces: id });
}

/** Opens the panel (read first when the window hasn't yet); `focus` puts the caret in its field. */
export async function openAsk(client: Client | null, sessionId: string, focus = true): Promise<void> {
  update(sessionId, opened);
  // With Changes open too, Ask comes to the front.
  useRightPanel.getState().setTab('ask');
  if (focus) focusAsk(sessionId);
  const state = useAsk.getState().sessions.get(sessionId);
  if (client && !state?.loaded) await loadAskThreads(client, sessionId).catch(() => {});
}

export const focusAsk = (sessionId: string) => useAsk.setState((s) => ({ focus: { sessionId, nonce: (s.focus?.nonce ?? 0) + 1 } }));
export const closeAsk = (sessionId: string) => update(sessionId, closed);
/** Whether a session's Ask panel is open (Toggle changes asks, from outside the session view). */
export const isAskOpen = (sessionId: string | null) => !!sessionId && !!useAsk.getState().sessions.get(sessionId)?.open;
export const newAskThread = (sessionId: string) => {
  update(sessionId, newThread);
  focusAsk(sessionId);
};
export const pickAskThread = (sessionId: string, threadId: string) => update(sessionId, (state) => pickedThread(state, threadId));

/** Follows answers from the engine, in every window. */
export function useAskSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    return client.on('session.ask', (event) => {
      useAsk.getState().receive(event);
      // Asked in another window: once it is kept, this window's list picks it up.
      const state = useAsk.getState().sessions.get(event.sessionId);
      if (event.done && state?.loaded && !state.threads.some((t) => t.items.some((item) => item.id === event.id))) void loadAskThreads(client, event.sessionId).catch(() => {});
    });
  }, [client]);
}
