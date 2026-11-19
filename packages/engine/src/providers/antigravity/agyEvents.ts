import type { RawSessionMessage } from '../../claude/transcript.ts';
import { acpToolCard } from '../acp/acpCards.ts';
import type { AcpContentBlock, AcpToolCall } from '../acp/acpTypes.ts';

/*
 * Antigravity's conversation, as `agy acp`'s `session/load` sends it again (its replay), as the messages Seshboard reads
 * from Claude Code's transcripts. Checked live with agy 1.5.12: each prompt replays as a `user_message_chunk` of its
 * text, then one per file link it had (images are left out), each reply and each thought as one chunk, and each tool
 * call complete, with its output. Text has no ids, so Seshboard names each message by its place: the prompt's number
 * and the part's in its turn. Antigravity only appends (it has no rewind), so a message keeps its id from one read to
 * the next. Every update is read loosely: a field of another shape leaves the message with less, never an error.
 */

type Loose = Record<string, unknown>;
type Block = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const obj = (v: unknown): Loose => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Joins the parts of a message's id. */
export const AGY_ID_JOIN = '~';

/** The id of a session's `n`th prompt (from 1), as the transcript gives it: the driver names a message it sends the same way. */
export const agyPromptId = (sessionId: string, n: number) => `${sessionId}${AGY_ID_JOIN}u${n}`;

/** What Antigravity's shell tool puts before a command's output (`run_command`'s `output`). */
const COMMAND_HEADER = /^(?:Created At: [^\n]*\n)?(?:Completed At: [^\n]*\n)?(?:Command exited with code -?\d+\.\n)?\n?(?:Command output:\n)?/;

/** A command's output as a terminal shows it: without Antigravity's header, with plain line ends. */
export function commandOutput(output: string): string {
  return output.replace(COMMAND_HEADER, '').replace(/\r\n/g, '\n');
}

/** The text of a tool call's output: its `rawOutput.output`, else the text it shows, else its `rawOutput` as JSON. */
function outputText(call: AcpToolCall): string {
  const raw = obj(call.rawOutput);
  const output = str(raw.output);
  if (output !== null) return commandOutput(output);
  const shown = arr(call.content)
    .map(obj)
    .map((item) => (item.type === 'content' ? str(obj(item.content).text) : null))
    .filter((t): t is string => t !== null);
  if (shown.length) return shown.join('\n');
  return Object.keys(raw).length ? JSON.stringify(raw, null, 2) : '';
}

/** The input Antigravity sent with a call: `args` on its own updates, `rawInput` as ACP has it. */
const inputOf = (call: AcpToolCall): Loose => {
  const args = obj((call as { args?: unknown }).args);
  return Object.keys(args).length ? args : obj(call.rawInput);
};

/** Antigravity's own name for a tool (`run_command`), which ACP's `name` field carries. */
export const agyToolName = (call: AcpToolCall): string | null => str((call as { name?: unknown }).name);

/** The first diff a call shows (an edit's whole file before and after). */
function diffOf(call: AcpToolCall): { path: string; oldText: string | null; newText: string } | null {
  for (const raw of arr(call.content)) {
    const item = obj(raw);
    if (item.type === 'diff' && typeof item.path === 'string') return { path: item.path, oldText: str(item.oldText), newText: str(item.newText) ?? '' };
  }
  return null;
}

/**
 * An Antigravity tool call as Claude Code's tool, so the transcript and the permission card show it with the same card:
 * `run_command` as Bash, `read_file` as Read, `edit_file` as Edit (the text it replaced, else the file's diff),
 * `write_file` as Write. Another tool goes by ACP's `kind` (`acpToolCard`), keeping Antigravity's name and input.
 */
