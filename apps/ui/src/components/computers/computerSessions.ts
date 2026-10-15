import type { Computer, RemoteMessage, RemoteSession, RemoteSessions, RemoteTranscriptUpdate, StreamDelta } from '@switchboard/protocol/client';

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

/** The line under a computer's name: connected, trying, or why not. */
export function computerLine(computer: Computer, now = Date.now()): string {
  switch (computer.state) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting…';
    case 'unpaired':
      return computer.message ?? 'Pair it again.';
    case 'offline': {
      const seconds = computer.retryAt ? Math.max(0, Math.ceil((computer.retryAt - now) / 1000)) : null;
      const retry = seconds === null ? '' : seconds < 1 ? ' Trying again…' : ` Trying again in ${seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)} min`}.`;
      return `${computer.message ?? 'Offline.'}${retry}`;
    }
  }
}
