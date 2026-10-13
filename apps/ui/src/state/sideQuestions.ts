import type { SideQuestion, SideQuestionEvent, SideQuestionList } from '@switchboard/protocol/client';

/*
 * Side questions (/btw) of one session, as the panel shows them: the ones the engine keeps, plus the ones asked in
 * this window that are still answering or failed (the engine keeps only answered ones). Pure, so it can be tested.
 */

export type SideStatus = 'answering' | 'done' | 'error';

export interface SideItem extends SideQuestion {
  status: SideStatus;
  error?: string;
  /** Asked in this window: closing its panel while it answers leaves a chip to bring it back. */
  mine?: boolean;
}

/** What the panel shows: a side question, how to ask one (none yet), or that this Claude Code needs a question. */
export type SideView = { kind: 'item'; id: string } | { kind: 'usage' } | { kind: 'needs-question' };

export interface SessionSide {
  items: SideItem[];
  /** The engine's list has been read. */
  loaded: boolean;
  /** This Claude Code can't show earlier side questions. */
  unsupported: boolean;
  /** The panel is on screen. */
  open: boolean;
  view: SideView | null;
  /** A long answer shown in full (Show all). */
  expanded: boolean;
  /** The side question the chip above the message box brings back, after its panel was closed. */
  chip: string | null;
}

export const EMPTY_SIDE: SessionSide = { items: [], loaded: false, unsupported: false, open: false, view: null, expanded: false, chip: null };

const byTime = (a: SideItem, b: SideItem) => a.at - b.at;

/** The engine's list, with what this window still has of its own (answering, failed, or answered after the list was read). */
export function withList(state: SessionSide, list: SideQuestionList): SessionSide {
  const stored = new Set(list.items.map((item) => item.id));
  const local = state.items.filter((item) => !stored.has(item.id) && (item.status !== 'done' || item.mine));
  const mine = new Set(state.items.filter((item) => item.mine).map((item) => item.id));
  const items = [...list.items.map((item): SideItem => ({ ...item, status: 'done', ...(mine.has(item.id) ? { mine: true } : {}) })), ...local].sort(byTime);
  return { ...state, items, loaded: true, unsupported: list.unsupported, view: keepView(state.view, items) };
}

/** A side question just asked here: the panel opens on it while it answers. */
export function withAsked(state: SessionSide, asked: { id: string; at: number; question: string }): SessionSide {
  const item: SideItem = { id: asked.id, question: asked.question, answer: '', at: asked.at, status: 'answering', mine: true };
  return { ...state, items: [...state.items.filter((i) => i.id !== asked.id), item].sort(byTime), open: true, view: { kind: 'item', id: asked.id }, expanded: false, chip: null };
}

/** An answer coming in, or its end. Events for side questions this window doesn't have are left out. */
export function withEvent(state: SessionSide, event: SideQuestionEvent): SessionSide {
  const at = state.items.findIndex((item) => item.id === event.id);
  if (at < 0) return state;
  const item = state.items[at]!;
  const next: SideItem = event.done
    ? event.error
      ? { ...item, status: 'error', error: event.error }
      : { ...item, status: 'done' }
    : { ...item, answer: item.answer + (event.delta ?? '') };
  const items = [...state.items];
  items[at] = next;
  return { ...state, items };
}

/** A failed side question goes, to be asked again. */
export function withoutItem(state: SessionSide, id: string): SessionSide {
  const items = state.items.filter((item) => item.id !== id);
  return { ...state, items, view: keepView(state.view, items), chip: state.chip === id ? null : state.chip };
}

/**
 * `/btw` without a question: the latest side question, else how to ask one; on a Claude Code that can't show
 * earlier ones, that it needs a question.
 */
export function openedLatest(state: SessionSide): SessionSide {
  const latest = state.items.at(-1);
  const view: SideView = state.unsupported ? { kind: 'needs-question' } : latest ? { kind: 'item', id: latest.id } : { kind: 'usage' };
  return { ...state, open: true, view, expanded: false, chip: null };
}

/** Opens the panel on one side question (the chip). */
export function openedItem(state: SessionSide, id: string): SessionSide {
  if (!state.items.some((item) => item.id === id)) return openedLatest(state);
  return { ...state, open: true, view: { kind: 'item', id }, expanded: false, chip: null };
}

/**
 * Hides the panel. A side question asked here that is still answering keeps answering, and the chip brings it back
 * (it says when the answer is ready); an answer you have read leaves no chip.
 */
export function closed(state: SessionSide): SessionSide {
  const item = current(state);
  return { ...state, open: false, expanded: false, chip: item?.mine && item.status === 'answering' ? item.id : null };
}

/** Moves to the side question before (`-1`) or after (`1`) the one shown. */
export function moved(state: SessionSide, step: -1 | 1): SessionSide {
  const { index, count } = position(state);
  const next = index + step;
  if (index < 0 || next < 0 || next >= count) return state;
  return { ...state, view: { kind: 'item', id: state.items[next]!.id }, expanded: false };
}

/** The side question on screen, if the panel shows one. */
export function current(state: SessionSide): SideItem | null {
  const view = state.view;
  if (view?.kind !== 'item') return null;
  return state.items.find((item) => item.id === view.id) ?? null;
}

/** Where the side question on screen is: `index` from 0 (oldest), -1 when none is shown. */
export function position(state: SessionSide): { index: number; count: number } {
  const item = current(state);
  return { index: item ? state.items.indexOf(item) : -1, count: state.items.length };
}

/** What the chip above the message box says before the question. */
export function chipLabel(item: SideItem): string {
  return item.status === 'answering' ? 'Answering' : item.status === 'error' ? 'Side question failed' : 'Side answer ready';
}

/** Side questions to count for the palette's Show side questions: those the panel can browse. */
export function browsable(state: SessionSide): number {
  return state.unsupported ? 0 : state.items.length;
}

function keepView(view: SideView | null, items: SideItem[]): SideView | null {
  if (view?.kind !== 'item' || items.some((item) => item.id === view.id)) return view;
  const latest = items.at(-1);
  return latest ? { kind: 'item', id: latest.id } : { kind: 'usage' };
}
