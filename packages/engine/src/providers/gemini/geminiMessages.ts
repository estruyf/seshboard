import type { RawSessionMessage } from '../../claude/transcript.ts';
import { contentText, isInjectedPrompt, type GeminiConversation, type GeminiMessage, type GeminiToolCall } from './geminiRecords.ts';

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The first web address in a text: Gemini's `web_fetch` takes a prompt with the addresses in it, not a URL. */
const firstUrl = (text: string | null): string | null => (text ? (/https?:\/\/[^\s"'<>)]+/.exec(text)?.[0] ?? null) : null);

/** Gemini's to-do statuses as Claude Code's (`cancelled` has none: it shows as done). */
const TODO_STATUS: Record<string, string> = { pending: 'pending', in_progress: 'in_progress', completed: 'completed', cancelled: 'completed' };

/**
 * Gemini CLI's tools with a Claude Code counterpart, renamed (and their input reshaped) so the transcript shows them with
 * the same cards: the command of a shell call, the diff of an edit, the file of a read. A call that started a subagent
 * (`agentId`) is an Agent card. The rest keep their name and input, and get the generic card.
 */
export function geminiTool(name: string, args: unknown, agentId?: string | null): { name: string; input: Record<string, unknown> } {
  const a = obj(args);
  const path = str(a.file_path) ?? str(a.absolute_path) ?? str(a.path);
  const dir = str(a.dir_path) ?? str(a.path);
  switch (name) {
    case 'run_shell_command':
      return { name: 'Bash', input: { command: str(a.command) ?? '', ...(str(a.description) ? { description: a.description } : {}) } };
    case 'read_file':
      return { name: 'Read', input: { file_path: path ?? '', ...(typeof a.start_line === 'number' ? { offset: a.start_line } : typeof a.offset === 'number' ? { offset: a.offset } : {}), ...(typeof a.limit === 'number' ? { limit: a.limit } : {}) } };
    case 'replace':
      return { name: 'Edit', input: { file_path: path ?? '', old_string: str(a.old_string) ?? '', new_string: str(a.new_string) ?? '', ...(a.allow_multiple === true || (typeof a.expected_replacements === 'number' && a.expected_replacements > 1) ? { replace_all: true } : {}) } };
    case 'write_file':
      return { name: 'Write', input: { file_path: path ?? '', content: str(a.content) ?? '' } };
    case 'glob':
      return { name: 'Glob', input: { pattern: str(a.pattern) ?? '', ...(dir ? { path: dir } : {}) } };
    case 'grep_search':
    case 'search_file_content': {
      const include = str(a.include_pattern) ?? str(a.include);
      return { name: 'Grep', input: { pattern: str(a.pattern) ?? '', ...(dir ? { path: dir } : {}), ...(include ? { glob: include } : {}) } };
    }
    case 'web_fetch': {
      const prompt = str(a.prompt);
      return { name: 'WebFetch', input: { url: str(a.url) ?? firstUrl(prompt) ?? '', ...(prompt ? { prompt } : {}) } };
    }
    case 'google_web_search':
      return { name: 'WebSearch', input: { query: str(a.query) ?? '' } };
    case 'write_todos': {
      const todos = (Array.isArray(a.todos) ? a.todos : []).map((t) => {
        const todo = obj(t);
        const content = str(todo.description) ?? str(todo.content) ?? '';
        return { content, status: TODO_STATUS[str(todo.status) ?? ''] ?? 'pending', activeForm: content };
      });
      return { name: 'TodoWrite', input: { todos } };
    }
    case 'activate_skill':
      return { name: 'Skill', input: { skill: str(a.name) ?? '' } };
    case 'ask_user':
      return { name: 'AskUserQuestion', input: { questions: Array.isArray(a.questions) ? a.questions : [] } };
    case 'invoke_agent':
      return { name: 'Agent', input: { description: str(a.agent_name) ?? '', prompt: str(a.prompt) ?? '', ...(str(a.agent_name) ? { subagent_type: a.agent_name } : {}) } };
    default:
      // A subagent Gemini calls by its own name (`codebase_investigator`): an Agent card all the same.
      if (agentId) return { name: 'Agent', input: { description: name, prompt: str(a.prompt) ?? str(a.objective) ?? '', subagent_type: name } };
      return { name, input: a };
  }
}

/**
 * A tool's output as text: what the model got back (the `output` of its `functionResponse`, or its error), else what
 * Gemini CLI showed (a string). An edit's display is a diff, which the Edit card shows from the input already.
 */
export function toolResultText(call: Pick<GeminiToolCall, 'result' | 'resultDisplay'>): string {
  const parts = Array.isArray(call.result) ? call.result : call.result ? [call.result] : [];
  const texts: string[] = [];
  for (const part of parts) {
    const response = obj(obj(obj(part).functionResponse).response);
    const text = str(response.output) ?? str(response.error) ?? (typeof response.content === 'string' ? response.content : null);
    if (text) texts.push(text);
  }
  if (texts.length) return texts.join('\n');
  return str(call.resultDisplay) ?? '';
}

/** A tool call that ended badly: Gemini records `error` and `cancelled`; a call with an error in its response too. */
function failed(call: GeminiToolCall): boolean {
  if (call.status && call.status !== 'success') return true;
  const parts = Array.isArray(call.result) ? call.result : [];
  return parts.some((part) => str(obj(obj(obj(part).functionResponse).response).error) !== null);
}

/** A thought as the live stream shows it (Gemini's ACP agent sends them the same way): its subject in bold, then the rest. */
export const thoughtText = (thought: { subject?: string; description?: string }): string => [thought.subject ? `**${thought.subject}**` : '', thought.description ?? ''].filter(Boolean).join('\n');

/** The images in a prompt, as Claude Code's image blocks. */
function imagesIn(content: unknown): unknown[] {
  const parts = Array.isArray(content) ? content : [];
  return parts.flatMap((part) => {
    const data = obj(obj(part).inlineData);
    return typeof data.data === 'string' && str(data.mimeType)?.startsWith('image/') ? [{ type: 'image', source: { type: 'base64', media_type: data.mimeType, data: data.data } }] : [];
  });
}

/** What you typed: what Gemini CLI showed for the prompt (before it read in the `@` files), else its text. */
export function promptText(message: Pick<GeminiMessage, 'content' | 'displayContent'>): string {
  const shown = contentText(message.displayContent);
  return (shown.trim() ? shown : contentText(message.content)).trim();
}

/**
 * Turns one Gemini message into the messages Seshboard reads from Claude Code's transcripts: a prompt as your text, a
 * reply as its thinking and text, each of its tool calls as a `tool_use` followed by its `tool_result`, and Gemini
 * CLI's own notes (`info`, `warning`, `error`) as notes. The context Gemini CLI starts a session with (`<session_context>`) is
 * left out. Each keeps Gemini's message id (a call's adds its own), so a session read again keeps its messages where they were.
 */
export function geminiMessageToRaw(message: GeminiMessage): RawSessionMessage[] {
  const base = { uuid: message.id, parent_tool_use_id: null, ...(message.timestamp ? { timestamp: message.timestamp } : {}) };
  switch (message.type) {
    case 'user': {
      const text = promptText(message);
      if (isInjectedPrompt(text)) return [];
      const images = imagesIn(message.content);
      if (!text && !images.length) return [];
      return [{ ...base, type: 'user', message: { role: 'user', content: [...(text ? [{ type: 'text', text }] : []), ...images] } }];
    }
    case 'gemini': {
      const content: unknown[] = [];
      for (const thought of message.thoughts ?? []) {
        const thinking = thoughtText(thought);
        if (thinking.trim()) content.push({ type: 'thinking', thinking });
      }
      const text = contentText(message.content);
      if (text.trim()) content.push({ type: 'text', text });
      const model = message.model ? { model: message.model } : {};
      const out: RawSessionMessage[] = content.length ? [{ ...base, type: 'assistant', message: { role: 'assistant', ...model, content } }] : [];
      // Each call and its result are messages of their own: Gemini adds calls to its message as they finish, and a
      // message that changes keeps its id, so only a new id reaches a transcript that is open.
      for (const call of message.toolCalls ?? []) {
        if (!call || typeof call.id !== 'string') continue;
        const tool = geminiTool(call.name, call.args, call.agentId);
        const id = `${message.id}~${call.id}`;
        out.push({ ...base, ...(call.timestamp ? { timestamp: call.timestamp } : {}), uuid: id, type: 'assistant', message: { role: 'assistant', ...model, content: [{ type: 'tool_use', id: call.id, name: tool.name, input: tool.input }] } });
        // A call still running has no result yet: its card shows it running until Gemini writes it again.
        if (call.result === undefined && (!call.status || call.status === 'executing' || call.status === 'scheduled' || call.status === 'validating' || call.status === 'awaiting_approval')) continue;
        out.push({ ...base, ...(call.timestamp ? { timestamp: call.timestamp } : {}), uuid: `${id}~result`, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, is_error: failed(call), content: toolResultText(call) }] } });
      }
      return out;
    }
    case 'info':
    case 'warning':
    case 'error': {
      const text = contentText(message.displayContent).trim() || contentText(message.content).trim();
      return text ? [{ ...base, type: 'system', message: { role: 'system', content: [{ type: 'text', text }] } }] : [];
    }
    default:
      return [];
  }
}

/** A whole session as transcript messages. */
export function geminiMessages(conversation: GeminiConversation | null): RawSessionMessage[] {
  return conversation ? conversation.messages.flatMap(geminiMessageToRaw) : [];
}
