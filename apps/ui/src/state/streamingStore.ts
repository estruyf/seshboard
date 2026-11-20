import { useMemo } from 'react';
import { create } from 'zustand';
import { nextStreamBlock, type StreamDelta } from '@seshboard/protocol/client';

export interface StreamingBlock {
  kind: 'text' | 'thinking' | 'tool';
  text: string;
}

interface StreamingState {
  /** The block Claude is writing right now, per session. A session's block is a new object only when it changed. */
  blocks: ReadonlyMap<string, StreamingBlock>;
}

/**
 * What Claude is writing right now, apart from the hosts: text comes about 30 times a second while a reply streams,
 * and only the streaming block (and a few lines that show its kind) read it. Deltas are applied once per frame, for
 * every session in one change, so a window that isn't drawing (hidden, minimised) doesn't commit them until it is.
 */
export const useStreaming = create<StreamingState>()(() => ({ blocks: new Map() }));

/** The block after a delta (`nextStreamBlock`, the same as the engine's). */
export const nextBlock = (current: StreamingBlock | undefined, delta: StreamDelta): StreamingBlock | undefined => nextStreamBlock(current, delta);

/** Deltas since the last frame, already applied per session (undefined: cleared). */
let pending: Map<string, StreamingBlock | undefined> | null = null;
let scheduled: (() => void) | null = null;

function schedule(): void {
  if (scheduled) return;
  // Without frames (tests), soon enough.
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(flushStreaming);
    scheduled = () => cancelAnimationFrame(id);
  } else {
    const id = setTimeout(flushStreaming, 16);
    scheduled = () => clearTimeout(id);
  }
}

/** Takes a `session.stream` delta; it shows at the next frame. */
export function queueStream(delta: StreamDelta): void {
  pending ??= new Map();
  const base = pending.has(delta.sessionId) ? pending.get(delta.sessionId) : useStreaming.getState().blocks.get(delta.sessionId);
  pending.set(delta.sessionId, nextBlock(base, delta));
  schedule();
}

/** Applies what came since the last frame, in one change. */
export function flushStreaming(): void {
  scheduled = null;
  const changes = pending;
  pending = null;
  if (!changes?.size) return;
  const blocks = new Map(useStreaming.getState().blocks);
  for (const [sessionId, block] of changes) {
    if (block) blocks.set(sessionId, block);
    else blocks.delete(sessionId);
  }
  useStreaming.setState({ blocks });
}

/** The session stopped writing (its turn ended, it closed or failed): its block goes now, with what was waiting. */
export function clearStreaming(sessionId: string): void {
  pending?.delete(sessionId);
  if (!useStreaming.getState().blocks.has(sessionId)) return;
  const blocks = new Map(useStreaming.getState().blocks);
  blocks.delete(sessionId);
  useStreaming.setState({ blocks });
}

/** A new connection to the engine: nothing streams yet. */
export function resetStreaming(): void {
  scheduled?.();
  scheduled = null;
  pending = null;
  useStreaming.setState({ blocks: new Map() });
}

/**
 * What a session streams, for lines that only say what Claude is doing (Thinking, Using Edit): the kind, and a tool's
 * name, without the text. Text growing doesn't render them again.
 */
export function useStreamingKind(sessionId: string): StreamingBlock | undefined {
  const shape = useStreaming((s) => {
    const block = s.blocks.get(sessionId);
    return !block ? null : block.kind === 'tool' ? `tool:${block.text}` : block.kind;
  });
  return useMemo(() => (shape === null ? undefined : shape === 'text' || shape === 'thinking' ? { kind: shape, text: '' } : { kind: 'tool', text: shape.slice('tool:'.length) }), [shape]);
}
