import { commandLabel } from './commandLabel.ts';
import { pathInside } from './paths.ts';

/**
 * Tool calls named the way Claude Code words them ("Run the unit tests", "Reading src/a.ts"), for the app's
 * transcript and the phone's. Plain TypeScript, so both can use it.
 */

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

const relative = (path: string, cwd: string | null): string => (cwd && pathInside(path, cwd)) || path;

/** `mcp__claude_ai_Notion__notion-search` → `Notion · notion-search`. */
export function mcpLabel(name: string): string | null {
  const match = /^mcp__(.+?)__(.+)$/.exec(name);
  if (!match) return null;
  const server = match[1]!.replace(/^claude_ai_/, '').replace(/_/g, ' ');
  return `${server} · ${match[2]}`;
}

/** Longer verbs that double their last letter, which the one-syllable rule below doesn't catch. */
const DOUBLING = new Set(['commit', 'submit', 'admit', 'begin', 'forget', 'quit', 'equip', 'refer', 'prefer', 'occur', 'control', 'compel']);
/** One syllable ending in one vowel and one consonant doubles it: run, let, stop, plan (not fix, show, say). */
const SHORT_CVC = /^[^aeiou]*[aeiou][^aeiouwxy]$/;
const doubles = (word: string) => DOUBLING.has(word) || SHORT_CVC.test(word);

/** run → running, use → using, read → reading, fix → fixing. Keeps the word's capitalisation. */
export function gerund(verb: string): string {
  const lower = verb.toLowerCase();
  let ing: string;
  if (lower.endsWith('ing')) return verb;
  if (lower.endsWith('ie')) ing = `${lower.slice(0, -2)}ying`;
  else if (lower.endsWith('e') && !/(ee|ye|oe)$/.test(lower) && lower.length > 2) ing = `${lower.slice(0, -1)}ing`;
  // rerun → rerunning, reset → resetting (but read is not re + ad).
  else if (doubles(lower) || (lower.startsWith('re') && lower.length >= 5 && doubles(lower.slice(2)))) ing = `${lower}${lower.at(-1)}ing`;
  else ing = `${lower}ing`;
  return verb[0] === verb[0]!.toUpperCase() ? ing.charAt(0).toUpperCase() + ing.slice(1) : ing;
}

/** A step as Claude Code words it: `past` for the list ("Read src/a.ts"), `present` while it runs ("Reading src/a.ts"). */
export interface StepLabel {
  past: string;
  present: string;
}

/** `verb` may be several words ("Search for"); only the first changes. */
const step = (verb: string, object: string): StepLabel => {
  const [first = '', ...rest] = verb.split(' ');
  return { past: `${verb} ${object}`.trim(), present: [gerund(first), ...rest, object].join(' ').trim() };
};

/** Words a description can start with that aren't verbs ("Only…", "Also…", "Then…"). */
const NOT_VERBS = /^(only|also|then|now|just|still|again|first|next|finally|quickly|the|a|an|and|all|both|some|this|that|these|those|my|our|new|re-?\w*|\w+ly)$/i;

/** "Run the smoke test" → present "Running the smoke test". Left as written when it doesn't start with a verb. */
const fromSentence = (sentence: string): StepLabel => {
  const text = sentence.trim();
  const [verb = '', ...rest] = text.split(/\s+/);
  if (NOT_VERBS.test(verb) && !/^re(ad|run|start|move|name|set|try|view|write|build|load|place|fresh|vert|solve|store|turn)/i.test(verb)) return { past: text, present: text };
  return { past: text, present: [gerund(verb), ...rest].join(' ') };
};

const short = (text: string, max = 80) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** A tool call as a step. `cwd` makes file paths relative to the session's folder; null shows them whole. */
export function toolStepLabel(name: string, input: unknown, cwd: string | null): StepLabel {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const file = str(i.file_path) ?? str(i.notebook_path);
  const where = file ? relative(file, cwd) : '';
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return str(i.description) ? fromSentence(String(i.description)) : step('Run', commandLabel(str(i.command) ?? 'a command'));
    case 'Read':
      return step('Read', where);
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return step('Edit', where);
    case 'Write':
      return step('Write', where);
    case 'Grep':
      return step('Search for', short(str(i.pattern) ?? ''));
    case 'Glob':
      return step('Find', short(str(i.pattern) ?? 'files'));
    case 'WebFetch':
      return step('Fetch', short(str(i.url) ?? 'a page'));
    case 'WebSearch':
      return step('Search the web for', short(str(i.query) ?? ''));
    case 'Task':
    case 'Agent':
      return str(i.description) ? fromSentence(String(i.description)) : step('Run', `the ${str(i.subagent_type) ?? 'general'} agent`);
    case 'TodoWrite':
      return step('Update', 'the to-do list');
    case 'Skill':
      return step('Use', `the ${str(i.skill) ?? str(i.command) ?? ''} skill`);
    case 'AskUserQuestion':
      return { past: 'Asked you a question', present: 'Asking you a question' };
    default: {
      const mcp = mcpLabel(name);
      return step('Use', mcp ?? (name || 'a tool'));
    }
  }
}
