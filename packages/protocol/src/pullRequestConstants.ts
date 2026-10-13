/**
 * The longest pull request description GitHub takes, in characters. Kept free of zod for the renderer, whose
 * Create pull request dialog counts towards it.
 */
export const PR_BODY_LIMIT = 65_536;