export function agyToolCard(call: AcpToolCall): { toolName: string; input: Record<string, unknown> } {
  const name = agyToolName(call);
  const input = inputOf(call);
  const path = str(input.Path) ?? str(input.AbsolutePath) ?? str(input.TargetFile) ?? call.locations?.find((l) => typeof l.path === 'string')?.path ?? null;
  switch (name) {
    case 'run_command': {
      const summary = str(input.toolSummary);
      return { toolName: 'Bash', input: { command: str(input.CommandLine) ?? str(call.title) ?? '', ...(summary ? { description: summary } : {}) } };
    }
    case 'read_file':
    case 'view_file':
      return { toolName: 'Read', input: { file_path: path ?? str(call.title) ?? '' } };
    case 'edit_file': {
      const target = str(input.Target);
      const replacement = str(input.Replacement);
      if (path && target !== null && replacement !== null) return { toolName: 'Edit', input: { file_path: path, old_string: target, new_string: replacement } };
      const diff = diffOf(call);
      if (diff) return { toolName: 'Edit', input: { file_path: diff.path, old_string: diff.oldText ?? '', new_string: diff.newText } };
      return { toolName: 'Edit', input: { file_path: path ?? '' } };
    }
    case 'write_file': {
      const content = str(input.Content) ?? diffOf(call)?.newText ?? '';
      return { toolName: 'Write', input: { file_path: path ?? diffOf(call)?.path ?? '', content } };
    }
    default:
      return acpToolCard({ ...call, rawInput: input }, name);
  }
}

/** Times to give the messages: each prompt's, and the session's last activity for the rest. */
export interface AgyTimes {
  /** When each prompt of these updates was sent, in order (`agyPromptTimes`); missing ones get `fallback`. */
  prompts: readonly number[];
  fallback: number;
}

const iso = (ms: number | null) => (ms === null || !Number.isFinite(ms) ? undefined : new Date(ms).toISOString());

/** A call's state as the replay or the stream left it, merged from its `tool_call` and every `tool_call_update`. */
function merge(previous: AcpToolCall | undefined, update: AcpToolCall): AcpToolCall {
  if (!previous) return update;
  const next: AcpToolCall = { ...previous };
  for (const [key, value] of Object.entries(update)) if (value !== undefined && value !== null && key !== 'sessionUpdate') (next as unknown as Loose)[key] = value;
  return next;
}

/** A replayed user message's text, and the files it linked as `@` mentions it doesn't have yet. */
function userText(blocks: readonly AcpContentBlock[]): string {
  const texts: string[] = [];
  const links: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text);
    else if (block.type === 'resource_link' && typeof block.name === 'string') links.push(block.name);
    else if (block.type === 'image') texts.push('[Image]');
  }
  const text = texts.join('\n\n');
  // The message box writes files as a line of `@` mentions, which stays in the text: a link it names already adds nothing.
  const missing = links.filter((name) => !text.includes(`@${name}`) && !text.includes(`@"${name}"`));
  return missing.length ? `${text}\n\n${missing.map((name) => (/\s/.test(name) ? `@"${name}"` : `@${name}`)).join(' ')}` : text;
}

/**
 * The messages of a conversation as `session/load` replays it (its `session/update`s, in order). A `text` user chunk
 * starts a prompt (the driver sends the text first); a link or an image after it is part of it. Thoughts and replies
 * that follow each other join; each tool call is an assistant `tool_use` and, once it ended, a user `tool_result`. A
 * prompt without a reply (stopped at once) is just your message. `promptsBefore`: the prompts the conversation had
 * before these updates (the driver's, for a turn of a session that had some), so the ids are the whole replay's.
 */
