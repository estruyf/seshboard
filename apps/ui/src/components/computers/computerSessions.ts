import type { Computer, RemoteMessage, RemoteSession, RemoteSessions, RemoteTranscriptUpdate, StreamDelta, TranscriptMessage } from '@seshboard/protocol/client';
import { basename } from '../../lib/format.ts';
import { buildDisplayItems, type DisplayItem } from '../transcript/displayItems.ts';
import { buildTurns, type Turn } from '../transcript/turns.ts';

/**
 * Another computer's sessions and conversations, as this app shows them (Other computers, docs/remote-access.md).
 * Pure functions, so the merging is easy to check; the same rules as the remote app's (apps/remote/src/lib/transcript.ts).
 */

/** Adds `incoming` after `current`, keeping each message once (the newer copy wins). */
export function appendMessages(current: readonly RemoteMessage[], incoming: readonly RemoteMessage[]): RemoteMessage[] {
  if (!incoming.length) return current as RemoteMessage[];
  const fresh = new Map(incoming.map((m) => [m.uuid, m]));
  return [...current.filter((m) => !fresh.has(m.uuid)), ...incoming];
}

/** An older page goes in front. */
export function prependMessages(current: readonly RemoteMessage[], older: readonly RemoteMessage[]): RemoteMessage[] {
  const known = new Set(current.map((m) => m.uuid));
  return [...older.filter((m) => !known.has(m.uuid)), ...current];
}

export function applyUpdate(current: readonly RemoteMessage[], update: RemoteTranscriptUpdate): RemoteMessage[] {
  return update.mode === 'replace' ? [...update.messages] : appendMessages(current, update.messages);
}

/** What Claude is writing right now, from `session.stream`. */
export interface Streaming {
  kind: 'text' | 'thinking' | 'tool' | null;
  text: string;
}

export const NOT_STREAMING: Streaming = { kind: null, text: '' };

export function applyStream(current: Streaming, delta: StreamDelta): Streaming {
  if (delta.kind === 'clear') return NOT_STREAMING;
  if (delta.kind === 'tool') return { kind: 'tool', text: delta.text };
  return current.kind === delta.kind ? { kind: delta.kind, text: current.text + delta.text } : { kind: delta.kind, text: delta.text };
}

/** The main conversation, without subagents' own messages and without messages that are only tool results. */
export function visibleMessages(messages: readonly RemoteMessage[]): RemoteMessage[] {
  return messages.filter((m) => m.parentToolUseId === null && m.blocks.some((b) => b.type !== 'tool_result'));
}

/** The one line that says what a tool call does: its command, file or pattern. */
export function toolLine(name: string, input: unknown): string {
  const value = (input ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof value[key] === 'string' ? (value[key] as string) : null);
  const line = text('description') ?? text('command') ?? text('file_path') ?? text('path') ?? text('pattern') ?? text('url') ?? text('query') ?? text('prompt') ?? '';
  const first = line.split('\n')[0]!.trim();
  return first.length > 120 ? `${first.slice(0, 117)}…` : first;
}

/** A tool call in another computer's conversation. */
export interface RemoteTool {
  id: string;
  name: string;
  input: unknown;
  /** Its result said it failed. */
  failed: boolean;
  /** What it gave back, as that computer sent it (`truncated`: cut short there); null while it runs. */
  result: { text: string; isError: boolean; truncated: boolean } | null;
}

/** What the conversation shows, in order: your prompts, Claude Code's own lines, Claude's text, and each run of tool calls as one item. */
export type RemoteItem =
  | { kind: 'user'; key: string; text: string; device: string | null; at: number | null }
  /** A line from Claude Code itself: a background task finishing, command output, an interrupt, a compaction. */
  | { kind: 'notice'; key: string; text: string }
  | { kind: 'text'; key: string; text: string }
  | { kind: 'tools'; key: string; tools: RemoteTool[] };

