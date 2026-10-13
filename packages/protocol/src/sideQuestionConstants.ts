/** Side questions kept per session; asking one more drops the oldest. */
export const SIDE_QUESTIONS_KEPT = 50;

/** Earlier side questions Claude gets with a new one, as the terminal's `/btw` sends (its last 20). */
export const SIDE_QUESTION_HISTORY = 20;

/** The longest side question, in characters. */
export const MAX_SIDE_QUESTION_LENGTH = 20_000;

/**
 * The first Claude Code that shows earlier side questions for `/btw` without a question (before it, `/btw` needs
 * one). Switchboard follows it: on an older Claude Code, a bare `/btw` asks for a question.
 */
export const SIDE_QUESTION_BROWSE_VERSION = '2.1.212';
