import type { RemoteMessage, RemoteTranscriptUpdate, StreamDelta } from '@seshboard/protocol/remote-client';

/**
 * A session's conversation on the phone, kept as a list of messages by uuid. Pure functions, so the merging is easy
 * to check: pages from `transcript.get`, live updates from `transcript.updated`, and what Claude is writing now.
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

/**
 * The messages worth showing on a small screen: the main conversation (subagents' own messages stay on the
 * computer), without messages that are only tool results, which show under their tool call instead.
 */
export function visibleMessages(messages: readonly RemoteMessage[]): RemoteMessage[] {
  return messages.filter((m) => m.parentToolUseId === null && m.blocks.some((b) => b.type !== 'tool_result'));
}

/** Tool results by the id of the call they answer, to show under it. */
export function resultsByCall(messages: readonly RemoteMessage[]) {
  const results = new Map<string, Extract<RemoteMessage['blocks'][number], { type: 'tool_result' }>>();
  for (const message of messages) for (const block of message.blocks) if (block.type === 'tool_result') results.set(block.toolUseId, block);
  return results;
}

/** The one line that says what a tool call does: its command, file or pattern. */
export function toolSummary(name: string, input: unknown): string {
  const value = (input ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof value[key] === 'string' ? (value[key] as string) : null);
  const line =
    text('command') ?? text('file_path') ?? text('path') ?? text('pattern') ?? text('url') ?? text('query') ?? text('description') ?? text('prompt') ?? '';
  const first = line.split('\n')[0]!.trim();
  return first.length > 120 ? `${first.slice(0, 117)}...` : first || name;
}

/** An edit as plain text lines, for the diff a phone shows: `-` removed, `+` added. */
export function editLines(name: string, input: unknown): Array<{ kind: '+' | '-'; text: string }> | null {
  const value = (input ?? {}) as Record<string, unknown>;
  if (name === 'Edit' && typeof value.old_string === 'string' && typeof value.new_string === 'string') {
    return [...value.old_string.split('\n').map((text) => ({ kind: '-' as const, text })), ...value.new_string.split('\n').map((text) => ({ kind: '+' as const, text }))];
  }
  if (name === 'Write' && typeof value.content === 'string') return value.content.split('\n').map((text) => ({ kind: '+' as const, text }));
  return null;
}