/**
 * The conversation as the local transcript lays it out: consecutive tool calls (across messages, as long as no text
 * or prompt comes between them) folded into one item, like `ActivityGroup`. Thinking isn't shown. `messages` is every
 * message, so tool results can say which calls failed.
 */
export function remoteItems(messages: readonly RemoteMessage[]): RemoteItem[] {
  const results = new Map<string, NonNullable<RemoteTool['result']>>();
  for (const m of messages) for (const b of m.blocks) if (b.type === 'tool_result') results.set(b.toolUseId, { text: b.text, isError: b.isError, truncated: b.truncated });
  const items: RemoteItem[] = [];
  for (const message of visibleMessages(messages)) {
    if (message.role === 'user') {
      const text = message.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : b.type === 'image' ? ['[image]'] : [])).join('\n\n');
      if (text.trim()) items.push({ kind: 'user', key: message.uuid, text, device: message.device ?? null, at: message.timestamp });
      continue;
    }
    if (message.role === 'system') {
      const text = message.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
      if (text.trim()) items.push({ kind: 'notice', key: message.uuid, text });
      continue;
    }
    message.blocks.forEach((block, index) => {
      if (block.type === 'text') {
        if (block.text.trim()) items.push({ kind: 'text', key: `${message.uuid}:${index}`, text: block.text });
      } else if (block.type === 'tool_use') {
        const result = results.get(block.id) ?? null;
        const tool = { id: block.id, name: block.name, input: block.input, failed: result?.isError === true, result };
        const last = items.at(-1);
        if (last?.kind === 'tools') last.tools.push(tool);
        else items.push({ kind: 'tools', key: `${message.uuid}:${index}`, tools: [tool] });
      }
    });
  }
  return items;
}

const EDITS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

/** One line of an edit's diff: taken away (`-`) or added (`+`). */
export interface RemoteDiffLine {
  kind: '+' | '-';
  text: string;
}

/**
 * The lines an edit takes away and adds, from its input (the old text, then the new one, for each edit), for the
 * opened step. Null for a call that is not an edit, or whose input doesn't say.
 */
export function remoteEditLines(name: string, input: unknown): RemoteDiffLine[] | null {
  const value = (input ?? {}) as Record<string, unknown>;
  const lines = (kind: '+' | '-', text: unknown): RemoteDiffLine[] => (typeof text === 'string' && text.length > 0 ? text.split('\n').map((line) => ({ kind, text: line })) : []);
  const edit = (old: unknown, next: unknown) => [...lines('-', old), ...lines('+', next)];
  if (name === 'Write') return typeof value.content === 'string' ? lines('+', value.content) : null;
  if (name === 'MultiEdit' && Array.isArray(value.edits)) return (value.edits as Array<Record<string, unknown> | null>).flatMap((e) => edit(e?.old_string, e?.new_string));
  if (name === 'Edit' && (typeof value.old_string === 'string' || typeof value.new_string === 'string')) return edit(value.old_string, value.new_string);
  if (name === 'NotebookEdit' && typeof value.new_source === 'string') return lines('+', value.new_source);
  return null;
}

const lineCount = (text: unknown): number => (typeof text === 'string' && text.length > 0 ? text.split('\n').length : 0);

