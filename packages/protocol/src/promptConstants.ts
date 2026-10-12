/**
 * The longest message, in characters, that can be sent or queued (what you typed with its context and pasted text).
 * Kept free of zod for the renderer, which checks it before sending. Claude may still find a message this long too
 * big for its context window; it says so in the session.
 */
export const MAX_PROMPT_LENGTH = 1_000_000;
