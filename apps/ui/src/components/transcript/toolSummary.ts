import { mcpLabel, pathInside, toolStepLabel, type StepLabel } from '@seshboard/protocol/client';

export { gerund, type StepLabel } from '@seshboard/protocol/client';

/** One-line description of a tool call for its collapsed card. */
export interface ToolSummary {
  label: string;
  detail: string;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

function relative(path: string, cwd: string | null): string {
  return (cwd && pathInside(path, cwd)) || path;
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

const short = (text: string, max = 80) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** A transcript item as a step: a tool call through `toolStepLabel`, thinking and an agent's turns in their own words. */
export function stepLabel(item: { kind: string; name?: string; input?: unknown; text?: string }, cwd: string | null): StepLabel {
  if (item.kind === 'thinking') return { past: 'Thought', present: 'Thinking' };
  if (item.kind === 'agent-report') return { past: short((item as { title?: string }).title ?? 'Agent report'), present: 'Reading the agent’s report' };
  if (item.kind === 'text' || item.kind === 'user') return { past: `Agent: ${short((item.text ?? '').split('\n')[0] ?? '')}`, present: 'Working with an agent' };
  return toolStepLabel(item.name ?? '', item.input, cwd);
}
