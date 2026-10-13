import { useEffect } from 'react';
import { create } from 'zustand';
import type { SideQuestionEvent } from '@switchboard/protocol/client';
import type { EngineClient as Client } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { closed, EMPTY_SIDE, moved, openedItem, openedLatest, withAsked, withEvent, withList, withoutItem, type SessionSide } from './sideQuestions.ts';

/**
 * Side questions (/btw) per session: the panel above the message box, its chip, and the answers coming in. Nothing
 * here touches the conversation, Up next or the session's status.
 */
interface SideQuestionsState {
  sessions: ReadonlyMap<string, SessionSide>;
  /** Answers that came in before the window knew the side question's id (the ask's reply was still on its way). */
  early: ReadonlyMap<string, SideQuestionEvent[]>;
  update(sessionId: string, change: (state: SessionSide) => SessionSide): void;
  /** An answer coming in, from any window. */
  receive(event: SideQuestionEvent): void;
}

export const useSideQuestions = create<SideQuestionsState>()((set) => ({
  sessions: new Map(),
  early: new Map(),
  update: (sessionId, change) =>
    set((s) => {
      const sessions = new Map(s.sessions);
      sessions.set(sessionId, change(s.sessions.get(sessionId) ?? EMPTY_SIDE));
      return { sessions };
    }),
  receive: (event) =>
    set((s) => {
      const state = s.sessions.get(event.sessionId);
      if (state?.items.some((item) => item.id === event.id)) {
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

/** One session's side questions, as the panel shows them. */
export function useSessionSide(sessionId: string): SessionSide {
  return useSideQuestions((s) => s.sessions.get(sessionId)) ?? EMPTY_SIDE;
}

const update = (sessionId: string, change: (state: SessionSide) => SessionSide) => useSideQuestions.getState().update(sessionId, change);

/** Reads the side questions the engine keeps for a session. */
export async function loadSideQuestions(client: Client, sessionId: string): Promise<void> {
  const list = await client.call('session.btwList', { sessionId });
  update(sessionId, (state) => withList(state, list));
}

/** Asks a side question; the panel opens on it and the answer comes in there. */
export async function askSideQuestion(client: Client, sessionId: string, question: string): Promise<void> {
  const { id, at } = await client.call('session.btw', { sessionId, question });
  const early = useSideQuestions.getState().early.get(id) ?? [];
  update(sessionId, (state) => early.reduce(withEvent, withAsked(state, { id, at, question })));
  if (early.length) {
    useSideQuestions.setState((s) => {
      const left = new Map(s.early);
      left.delete(id);
      return { early: left };
    });
  }
}

/** Asks a failed side question again, in its place. */
export function retrySideQuestion(client: Client, sessionId: string, id: string, question: string): Promise<void> {
  update(sessionId, (state) => withoutItem(state, id));
  return askSideQuestion(client, sessionId, question);
}

/** `/btw` without a question: the latest side question (read first when the window hasn't yet). */
export async function openLatestSideQuestion(client: Client | null, sessionId: string): Promise<void> {
  const state = useSideQuestions.getState().sessions.get(sessionId);
  if (client && !state?.loaded) await loadSideQuestions(client, sessionId).catch(() => {});
  update(sessionId, openedLatest);
}

export const openSideQuestion = (sessionId: string, id: string) => update(sessionId, (state) => openedItem(state, id));
export const closeSideQuestion = (sessionId: string) => update(sessionId, closed);
export const moveSideQuestion = (sessionId: string, step: -1 | 1) => update(sessionId, (state) => moved(state, step));
export const expandSideQuestion = (sessionId: string) => update(sessionId, (state) => ({ ...state, expanded: true }));
/** A message was sent: the chip for an earlier side answer goes. */
export const dropSideChip = (sessionId: string) => {
  if (useSideQuestions.getState().sessions.get(sessionId)?.chip) update(sessionId, (state) => ({ ...state, chip: null }));
};

/** Follows side answers from the engine, in every window. */
export function useSideQuestionsSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    return client.on('session.btw', (event) => {
      useSideQuestions.getState().receive(event);
      // Asked in another window: once it is kept, this window's list picks it up.
      const state = useSideQuestions.getState().sessions.get(event.sessionId);
      if (event.done && !event.error && state?.loaded && !state.items.some((item) => item.id === event.id)) void loadSideQuestions(client, event.sessionId).catch(() => {});
    });
  }, [client]);
}
