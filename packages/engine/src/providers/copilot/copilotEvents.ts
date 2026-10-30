import type { RawSessionMessage } from '../../claude/transcript.ts';

/**
 * One line of Copilot CLI's `events.jsonl`. The records have the shape of the Copilot SDK's `SessionEvent`; only the
 * fields read here are typed, since the file is undocumented and every field may be missing.
 */
export interface CopilotEvent {
  type: string;
  id?: string;
  timestamp?: string;
  parentId?: string | null;
  data?: Record<string, unknown>;
}

/** Parses `events.jsonl`, skipping lines that aren't JSON (a line still being written). */
export function parseEvents(text: string): CopilotEvent[] {
  const events: CopilotEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as CopilotEvent;
      if (event && typeof event.type === 'string') events.push(event);
    } catch {
      // A partly written last line, or a format change: leave it out.
    }
  }
  return events;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * What the user typed. Copilot's VS Code client wraps the request in context (`<reminder>`, `<attachments>`) and keeps
 * the request itself in `<userRequest>`.
 */
export function userText(content: string): string {
  const request = /<userRequest>\s*([\s\S]*?)\s*<\/userRequest>/.exec(content);
  if (request) return request[1]!;
  return content.replace(/\s*<reminder>[\s\S]*?<\/reminder>\s*/g, '\n').replace(/\s*<attachments>[\s\S]*?<\/attachments>\s*/g, '\n').trim();
}

/** Copilot's tools that only report to Copilot's own UI, not work done: left out of the transcript. */
const HIDDEN_TOOLS = new Set(['report_intent']);

/**
 * Copilot's tools with a Claude Code counterpart, renamed (and their input reshaped) so the transcript shows them with
 * the same cards: the command of a shell call, the diff of an edit, the file of a read.
 */
export function claudeTool(name: string, args: unknown): { name: string; input: Record<string, unknown> } {
  const a = obj(args);
  const path = str(a.path);
  switch (name) {
    case 'bash':
    case 'powershell':
      return { name: 'Bash', input: { command: str(a.command) ?? '', ...(str(a.description) ? { description: a.description } : {}) } };
    case 'view':
    case 'show_file':
      return { name: 'Read', input: { file_path: path ?? '' } };
    case 'edit':
      return { name: 'Edit', input: { file_path: path ?? '', old_string: str(a.old_str) ?? '', new_string: str(a.new_str) ?? '' } };
    case 'create':
      return { name: 'Write', input: { file_path: path ?? '', content: str(a.file_text) ?? '' } };
    case 'grep':
    case 'rg':
      return { name: 'Grep', input: { pattern: str(a.pattern) ?? '', ...(path ? { path } : {}), ...(str(a.glob) ? { glob: a.glob } : {}) } };
    case 'glob':
      return { name: 'Glob', input: { pattern: str(a.pattern) ?? '', ...(path ? { path } : {}) } };
    case 'web_fetch':
      return { name: 'WebFetch', input: { url: str(a.url) ?? '' } };
    case 'task':
      return { name: 'Agent', input: { description: str(a.description) ?? str(a.name) ?? '', prompt: str(a.prompt) ?? '', ...(str(a.agent_type) ? { subagent_type: a.agent_type } : {}) } };
    case 'update_todo':
      return { name: 'TodoWrite', input: { todos: Array.isArray(a.todos) ? a.todos : [] } };
    case 'skill':
      return { name: 'Skill', input: { skill: str(a.skill) ?? '' } };
    default:
      // A custom tool (apply_patch) takes its input as one string.
      return { name, input: typeof args === 'string' ? { input: args } : a };
  }
}

/** A tool's output as text: what Copilot showed, else what the model got, else the error. */
function resultText(data: Record<string, unknown>): string {
  const result = obj(data.result);
  const error = obj(data.error);
  return str(result.detailedContent) ?? str(result.content) ?? str(error.message) ?? '';
}

/**
 * Turns a Copilot session's events into the messages Seshboard reads from Claude Code's transcripts, so the
 * transcript view, search, catch-up and the phone show it the same way. User prompts and replies become text, tool
 * requests `tool_use` blocks, and tool results `tool_result` blocks. Subagents' own steps (events with a
 * `parentToolCallId`) are left out, like a Claude Code subagent's are from the main conversation.
 */
export function copilotMessages(events: readonly CopilotEvent[]): RawSessionMessage[] {
  const messages: RawSessionMessage[] = [];
  const hidden = new Set<string>();
  events.forEach((event, index) => {
    const data = obj(event.data);
    const uuid = event.id ?? `copilot-${index}`;
    const base = { uuid, parent_tool_use_id: null, ...(event.timestamp ? { timestamp: event.timestamp } : {}) };
    if (str(data.parentToolCallId)) return;
    switch (event.type) {
      case 'user.message': {
        const text = userText(str(data.content) ?? '');
        if (text) messages.push({ ...base, type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
        return;
      }
      case 'assistant.message': {
        const content: unknown[] = [];
        const reasoning = str(data.reasoningText);
        if (reasoning?.trim()) content.push({ type: 'thinking', thinking: reasoning });
        const text = str(data.content);
        if (text?.trim()) content.push({ type: 'text', text });
        for (const request of Array.isArray(data.toolRequests) ? data.toolRequests : []) {
          const r = obj(request);
          const id = str(r.toolCallId) ?? '';
          const name = str(r.name) ?? 'unknown';
          if (HIDDEN_TOOLS.has(name)) {
            hidden.add(id);
            continue;
          }
          const tool = claudeTool(name, r.arguments);
          content.push({ type: 'tool_use', id, name: tool.name, input: tool.input });
        }
        if (content.length) messages.push({ ...base, type: 'assistant', message: { role: 'assistant', model: str(data.model) ?? undefined, content } });
        return;
      }
      case 'tool.execution_complete': {
        const id = str(data.toolCallId) ?? '';
        if (hidden.has(id)) return;
        const content = [{ type: 'tool_result', tool_use_id: id, is_error: data.success === false, content: resultText(data) }];
        messages.push({ ...base, type: 'user', message: { role: 'user', content } });
        return;
      }
      default:
        return;
    }
  });
  return messages;
}

/** Events that mean the session did something, for its last activity (not a resume or a shutdown). */
export const ACTIVITY_EVENTS = new Set(['user.message', 'assistant.message', 'tool.execution_complete']);