/** Lines an edit adds and takes away, as far as its input tells: the new text against the old one. */
function editLines(name: string, input: Record<string, unknown>): { added: number; removed: number } {
  if (name === 'Write') return { added: lineCount(input.content), removed: 0 };
  if (name === 'MultiEdit' && Array.isArray(input.edits)) {
    return (input.edits as Array<Record<string, unknown> | null>).reduce<{ added: number; removed: number }>(
      (sum, edit) => ({ added: sum.added + lineCount(edit?.new_string), removed: sum.removed + lineCount(edit?.old_string) }),
      { added: 0, removed: 0 },
    );
  }
  return { added: lineCount(input.new_string ?? input.new_source), removed: lineCount(input.old_string) };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

type ToolCall = Pick<RemoteTool, 'name' | 'input'>;

/** Which part of the summary a call counts in: edits, searches, web and agents each as one, other tools by name. */
const kindOf = (name: string) =>
  EDITS.has(name) ? 'edit' : name === 'Grep' || name === 'Glob' ? 'search' : name === 'WebFetch' || name === 'WebSearch' ? 'web' : name === 'Task' || name === 'Agent' ? 'agent' : name;

/**
 * A run of tool calls as one line, from what each call says (`toolLine`): "Read 4 files · Edited ContentOverview.tsx
 * +42 −6 · Ran npm test", in the order each kind first came. One call (or one file) is named; more are counted.
 */
export function toolsSummary(tools: readonly ToolCall[]): string {
  const groups = new Map<string, ToolCall[]>();
  for (const tool of tools) {
    const kind = kindOf(tool.name);
    const group = groups.get(kind);
    if (group) group.push(tool);
    else groups.set(kind, [tool]);
  }
  return [...groups].map(([kind, calls]) => describeCalls(kind, calls)).join(' · ');
}

function describeCalls(kind: string, calls: readonly ToolCall[]): string {
  const first = calls[0]!;
  const line = toolLine(first.name, first.input);
  const input = (call: ToolCall) => (call.input ?? {}) as Record<string, unknown>;
  const files = new Set(calls.map((call) => String(input(call).file_path ?? input(call).notebook_path ?? '')));
  const fileName = files.size === 1 && typeof (input(first).file_path ?? input(first).notebook_path) === 'string' ? basename(String(input(first).file_path ?? input(first).notebook_path)) : null;
  const one = calls.length === 1;
  switch (kind) {
    case 'Read':
      return fileName ? `Read ${fileName}` : `Read ${plural(files.size, 'file', 'files')}`;
    case 'edit': {
      const lines = calls.reduce(
        (sum, call) => {
          const each = editLines(call.name, input(call));
          return { added: sum.added + each.added, removed: sum.removed + each.removed };
        },
        { added: 0, removed: 0 },
      );
      const counts = [lines.added ? `+${lines.added}` : '', lines.removed ? `−${lines.removed}` : ''].filter(Boolean).join(' ');
      return `Edited ${fileName ?? plural(files.size, 'file', 'files')}${counts ? ` ${counts}` : ''}`;
    }
    case 'Bash':
      return one && line ? `Ran ${line}` : `Ran ${plural(calls.length, 'command', 'commands')}`;
    case 'search':
      return one && line ? `Searched for ${line}` : `Searched ${plural(calls.length, 'time', 'times')}`;
    case 'web':
      return one && line ? `Looked up ${line}` : `Looked up ${plural(calls.length, 'page', 'pages')}`;
    case 'agent':
      return one && line ? `Ran an agent: ${line}` : `Ran ${plural(calls.length, 'agent', 'agents')}`;
    case 'TodoWrite':
      return 'Updated the to-do list';
    default:
      return one ? `Used ${first.name}` : `Used ${first.name} ${plural(calls.length, 'time', 'times')}`;
  }
}

/**
 * Its turn ended but a task it started still runs (`RemoteSession.background`): Claude carries on when that finishes,
 * so the view shows it at work, in the background's green, and Stop stops each task rather than a turn. Also while it
 * is unread, which its status says first. A computer from before the list only says so through the status. The same
 * rule as the remote app's (apps/remote/src/lib/background.ts).
 */
export function inBackground(session: Pick<RemoteSession, 'status' | 'background'>): boolean {
  if (session.status === 'working' || session.status === 'needs-you') return false;
  return session.status === 'background' || Boolean(session.background?.length);
}

/** The groups of the list, as the sidebar has them: what needs you, what is working, then the rest by time. */
export function sessionGroups(list: RemoteSessions | null): Array<{ key: 'needs-you' | 'working' | 'recent'; label: string; sessions: RemoteSession[] }> {
  if (!list) return [];
  const asking = new Set(list.prompts.map((p) => p.sessionId));
  const needs = list.sessions.filter((s) => s.status === 'needs-you' || asking.has(s.id));
  const working = list.sessions.filter((s) => !needs.includes(s) && (s.status === 'working' || s.status === 'background'));
  const recent = list.sessions.filter((s) => !needs.includes(s) && !working.includes(s));
  return [
    { key: 'needs-you' as const, label: 'Needs you', sessions: needs },
    { key: 'working' as const, label: 'Working', sessions: working },
    { key: 'recent' as const, label: 'Recent', sessions: recent },
  ].filter((group) => group.sessions.length > 0);
}

/** How many sessions on a computer wait for you. */
export function waitingCount(list: RemoteSessions | null | undefined): number {
  if (!list) return 0;
  const asking = new Set(list.prompts.map((p) => p.sessionId));
  return list.sessions.filter((s) => s.status === 'needs-you' || asking.has(s.id)).length;
}

/** The line under a computer's name: connected (or what it sent that this version can't read), trying, or why not. */
export function computerLine(computer: Computer, now = Date.now()): string {
  switch (computer.state) {
    case 'connected':
      return computer.problem ?? 'Connected';
    case 'connecting':
      return 'Connecting…';
    case 'unpaired':
      return computer.message ?? 'Pair it again.';
    case 'offline':
      return `${computer.message ?? 'Offline.'}${retryText(computer, now)}`;
  }
}

/** The computers that now say they sent what this version can't read, and didn't say so before: told once, in a toast. */
export function newProblems(before: readonly Pick<Computer, 'id' | 'problem'>[] | undefined, after: readonly Computer[]): Computer[] {
  return after.filter((computer) => computer.problem && before?.find((c) => c.id === computer.id)?.problem !== computer.problem);
}

/** " Trying again in 30s." while a retry is planned, else nothing. */
function retryText(computer: Pick<Computer, 'retryAt'>, now: number): string {
  const seconds = computer.retryAt ? Math.max(0, Math.ceil((computer.retryAt - now) / 1000)) : null;
  return seconds === null ? '' : seconds < 1 ? ' Trying again…' : ` Trying again in ${seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)} min`}.`;
}

/**
 * The banner over a remote session while its computer is away: "mystic is offline. Trying again in 30s.", or that it
 * is connecting, or that it has to be paired again. Null while connected.
 */
export function awayBanner(computer: Pick<Computer, 'name' | 'state' | 'retryAt'>, now = Date.now()): string | null {
  switch (computer.state) {
    case 'connected':
      return null;
    case 'connecting':
      return `Connecting to ${computer.name}…`;
    case 'unpaired':
      return `${computer.name} no longer knows this computer. Pair it again.`;
    case 'offline':
      return `${computer.name} is offline.${retryText(computer, now)}`;
  }
}

/**
 * Another computer's display items and turns, from its messages, by the same rules as this computer's (`buildDisplayItems`,
 * `buildTurns`): when each turn ended, how long it took and its tokens, from the usage the computer sent with each reply.
 * Its replies' items keep the keys the remote items use, so a turn's line and Read find their reply.
 */
export function remoteDisplay(messages: readonly RemoteMessage[]): { items: DisplayItem[]; turns: Turn[] } {
  const transcript: TranscriptMessage[] = messages.map((m) => ({
    uuid: m.uuid,
    role: m.role,
    timestamp: m.timestamp,
    parentToolUseId: m.parentToolUseId,
    model: null,
    usage: m.usage ? { id: m.usage.id, input: m.usage.input, output: m.usage.output, cacheRead: m.usage.cacheRead, cacheCreation: m.usage.cacheWrite } : null,
    blocks: m.blocks.map((b) => (b.type === 'tool_result' ? { ...b, images: [] } : b.type === 'image' ? { type: 'image' as const, mediaType: null, ref: null } : b)),
  }));
  const items = buildDisplayItems(transcript);
  return { items, turns: buildTurns(items) };
}

/** The turns of `remoteDisplay`. */
export function remoteTurns(messages: readonly RemoteMessage[]): Turn[] {
  return remoteDisplay(messages).turns;
}
