import { useEffect, useSyncExternalStore } from 'react';
import type { AskEvent } from '@seshboard/protocol/remote-client';
import { closed, currentThread, EMPTY_ASK, opened, withAsked, withEvent, withoutItem, withThreads, type SessionAsk } from '../lib/ask.ts';
import type { Client } from './Connected.tsx';

/*
 * Ask about this session, per session, for this tab: the threads, which one is on screen, whether the sheet or panel
 * is open, and the answers coming in. Kept outside the session view, so an answer still coming lands when you go back
 * to its session. Nothing here touches the conversation, Up next or the session's status.
 */

let sessions: ReadonlyMap<string, SessionAsk> = new Map();
/** Answers that came in before this tab knew the question's id (the ask's reply was still on its way). */
let early: ReadonlyMap<string, AskEvent[]> = new Map();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function updateAsk(sessionId: string, change: (state: SessionAsk) => SessionAsk): void {
  sessions = new Map(sessions).set(sessionId, change(sessions.get(sessionId) ?? EMPTY_ASK));
  for (const listener of listeners) listener();
}

/** One session's Ask, as the sheet or panel shows it. */
export function useSessionAsk(sessionId: string): SessionAsk {
  return useSyncExternalStore(subscribe, () => sessions.get(sessionId) ?? EMPTY_ASK);
}

/** Reads the threads the computer keeps for a session. */
export async function loadAskThreads(client: Client, sessionId: string): Promise<void> {
  if (!client) return;
  const list = await client.call('session.askThreads', { sessionId });
  updateAsk(sessionId, (state) => withThreads(state, list));
}

/** Asks in the thread on screen (a new thread when none is, or `threadId`); the answer comes in there. `replaces` is a failed question asked again. */
export async function askAbout(client: Client, sessionId: string, question: string, options: { threadId?: string; replaces?: string } = {}): Promise<void> {
  if (!client) throw new Error('Not connected to your computer.');
  const threadId = options.threadId ?? currentThread(sessions.get(sessionId) ?? EMPTY_ASK)?.id;
  const asked = await client.call('session.ask', { sessionId, question, ...(threadId ? { threadId } : {}), ...(options.replaces ? { replaces: options.replaces } : {}) });
  const waiting = early.get(asked.id) ?? [];
  if (waiting.length) {
    const left = new Map(early);
    left.delete(asked.id);
    early = left;
  }
  updateAsk(sessionId, (state) => waiting.reduce(withEvent, withAsked(state, { ...asked, question })));
}

/** Try again: the failed question goes, and is asked again at the end of its thread. */
export function retryAsk(client: Client, sessionId: string, threadId: string, id: string, question: string): Promise<void> {
  updateAsk(sessionId, (state) => withoutItem(state, threadId, id));
  return askAbout(client, sessionId, question, { threadId, replaces: id });
}

/** Opens the sheet or panel, reading the threads the first time. */
export function openAsk(client: Client, sessionId: string): void {
  updateAsk(sessionId, opened);
  if (!sessions.get(sessionId)?.loaded) void loadAskThreads(client, sessionId).catch(() => {});
}

export const closeAsk = (sessionId: string) => updateAsk(sessionId, closed);

/** An answer coming in. One this tab didn't ask (yet) waits for the ask's reply; another device's is dropped when it ends. */
function receive(event: AskEvent): boolean {
  const state = sessions.get(event.sessionId);
  if (state?.threads.some((t) => t.items.some((item) => item.id === event.id))) {
    updateAsk(event.sessionId, (s) => withEvent(s, event));
    return true;
  }
  const next = new Map(early);
  if (event.done) next.delete(event.id);
  else next.set(event.id, [...(next.get(event.id) ?? []), event]);
  early = next;
  return false;
}

/**
 * Follows answers from the computer. A question asked on the computer (or another phone) shows once it is kept; after a
 * reconnect, every session read before is read again, for answers that ended meanwhile.
 */
export function useAskSync(client: Client): void {
  useEffect(() => {
    if (!client) return;
    for (const [sessionId, state] of sessions) if (state.loaded) void loadAskThreads(client, sessionId).catch(() => {});
    return client.on('session.ask', (event) => {
      if (!receive(event) && event.done && sessions.get(event.sessionId)?.loaded) void loadAskThreads(client, event.sessionId).catch(() => {});
    });
  }, [client]);
}
