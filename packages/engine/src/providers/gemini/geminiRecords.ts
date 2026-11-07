/**
 * Gemini CLI's session files, as `@google/gemini-cli-core` writes them (`chatRecordingTypes.d.ts`,
 * `ChatRecordingService`). Only the fields read here are typed: the format is Gemini's own and every field may be
 * missing.
 */

/** A Gemini `Part`: text, a thought, inline data, a function call or its response. */
export type GeminiPart = Record<string, unknown>;

export interface GeminiToolCall {
  id: string;
  name: string;
  args?: unknown;
  /** What the model got back: Gemini `Part`s with a `functionResponse`. */
  result?: unknown;
  status?: string;
  timestamp?: string;
  displayName?: string;
  description?: string;
  /** What Gemini CLI showed: a string, or a file diff (`fileName`, `fileDiff`, `originalContent`, `newContent`). */
  resultDisplay?: unknown;
  /** The subagent this call started, when it is one. */
  agentId?: string;
}

export interface GeminiMessage {
  id: string;
  timestamp?: string;
  /** `user`, `gemini`, `info`, `error` or `warning`. */
  type: string;
  /** A string or Gemini `Part`s. */
  content?: unknown;
  displayContent?: unknown;
  model?: string;
  tokens?: { input?: number; output?: number; cached?: number; thoughts?: number; tool?: number; total?: number } | null;
  thoughts?: Array<{ subject?: string; description?: string; timestamp?: string }>;
  toolCalls?: GeminiToolCall[];
}

/** A whole session: its header and its messages in order, after every update in the file was applied. */
export interface GeminiConversation {
  sessionId: string;
  projectHash?: string;
  startTime?: string;
  lastUpdated?: string;
  /** `main`, or `subagent` for a subagent's own file. */
  kind?: string;
  /** The summary Gemini CLI wrote for the session (its title). */
  summary?: string;
  directories?: string[];
  messages: GeminiMessage[];
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isMessage = (value: unknown): value is GeminiMessage => isObject(value) && typeof value.id === 'string' && !('$patch' in value);

/** The header fields a record may carry (the first line, or a `$set`). */
const HEADER_FIELDS = ['sessionId', 'projectHash', 'startTime', 'lastUpdated', 'kind', 'summary', 'directories'] as const;

/**
 * Replays a session file the way Gemini CLI loads it: a JSON Lines log (`.jsonl`) where the first line is the header,
 * `{"$set": …}` updates the header (with `messages`, a checkpoint that lists the conversation again), a message line
 * replaces an earlier copy of the same id in place, `{"$rewindTo": id}` drops that message and everything after it, and
 * `{"$patch": …}` updates a message's content or a tool call's result, removes messages or orders them. An older
 * session is one JSON object with its `messages` (`.json`). Lines that aren't JSON (one still being written) are
 * skipped. Null when the file names no session.
 */
export function parseConversation(text: string): GeminiConversation | null {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') && !trimmed.includes('\n{')) {
    // One object: the older `.json` format (or a `.jsonl` with only its header).
    try {
      const whole = JSON.parse(trimmed) as unknown;
      if (isObject(whole) && Array.isArray(whole.messages)) {
        const header = headerOf(whole);
        return typeof header.sessionId === 'string' ? { ...header, sessionId: header.sessionId, messages: whole.messages.filter(isMessage) } : null;
      }
    } catch {
      // Not one object after all: read it line by line.
    }
  }
  let header: Partial<GeminiConversation> = {};
  // A Map keeps the order a message was first written in, and a later copy replaces it there, as Gemini's does.
  let messages = new Map<string, GeminiMessage>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(record)) continue;
    if (typeof record.$rewindTo === 'string') {
      const ids = [...messages.keys()];
      const at = ids.indexOf(record.$rewindTo);
      // A rewind to a message that isn't there drops everything, as Gemini's reader does.
      for (const id of at >= 0 ? ids.slice(at) : ids) messages.delete(id);
    } else if (isObject(record.$patch)) {
      messages = applyPatch(messages, record.$patch);
    } else if (isMessage(record)) {
      messages.set(record.id, record);
    } else if (isObject(record.$set)) {
      if (Array.isArray(record.$set.messages)) messages = new Map(record.$set.messages.filter(isMessage).map((m) => [m.id, m]));
      header = { ...header, ...headerOf(record.$set) };
    } else if (typeof record.sessionId === 'string') {
      header = { ...header, ...headerOf(record) };
      if (Array.isArray(record.messages)) for (const m of record.messages.filter(isMessage)) messages.set(m.id, m);
    }
  }
  return typeof header.sessionId === 'string' ? { ...header, sessionId: header.sessionId, messages: [...messages.values()] } : null;
}

function headerOf(record: Record<string, unknown>): Partial<GeminiConversation> {
  const header: Record<string, unknown> = {};
  for (const field of HEADER_FIELDS) if (record[field] !== undefined) header[field] = record[field];
  return header as Partial<GeminiConversation>;
}

/** One `$patch`: one message's update (`id`), several (`updates`), messages removed (`removeIds`), or moved to the end in this order (`orderIds`). */
function applyPatch(messages: Map<string, GeminiMessage>, patch: Record<string, unknown>): Map<string, GeminiMessage> {
  const one = (update: unknown) => {
    if (!isObject(update) || typeof update.id !== 'string') return;
    const existing = messages.get(update.id);
    if (!existing) return;
    const next: GeminiMessage = { ...existing };
    if (update.content !== undefined) next.content = update.content;
    if (Array.isArray(update.toolCalls) && next.toolCalls) {
      next.toolCalls = next.toolCalls.map((call) => {
        const changed = (update.toolCalls as unknown[]).find((c) => isObject(c) && c.id === call.id) as Record<string, unknown> | undefined;
        return changed && 'result' in changed ? { ...call, result: changed.result } : call;
      });
    }
    messages.set(update.id, next);
  };
  one(patch);
  if (Array.isArray(patch.updates)) for (const update of patch.updates) one(update);
  if (Array.isArray(patch.removeIds)) for (const id of patch.removeIds) if (typeof id === 'string') messages.delete(id);
  if (Array.isArray(patch.orderIds)) {
    const ordered = patch.orderIds.filter((id): id is string => typeof id === 'string' && messages.has(id));
    const moved = new Set(ordered);
    return new Map([...[...messages].filter(([id]) => !moved.has(id)), ...ordered.map((id) => [id, messages.get(id)!] as [string, GeminiMessage])]);
  }
  return messages;
}

/** The text of a message's content (a string, or the `text` of its parts, thoughts left out). */
export function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  const parts = Array.isArray(content) ? content : isObject(content) ? [content] : [];
  return parts
    .map((part) => (typeof part === 'string' ? part : isObject(part) && typeof part.text === 'string' && part.thought !== true ? part.text : ''))
    .join('');
}

/**
 * Prompts Gemini CLI adds by itself, or that aren't a request: the session's context it starts with
 * (`<session_context>`), a hook's (`<hook_context>`), and a slash command or `?` help, as Gemini's own list leaves them
 * out of a session's first prompt.
 */
export function isIgnoredPrompt(text: string): boolean {
  const trimmed = text.trim();
  return !trimmed || trimmed.startsWith('/') || trimmed.startsWith('?') || trimmed.startsWith('<session_context>') || trimmed.startsWith('<hook_context>');
}

/** Context Gemini CLI wraps around a prompt, which isn't what you typed. */
export const isInjectedPrompt = (text: string): boolean => /^\s*<(?:session_context|hook_context)>/.test(text);
