import { threadTitle, type AskEvent, type AskItem, type AskThreadList } from '@switchboard/protocol/client';

/*
 * Ask about this session, for one session, as the panel shows it: the threads the engine keeps plus what this window
 * asked that is still answering, which thread is on screen, whether the panel is open, and the dot on the Ask
 * button. Pure, so it can be tested.
 */

export type AskStatus = 'answering' | 'done' | 'error';

export interface AskEntry extends AskItem {
  status: AskStatus;
}

export interface AskThreadView {
  id: string;
  title: string;
  createdAt: number;
  /** Oldest first. */
  items: AskEntry[];
}

export interface SessionAsk {
  /** Newest first. */
  threads: AskThreadView[];
  /** The engine's list has been read. */
  loaded: boolean;
  /** The panel is open (it may sit behind the Changes tab). */
  open: boolean;
  /** The thread on screen: undefined for the latest one, null for a new one (empty until its first question). */
  threadId: string | null | undefined;
  /** An answer finished while the panel was closed: the dot on the Ask button, until the panel opens. */
  ready: boolean;
}

export const EMPTY_ASK: SessionAsk = { threads: [], loaded: false, open: false, threadId: undefined, ready: false };

const entryOf = (item: AskItem): AskEntry => ({ ...item, status: item.error ? 'error' : 'done' });
const byTime = (a: { at: number }, b: { at: number }) => a.at - b.at;
const newestFirst = (a: AskThreadView, b: AskThreadView) => b.createdAt - a.createdAt;

/** The engine's threads, with what this window still has that the engine doesn't keep yet (answers on their way). */
export function withThreads(state: SessionAsk, list: AskThreadList): SessionAsk {
  const threads = list.threads.map((thread): AskThreadView => {
    const kept = new Set(thread.items.map((item) => item.id));
    const local = state.threads.find((t) => t.id === thread.id)?.items.filter((item) => !kept.has(item.id) && item.status === 'answering') ?? [];
    return { id: thread.id, title: thread.title, createdAt: thread.createdAt, items: [...thread.items.map(entryOf), ...local].sort(byTime) };
  });
  // A thread asked here whose first answer is still coming may not be in the list yet.
  const listed = new Set(threads.map((t) => t.id));
  const pending = state.threads.filter((t) => !listed.has(t.id) && t.items.some((item) => item.status === 'answering'));
  const all = [...threads, ...pending].sort(newestFirst);
  // A thread that is gone (dropped as the oldest) leaves the latest on screen.
  const threadId = state.threadId && !all.some((t) => t.id === state.threadId) ? undefined : state.threadId;
  return { ...state, threads: all, loaded: true, threadId };
}

/** A question just asked here: it answers in its thread (a new one when the engine started one), which comes on screen. */
export function withAsked(state: SessionAsk, asked: { threadId: string; id: string; at: number; question: string }): SessionAsk {
  const item: AskEntry = { id: asked.id, question: asked.question, answer: '', at: asked.at, status: 'answering' };
  const existing = state.threads.find((t) => t.id === asked.threadId);
  const thread: AskThreadView = existing
    ? { ...existing, items: [...existing.items.filter((i) => i.id !== asked.id), item].sort(byTime) }
    : { id: asked.threadId, title: threadTitle(asked.question), createdAt: asked.at, items: [item] };
  const threads = [thread, ...state.threads.filter((t) => t.id !== asked.threadId)].sort(newestFirst);
  return { ...state, threads, threadId: asked.threadId };
}

/** An answer coming in, or its end. When it ends while the panel is closed, the Ask button gets its dot. */
export function withEvent(state: SessionAsk, event: AskEvent): SessionAsk {
  let found = false;
  const threads = state.threads.map((thread) => {
    if (thread.id !== event.threadId) return thread;
    const items = thread.items.map((item) => {
      if (item.id !== event.id) return item;
      found = true;
      if (event.done) return event.error ? { ...item, answer: '', status: 'error' as const, error: event.error } : { ...item, answer: event.answer ?? item.answer, status: 'done' as const };
      if (event.reset) return { ...item, answer: '' };
      return { ...item, answer: item.answer + (event.delta ?? '') };
    });
    return { ...thread, items };
  });
  if (!found) return state;
  return { ...state, threads, ready: state.ready || (!!event.done && !state.open) };
}

/** A failed question that is asked again goes from its thread; the new one takes its place at the end. */
export function withoutItem(state: SessionAsk, threadId: string, id: string): SessionAsk {
  return { ...state, threads: state.threads.map((t) => (t.id === threadId ? { ...t, items: t.items.filter((i) => i.id !== id) } : t)) };
}

/** Opens the panel; the dot goes. The thread on screen stays (the latest one the first time). */
export function opened(state: SessionAsk): SessionAsk {
  return { ...state, open: true, ready: false };
}

/** Closes the panel. Answers still coming keep coming, and the dot shows when they are done. */
export function closed(state: SessionAsk): SessionAsk {
  return { ...state, open: false };
}

/** New thread: an empty one on screen; the others stay in Earlier threads. */
export function newThread(state: SessionAsk): SessionAsk {
  return { ...state, threadId: null };
}

/** Earlier threads: one of them on screen. */
export function pickedThread(state: SessionAsk, threadId: string): SessionAsk {
  return state.threads.some((t) => t.id === threadId) ? { ...state, threadId } : state;
}

/** The thread on screen, or null for a new one (and before the first question). */
export function currentThread(state: SessionAsk): AskThreadView | null {
  if (state.threadId === undefined) return state.threads[0] ?? null;
  return state.threadId ? (state.threads.find((t) => t.id === state.threadId) ?? null) : null;
}

/** How many questions the thread on screen has: the count on the Ask tab. */
export function itemCount(state: SessionAsk): number {
  return currentThread(state)?.items.length ?? 0;
}

/** Something is still answering in this session. */
export function answering(state: SessionAsk): boolean {
  return state.threads.some((t) => t.items.some((i) => i.status === 'answering'));
}

/** ↑ in an empty field: the last question of the thread on screen, to edit. */
export function lastQuestion(state: SessionAsk): string | null {
  return currentThread(state)?.items.at(-1)?.question ?? null;
}

/** "Earlier threads" rows: the newest first, with how many questions each has. */
export function threadRows(state: SessionAsk): Array<{ id: string; title: string; count: number; createdAt: number; current: boolean }> {
  return state.threads.filter((t) => t.items.length > 0).map((t) => ({ id: t.id, title: t.title, count: t.items.length, createdAt: t.createdAt, current: t.id === currentThread(state)?.id }));
}