export function agyMessages(sessionId: string, updates: readonly unknown[], times: AgyTimes = { prompts: [], fallback: Date.now() }, promptsBefore = 0): RawSessionMessage[] {
  const out: RawSessionMessage[] = [];
  let prompt = promptsBefore;
  let part = 0;
  /** What is being gathered: a prompt's blocks, a thought or a reply, joined until something else comes. */
  type Open = { kind: 'user'; blocks: AcpContentBlock[]; id: string } | { kind: 'thinking' | 'text'; text: string; id: string };
  let open = null as Open | null;
  const calls = new Map<string, { call: AcpToolCall; id: string }>();
  const order: string[] = [];
  const at = () => iso(times.prompts[prompt - promptsBefore - 1] ?? times.fallback);

  const push = (type: RawSessionMessage['type'], uuid: string, message: unknown) => {
    const timestamp = at();
    out.push({ type, uuid, message, parent_tool_use_id: null, ...(timestamp ? { timestamp } : {}) });
  };
  const flushCalls = () => {
    for (const callId of order) {
      const { call, id } = calls.get(callId)!;
      const card = agyToolCard(call);
      push('assistant', id, { role: 'assistant', content: [{ type: 'tool_use', id: callId, name: card.toolName, input: card.input }] });
      if (call.status === 'completed' || call.status === 'failed') {
        const output = outputText(call);
        const exit = num(obj(call.rawOutput).exit_code);
        const isError = call.status === 'failed' || (exit !== null && exit !== 0);
        const text = output || (card.toolName === 'Edit' || card.toolName === 'Write' ? `Updated ${String(card.input.file_path ?? 'the file')}` : '');
        push('user', `${id}${AGY_ID_JOIN}result`, { role: 'user', content: [{ type: 'tool_result', tool_use_id: callId, is_error: isError, content: text }] });
      }
    }
    calls.clear();
    order.length = 0;
  };
  const flush = () => {
    if (!open) return;
    const current = open;
    open = null;
    if (current.kind === 'user') {
      const text = userText(current.blocks);
      if (text.trim()) push('user', current.id, { role: 'user', content: [{ type: 'text', text }] });
    } else if (current.text.trim()) {
      const block: Block = current.kind === 'thinking' ? { type: 'thinking', thinking: current.text } : { type: 'text', text: current.text };
      push('assistant', current.id, { role: 'assistant', content: [block] });
    }
  };
  const nextId = () => `${agyPromptId(sessionId, prompt)}${AGY_ID_JOIN}${++part}`;

  for (const raw of updates) {
    const update = obj(raw);
    const kind = str(update.sessionUpdate);
    const content = obj(update.content);
    switch (kind) {
      case 'user_message_chunk': {
        // A text starts the next prompt; a link or an image belongs to the one before it.
        if (content.type === 'text' || open?.kind !== 'user') {
          flushCalls();
          flush();
          prompt++;
          part = 0;
          open = { kind: 'user', blocks: [], id: agyPromptId(sessionId, prompt) };
        }
        (open as { blocks: AcpContentBlock[] }).blocks.push(content as AcpContentBlock);
        break;
      }
      case 'agent_thought_chunk':
      case 'agent_message_chunk': {
        const text = str(content.text);
        if (text === null) break;
        const as = kind === 'agent_thought_chunk' ? 'thinking' : 'text';
        if (open?.kind === as) {
          open.text += text;
          break;
        }
        flushCalls();
        flush();
        open = { kind: as, text, id: nextId() };
        break;
      }
      case 'tool_call':
      case 'tool_call_update': {
        const callId = str(update.toolCallId);
        if (!callId) break;
        const known = calls.get(callId);
        if (!known) {
          flush();
          order.push(callId);
          calls.set(callId, { call: update as unknown as AcpToolCall, id: nextId() });
        } else known.call = merge(known.call, update as unknown as AcpToolCall);
        break;
      }
      default:
        break;
    }
  }
  flushCalls();
  flush();
  return out;
}

/** The text of the replay's updates that say something of the session: its title (`session_info_update`) and its context. */
export function agyReplayInfo(updates: readonly unknown[]): { title: string | null; context: { used: number; size: number } | null; prompts: number } {
  let title: string | null = null;
  let context: { used: number; size: number } | null = null;
  let prompts = 0;
  for (const raw of updates) {
    const update = obj(raw);
    if (update.sessionUpdate === 'session_info_update') title = str(update.title)?.trim() || title;
    else if (update.sessionUpdate === 'usage_update') {
      const used = num(update.used);
      const size = num(update.size);
      if (used !== null && size !== null && size > 0) context = { used, size };
    } else if (update.sessionUpdate === 'user_message_chunk' && obj(update.content).type === 'text') prompts++;
  }
  return { title, context, prompts };
}
