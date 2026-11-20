import { create } from 'zustand';
import { useHosts } from './hostsStore.ts';

/** What you picked and typed on a question card before sending it. */
export interface QuestionDraft {
  /** Picked options, per question text. */
  answers: Record<string, string[]>;
  /** Your own answer, per question text. */
  other: Record<string, string>;
  /** The question the number keys answer. */
  step: number;
}

export const EMPTY_QUESTION_DRAFT: QuestionDraft = { answers: {}, other: {}, step: 0 };

interface PermissionDraftsState {
  /**
   * Per request id, so a card you leave for another session shows what you entered when you come back.
   * A request has a question draft or feedback, never both.
   */
  questions: ReadonlyMap<string, QuestionDraft>;
  /** What you typed for Claude on a permission or plan card. */
  feedback: ReadonlyMap<string, string>;
  updateQuestion(requestId: string, change: (draft: QuestionDraft) => Partial<QuestionDraft>): void;
  setFeedback(requestId: string, text: string): void;
}

export const usePermissionDrafts = create<PermissionDraftsState>()((set) => ({
  questions: new Map(),
  feedback: new Map(),
  updateQuestion: (requestId, change) =>
    set((s) => {
      const draft = s.questions.get(requestId) ?? EMPTY_QUESTION_DRAFT;
      return { questions: new Map(s.questions).set(requestId, { ...draft, ...change(draft) }) };
    }),
  setFeedback: (requestId, text) => set((s) => ({ feedback: new Map(s.feedback).set(requestId, text) })),
}));

/** `map` without the requests that are no longer open, or `map` itself when nothing went. */
function prune<T>(map: ReadonlyMap<string, T>, open: ReadonlyMap<string, unknown>): ReadonlyMap<string, T> {
  if ([...map.keys()].every((id) => open.has(id))) return map;
  return new Map([...map].filter(([id]) => open.has(id)));
}

// A request that is answered (here, on a phone or in the terminal) or gone takes its draft with it.
useHosts.subscribe((state, prev) => {
  if (state.permissions === prev.permissions) return;
  const { questions, feedback } = usePermissionDrafts.getState();
  const next = { questions: prune(questions, state.permissions), feedback: prune(feedback, state.permissions) };
  if (next.questions !== questions || next.feedback !== feedback) usePermissionDrafts.setState(next);
});
