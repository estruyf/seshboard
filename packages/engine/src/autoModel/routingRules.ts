import type { AutoLean, AutoTier } from '@switchboard/protocol';

/**
 * The rules Haiku follows to pick a model for a new session, in one place. Bump the version when they change,
 * so a pick can be traced to the rules it was made with.
 */
export const ROUTING_RULES_VERSION = 1;

const TIER_RULES: Record<AutoTier, string> = {
  haiku: 'haiku: quick answers. A question about code or a tool, a one-line fix, renaming, a typo, formatting, a short explanation, a lookup.',
  sonnet: 'sonnet: everyday coding. A small or local change, a bug in one place, a test, a component, a script, a setting and the code that reads it.',
  opus: 'opus: complex, multi-step work. Planning or designing a feature, refactoring across many files or modules, an architecture change, a hard bug with unclear cause, a migration, security or concurrency reasoning.',
};

const LEAN_RULES: Record<AutoLean, string> = {
  cheaper: 'When two models both fit, pick the cheaper one.',
  balanced: 'When two models both fit, pick the one that matches the most likely size of the work.',
  stronger: 'When two models both fit, pick the stronger one.',
};

/**
 * The system prompt of the routing call: only the allowed models, the lean, and the strict JSON to answer with.
 * The prompt it reads is the user's text alone, never files, memory, CLAUDE.md or the project's name.
 */
export function routingSystemPrompt(allowed: readonly AutoTier[], lean: AutoLean): string {
  const models = allowed.join('|');
  return [
    'You pick which Claude model should handle a coding request. You never answer the request itself.',
    'You only see the text of the first message of a new session. Judge how big and how hard the work is.',
    '',
    'Models:',
    ...allowed.map((tier) => `- ${TIER_RULES[tier]}`),
    '',
    LEAN_RULES[lean],
    '',
    `Answer with strict JSON and nothing else: {"model":"${models}","reason":"<one short sentence>"}`,
    'The reason is plain and short, at most 12 words, and says what kind of work it is ("A small, local change: one setting and the code that reads it.").',
  ].join('\n');
}

/** The most of a prompt the routing call reads: enough to tell the kind of work, while a long paste stays cheap to route. */
export const ROUTING_PROMPT_MAX = 20_000;

/** The message the routing call sends: the user's text (its start, when it is long), and notes about what it can't see. */
export function routingUserMessage(prompt: string, imageCount: number): string {
  const cut = prompt.length - ROUTING_PROMPT_MAX;
  const notes = [
    cut > 0 ? `[The message goes on for ${cut.toLocaleString('en-US')} more characters, not shown here.]` : '',
    imageCount > 0 ? `[The message also has ${imageCount} attached image${imageCount === 1 ? '' : 's'}, not shown here.]` : '',
  ].filter(Boolean);
  const text = cut > 0 ? prompt.slice(0, ROUTING_PROMPT_MAX) : prompt;
  return `<request>\n${text}\n</request>${notes.map((note) => `\n\n${note}`).join('')}`;
}
