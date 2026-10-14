import { create } from 'zustand';
import type { CatchUp } from '@switchboard/protocol/client';
import type { QuickInfo } from './sidebarRows.ts';

/** Each session's review time and whether its tests fail, for the Quickest to unblock order. */
export function quickInfoOf(cards: ReadonlyMap<string, CatchUp>): Map<string, QuickInfo> {
  return new Map([...cards].map(([id, card]) => [id, { reviewMinutes: card.reviewMinutes, testsFailed: card.signals.tests.state === 'failed' }]));
}

/** One turn of one session: what collapsing, Details and Committed belong to. */
export const turnKey = (card: Pick<CatchUp, 'sessionId' | 'turnId'>) => `${card.sessionId}\0${card.turnId}`;

interface CatchUpState {
  /** Each session's catch-up, as the engine keeps it. */
  cards: Map<string, CatchUp>;
  /** Turns whose card you folded into the strip (true) or opened from it (false), for this run of the app only. */
  collapsed: ReadonlyMap<string, boolean>;
  /** Turns whose banner shows Details. */
  details: ReadonlySet<string>;
  /** Turns you committed from the card: it says Committed and offers Archive. */
  committed: ReadonlySet<string>;
  /** The session whose message box Reply put you in, until you send, leave it or press Esc. */
  replying: string | null;
  reset(cards: readonly CatchUp[]): void;
  set(sessionId: string, card: CatchUp | null): void;
  setCollapsed(card: CatchUp, collapsed: boolean): void;
  setDetails(card: CatchUp, open: boolean): void;
  markCommitted(card: CatchUp): void;
  setReplying(sessionId: string | null): void;
}

const withKey = (set: ReadonlySet<string>, key: string, on: boolean) => {
  if (set.has(key) === on) return set;
  const next = new Set(set);
  if (on) next.add(key);
  else next.delete(key);
  return next;
};

/** The catch-up cards and what you did with them; the cards come from the engine (`useCatchUpSync`). */
export const useCatchUp = create<CatchUpState>()((set) => ({
  cards: new Map(),
  collapsed: new Map(),
  details: new Set(),
  committed: new Set(),
  replying: null,
  reset: (cards) => set({ cards: new Map(cards.map((card) => [card.sessionId, card])) }),
  set: (sessionId, card) =>
    set((state) => {
      const cards = new Map(state.cards);
      if (card) cards.set(sessionId, card);
      else cards.delete(sessionId);
      return { cards };
    }),
  // Folding the banner closes its Details too: it opens again as it first showed.
  setCollapsed: (card, collapsed) =>
    set((state) => ({ collapsed: new Map(state.collapsed).set(turnKey(card), collapsed), details: collapsed ? withKey(state.details, turnKey(card), false) : state.details })),
  setDetails: (card, open) => set((state) => ({ details: withKey(state.details, turnKey(card), open) })),
  markCommitted: (card) => set((state) => ({ committed: withKey(state.committed, turnKey(card), true) })),
  setReplying: (replying) => set({ replying }),
}));
