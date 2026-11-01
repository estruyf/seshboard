import { useEffect } from 'react';
import { create } from 'zustand';
import type { AskEvent, AskThreadList } from '@seshboard/protocol/client';
import type { EngineClient as Client } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { agentsToggleStep } from './agentsPanel.ts';
import { frontTab, useRightPanel } from './rightPanelStore.ts';
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
  focus: { sessionId: string; nonce: number; prefill?: string } | null;
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

/**
 * Where a session's questions go: this computer's engine (`engineAsk`), or the computer a remote session runs on
 * (`RemoteSessionView`, which keys its panel by the row's id and passes that computer's answers to `receive`).
 */
export interface AskBackend {
  ask(params: { question: string; threadId?: string; replaces?: string }): Promise<{ threadId: string; id: string; at: number }>;
  threads(): Promise<AskThreadList>;
}

/** This computer's engine, for one of its sessions. */
export const engineAsk = (client: Client, sessionId: string): AskBackend => ({
  ask: (params) => client.call('session.ask', { sessionId, ...params }),
  threads: () => client.call('session.askThreads', { sessionId }),
});

/** Reads the threads the engine keeps for a session. */
export function loadAskThreads(client: Client, sessionId: string): Promise<void> {
  return loadAskThreadsFrom(engineAsk(client, sessionId), sessionId);
}

/** Reads the threads `backend` keeps, into the panel keyed `sessionId`. */
export async function loadAskThreadsFrom(backend: AskBackend, sessionId: string): Promise<void> {
  const list = await backend.threads();
  update(sessionId, (state) => withThreads(state, list));
}

/**
 * Asks a question in the thread on screen (a new thread when none is, or `threadId`), and opens the panel; the
 * answer comes in there. `replaces` is a failed question asked again.
 */
export function askAbout(client: Client, sessionId: string, question: string, options: { threadId?: string; replaces?: string } = {}): Promise<void> {
  return askThrough(engineAsk(client, sessionId), sessionId, question, options);
}

/** `askAbout` through `backend`, into the panel keyed `sessionId`. */
export async function askThrough(backend: AskBackend, sessionId: string, question: string, options: { threadId?: string; replaces?: string } = {}): Promise<void> {
  const state = useAsk.getState().sessions.get(sessionId) ?? EMPTY_ASK;
  const threadId = options.threadId ?? currentThread(state)?.id;
  const asked = await backend.ask({ question, ...(threadId ? { threadId } : {}), ...(options.replaces ? { replaces: options.replaces } : {}) });
  const early = useAsk.getState().early.get(asked.id) ?? [];
  update(sessionId, (s) => early.reduce(withEvent, opened(withAsked(s, { ...asked, question }))));
  useRightPanel.getState().setTab(sessionId, 'ask');
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
  return retryAskThrough(engineAsk(client, sessionId), sessionId, threadId, id, question);
}

/** `retryAsk` through `backend`. */
export function retryAskThrough(backend: AskBackend, sessionId: string, threadId: string, id: string, question: string): Promise<void> {
  update(sessionId, (state) => withoutItem(state, threadId, id));
  return askThrough(backend, sessionId, question, { threadId, replaces: id });
}

/** Opens the panel (read first when the window hasn't yet); `focus` puts the caret in its field. */
export function openAsk(client: Client | null, sessionId: string, focus = true, prefill?: string): Promise<void> {
  return openAskThrough(client ? engineAsk(client, sessionId) : null, sessionId, focus, prefill);
}

/** `openAsk` through `backend` (null: not connected, the threads are read later). */
export async function openAskThrough(backend: AskBackend | null, sessionId: string, focus = true, prefill?: string): Promise<void> {
  update(sessionId, opened);
  // With Changes open too, Ask comes to the front.
  useRightPanel.getState().setTab(sessionId, 'ask');
  if (focus) focusAsk(sessionId, prefill);
  const state = useAsk.getState().sessions.get(sessionId);
  if (backend && !state?.loaded) await loadAskThreadsFrom(backend, sessionId).catch(() => {});
}

/** The header's Ask button: open, bring to the front, or close, as Agents does. `othersOpen`: Changes or Agents is open too. */
export function toggleAskPanel(client: Client | null, sessionId: string, othersOpen: boolean): void {
  const step = agentsToggleStep(isAskOpen(sessionId), frontTab(sessionId) === 'ask', othersOpen);
  if (step === 'close') closeAsk(sessionId);
  else void openAsk(client, sessionId);
}

/** Puts the caret in the panel's field; `prefill` starts the field with that text (a quote), the caret at its end. */
export const focusAsk = (sessionId: string, prefill?: string) => useAsk.setState((s) => ({ focus: { sessionId, nonce: (s.focus?.nonce ?? 0) + 1, ...(prefill ? { prefill } : {}) } }));
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
