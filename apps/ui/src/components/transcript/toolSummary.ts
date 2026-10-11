import { pathInside } from '@switchboard/protocol/client';

/** One-line description of a tool call for its collapsed card. */
export interface ToolSummary {
  label: string;
  detail: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

function relative(path: string, cwd: string | null): string {
  return (cwd && pathInside(path, cwd)) || path;
}

/** `mcp__claude_ai_Notion__notion-search` → `Notion · notion-search`. */
function mcpLabel(name: string): string | null {
  const match = /^mcp__(.+?)__(.+)$/.exec(name);
  if (!match) return null;
  const server = match[1]!.replace(/^claude_ai_/, '').replace(/_/g, ' ');
  return `${server} · ${match[2]}`;
}

export function toolSummary(name: string, input: unknown, cwd: string | null): ToolSummary {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const file = str(i.file_path) ?? str(i.notebook_path) ?? str(i.path);
  switch (name) {
    case 'Bash':
      return { label: 'Bash', detail: str(i.description) ? `${i.description}` : (str(i.command) ?? '') };
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { label: name, detail: file ? relative(file, cwd) : '' };
    case 'Grep':
      return { label: 'Grep', detail: [str(i.pattern), str(i.path) && relative(String(i.path), cwd)].filter(Boolean).join('  in  ') };
    case 'Glob':
      return { label: 'Glob', detail: str(i.pattern) ?? '' };
    case 'WebFetch':
      return { label: 'Fetch', detail: str(i.url) ?? '' };
    case 'WebSearch':
      return { label: 'Search', detail: str(i.query) ?? '' };
    case 'Task':
    case 'Agent':
      return { label: str(i.subagent_type) ?? 'Agent', detail: str(i.description) ?? str(i.prompt)?.slice(0, 120) ?? '' };
    case 'TodoWrite': {
      const todos = Array.isArray(i.todos) ? i.todos : [];
      const done = todos.filter((t) => (t as { status?: unknown })?.status === 'completed').length;
      return { label: 'Todos', detail: `${done}/${todos.length} done` };
    }
    case 'Skill':
      return { label: 'Skill', detail: str(i.skill) ?? str(i.command) ?? '' };
    case 'AskUserQuestion': {
      const questions = Array.isArray(i.questions) ? i.questions : [];
      return { label: 'Question', detail: str((questions[0] as { question?: unknown } | undefined)?.question) ?? '' };
    }
    default: {
      const mcp = mcpLabel(name);
      const firstString = Object.values(i).find((v) => typeof v === 'string' && v.trim()) as string | undefined;
      return { label: mcp ?? name, detail: firstString?.slice(0, 160) ?? '' };
    }
  }
}

/** Before/after pairs for tools that change files, so the card can show a diff. */
export function editHunks(item: { name: string; input: unknown }): Array<{ before: string; after: string }> | null {
  const input = (item.input ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  switch (item.name) {
    case 'Edit':
      return [{ before: str(input.old_string), after: str(input.new_string) }];
    case 'MultiEdit':
      return Array.isArray(input.edits) ? input.edits.map((e) => ({ before: str((e as Record<string, unknown>).old_string), after: str((e as Record<string, unknown>).new_string) })) : null;
    case 'Write':
      return [{ before: '', after: str(input.content) }];
    case 'NotebookEdit':
      return [{ before: '', after: str(input.new_source) }];
    default:
      return null;
  }
}

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

const count = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

/**
 * What a run of activity did, in one phrase: "Ran 3 commands, edited 2 files and
 * read a file". Files are counted once however often they were touched.
 */
export function activitySummary(items: ReadonlyArray<{ kind: string; name?: string; input?: unknown }>): string {
  let commands = 0;
  let searches = 0;
  let web = 0;
  let agents = 0;
  let thoughts = 0;
  let todos = false;
  let other = 0;
  let reports = 0;
  const edited = new Set<string>();
  const read = new Set<string>();
  const services = new Set<string>();
  const skills = new Set<string>();
  for (const item of items) {
    if (item.kind === 'thinking') thoughts++;
    if (item.kind === 'agent-report') reports++;
    if (item.kind !== 'tool' || !item.name) continue;
    const input = (item.input ?? {}) as Record<string, unknown>;
    const path = String(input.file_path ?? input.notebook_path ?? '');
    const name = item.name;
    if (name === 'Bash') commands++;
    else if (EDIT_TOOLS.has(name)) edited.add(path);
    else if (name === 'Read') read.add(path);
    else if (name === 'Grep' || name === 'Glob') searches++;
    else if (name === 'WebFetch' || name === 'WebSearch') web++;
    else if (name === 'Task' || name === 'Agent') agents++;
    else if (name === 'TodoWrite') todos = true;
    else if (name === 'Skill') skills.add(String(input.skill ?? input.command ?? 'a skill'));
    else if (/^mcp__/.test(name)) services.add(mcpLabel(name)!.split(' · ')[0]!);
    else other++;
  }
  const parts = [
    commands && `ran ${count(commands, 'a command', 'commands')}`,
    edited.size && `edited ${count(edited.size, 'a file', 'files')}`,
    read.size && `read ${count(read.size, 'a file', 'files')}`,
    searches && `searched the code${searches > 1 ? ` ${searches} times` : ''}`,
    web && `looked something up on the web${web > 1 ? ` ${web} times` : ''}`,
    agents && `ran ${count(agents, 'an agent', 'agents')}`,
    reports && (reports === 1 ? 'an agent reported back' : `${reports} agents reported back`),
    skills.size && `used ${[...skills].join(', ')}`,
    services.size && `used ${[...services].join(', ')}`,
    todos && 'updated the to-do list',
    other && `used ${count(other, 'a tool', 'tools')}`,
  ].filter((p): p is string => typeof p === 'string');
  if (parts.length === 0) return thoughts ? 'Thought it through' : 'Worked on it';
  const sentence = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
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

export function stepLabel(item: { kind: string; name?: string; input?: unknown; text?: string }, cwd: string | null): StepLabel {
  if (item.kind === 'thinking') return { past: 'Thought', present: 'Thinking' };
  if (item.kind === 'agent-report') return { past: short((item as { title?: string }).title ?? 'Agent report'), present: 'Reading the agent’s report' };
  if (item.kind === 'text' || item.kind === 'user') return { past: `Agent: ${short((item.text ?? '').split('\n')[0] ?? '')}`, present: 'Working with an agent' };
  const i = (item.input && typeof item.input === 'object' ? item.input : {}) as Record<string, unknown>;
  const file = str(i.file_path) ?? str(i.notebook_path);
  const where = file ? relative(file, cwd) : '';
  switch (item.name) {
    case 'Bash':
      return str(i.description) ? fromSentence(String(i.description)) : step('Run', short(str(i.command) ?? 'a command'));
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
      const mcp = mcpLabel(item.name ?? '');
      return step('Use', mcp ?? item.name ?? 'a tool');
    }
  }
}
