import type { AutoLean, AutoTier } from '@seshboard/protocol';

/**
 * The rules Haiku follows to pick a model for a new session, in one place. Bump the version when they change,
 * so a pick can be traced to the rules it was made with.
 */
export const ROUTING_RULES_VERSION = 2;

/**
 * What each model is for. Version 2 follows Anthropic's model guide (November 2026): Haiku answers but doesn't edit
 * code, a clear spec alone isn't a reason for Sonnet, migrations and performance work go up a tier, and images go to
 * Opus or above.
 */
const TIER_RULES: Record<AutoTier, string> = {
  haiku: 'haiku: quick answers that change no code. A question about code or a tool, a short explanation, a lookup, finding a file, reading a log.',
  sonnet: 'sonnet: well-scoped coding. A bug in one place, a small feature built against a clear spec, a test, a component, a script, a setting and the code that reads it, a rename or a one-line fix.',
  opus: 'opus: everyday engineering that needs judgement. Planning or designing a feature, work across several files or pull requests, a hard bug with unclear cause, a migration, performance work, security or concurrency reasoning, anything about images or screenshots.',
  fable: 'fable: the hardest technical work. A major refactor or migration across a whole codebase, an architecture change, deep research or quantitative analysis, a long run with no one watching, leading many subagents.',
};

/** Without Opus, images still need a strong model. */
const IMAGES_WITHOUT_OPUS = 'A request about images or screenshots needs the strongest allowed model.';

/** On a close call. Balanced falls back to Opus when it can't tell, as the model guide advises. */
const leanRule = (lean: AutoLean, allowed: readonly AutoTier[]): string =>
  lean === 'cheaper'
    ? 'When two models both fit, pick the cheaper one.'
    : lean === 'stronger'
      ? 'When two models both fit, pick the stronger one.'
      : `When two models both fit, pick the one that matches the most likely size of the work.${allowed.includes('opus') ? ' If you cannot tell, pick opus.' : ''}`;

const EFFORT_RULES = [
  'Effort is how long the model thinks and checks its work. Pick one:',
  '- low: a quick answer or a chat reply someone waits on.',
  '- medium: most work. Pick medium when unsure.',
  '- high: hard reasoning, a bug with unclear cause, work that must be checked carefully.',
];

/**
 * The system prompt of the routing call: only the allowed models, the lean, the efforts and the strict JSON to answer
 * with. The prompt it reads is the user's text alone, never files, memory, CLAUDE.md or the project's name.
 */
export function routingSystemPrompt(allowed: readonly AutoTier[], lean: AutoLean): string {
  const models = allowed.join('|');
  return [
    'You pick which Claude model, and how much effort, should handle a coding request. You never answer the request itself.',
    'You only see the text of the first message of a new session. Judge how big and how hard the work is.',
    '',
    'Models:',
    ...allowed.map((tier) => `- ${TIER_RULES[tier]}`),
    ...(allowed.includes('opus') ? [] : [IMAGES_WITHOUT_OPUS]),
    '',
    leanRule(lean, allowed),
    '',
    ...EFFORT_RULES,
    '',
    `Answer with strict JSON and nothing else: {"model":"${models}","effort":"low|medium|high","reason":"<one short sentence>"}`,
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
