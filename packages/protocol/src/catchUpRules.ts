/**
 * Catch-up rules both sides need, in plain TypeScript (no zod): the engine works the review time out with them, and
 * the sidebar and the card read it the same way.
 */

/** The fewest and most minutes a catch-up says a review takes. */
export const REVIEW_MINUTES = { min: 1, max: 30 } as const;

export interface ReviewInput {
  /** Waiting on a permission or a question: one quick decision. */
  waiting: boolean;
  diff: { files: number; add: number; del: number } | null;
  testsFailed: boolean;
  outOfScope: number;
}

/**
 * About how long looking over a turn takes, in whole minutes (1–30). A permission or a question is one minute; otherwise
 * half a minute to read the card, a minute per 150 changed lines, a quarter per file, two more when tests fail and one
 * per file outside the plan.
 */
export function reviewMinutes(input: ReviewInput): number {
  if (input.waiting) return REVIEW_MINUTES.min;
  const diff = input.diff ?? { files: 0, add: 0, del: 0 };
  const raw = 0.5 + (diff.add + diff.del) / 150 + diff.files * 0.25 + (input.testsFailed ? 2 : 0) + input.outOfScope;
  return Math.min(REVIEW_MINUTES.max, Math.max(REVIEW_MINUTES.min, Math.round(raw)));
}
