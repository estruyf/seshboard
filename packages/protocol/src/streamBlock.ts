/** What a session is writing now, built from `session.stream` deltas. */
export interface StreamBlock {
  kind: 'text' | 'thinking' | 'tool';
  text: string;
}

/**
 * The block after a delta: `clear` ends it, a tool replaces it, text and thinking grow it (or start a new one). The
 * engine keeps one per session with it (a view that starts watching mid-reply gets the whole block) and so does every
 * window. Pure, with tests.
 */
export function nextStreamBlock(current: StreamBlock | undefined, delta: { kind: 'text' | 'thinking' | 'tool' | 'clear'; text: string }): StreamBlock | undefined {
  if (delta.kind === 'clear') return undefined;
  if (delta.kind === 'tool') return { kind: 'tool', text: delta.text };
  if (current?.kind === delta.kind) return { kind: delta.kind, text: current.text + delta.text };
  return { kind: delta.kind, text: delta.text };
}
