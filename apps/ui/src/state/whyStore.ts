import { create } from 'zustand';
import type { RequestWhy } from '@switchboard/protocol/client';

/** One request's "why", as far as it got. */
export type WhyResult = { status: 'loading' } | { status: 'done'; why: RequestWhy } | { status: 'error'; error: string };

interface WhyState {
  /** The request whose "Why is Claude asking?" panel is open, if any. */
  open: { sessionId: string; requestId: string } | null;
  /** What came back per request, for this run of the app: opening the panel again shows it at once. */
  results: ReadonlyMap<string, WhyResult>;
  /** Opens the panel for a request (asking again when it failed before), or closes it when it is already open for that one. */
  toggle(sessionId: string, requestId: string): void;
  close(): void;
  setResult(requestId: string, result: WhyResult): void;
}

/** The side panel that says why a session asks for a permission or asks a question. */
export const useWhy = create<WhyState>()((set) => ({
  open: null,
  results: new Map(),
  toggle: (sessionId, requestId) =>
    set((s) => {
      if (s.open?.requestId === requestId) return { open: null };
      // One that failed is asked again.
      if (s.results.get(requestId)?.status !== 'error') return { open: { sessionId, requestId } };
      const results = new Map(s.results);
      results.delete(requestId);
      return { open: { sessionId, requestId }, results };
    }),
  close: () => set({ open: null }),
  setResult: (requestId, result) => set((s) => ({ results: new Map(s.results).set(requestId, result) })),
}));
