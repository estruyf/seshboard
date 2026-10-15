/** Threads kept per session; starting one more drops the oldest. */
export const ASK_THREADS_KEPT = 20;

/** The longest question, in characters. */
export const MAX_SIDE_QUESTION_LENGTH = 20_000;

/** How much of the first question a thread's title keeps, in characters. */
export const ASK_TITLE_LENGTH = 80;

/** A thread's title: its first question on one line, shortened. */
export function threadTitle(question: string): string {
  const line = question.replace(/\s+/g, ' ').trim();
  return line.length > ASK_TITLE_LENGTH ? `${line.slice(0, ASK_TITLE_LENGTH - 1)}…` : line;
}
