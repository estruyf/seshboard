import type { RemoteMessage } from '@switchboard/protocol/remote-client';
import type { Streaming } from './transcript.ts';

/**
 * The line at the end of a conversation while Claude works, as on the computer (apps/ui `TranscriptView`'s
 * `StreamingBlock`): how long the turn has taken and what Claude is doing now. Pure, with tests.
 */

/** 9s, 4m 12s, 1h 5m. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/**
 * When your last message went in (null: not known), for the "9s · Thinking" timer. Tool results don't count; a line from
 * Claude Code (a background task finishing) does, as it starts a turn too.
 */
export function turnStart(messages: readonly RemoteMessage[]): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== 'assistant' && !message.parentToolUseId && message.blocks.some((b) => b.type === 'text' || b.type === 'image')) return message.timestamp;
  }
  return null;
}

/** What Claude is doing: thinking, using a tool, or just working. */
export function workingLabel(streaming: Streaming): string {
  if (streaming.kind === 'thinking') return 'Thinking';
  if (streaming.kind === 'tool' && streaming.text) return `Using ${streaming.text}`;
  return 'Working';
}
