import { describe, expect, it } from 'vitest';
import { clearStreaming, flushStreaming, nextBlock, queueStream, resetStreaming, useStreaming } from './streamingStore.ts';

describe('streaming store', () => {
  it('grows text and thinking, replaces with a tool, and clears', () => {
    const text = nextBlock(undefined, { sessionId: 's', kind: 'text', text: 'Hel' });
    expect(nextBlock(text, { sessionId: 's', kind: 'text', text: 'lo' })).toEqual({ kind: 'text', text: 'Hello' });
    expect(nextBlock(text, { sessionId: 's', kind: 'thinking', text: 'Hm' })).toEqual({ kind: 'thinking', text: 'Hm' });
    expect(nextBlock(text, { sessionId: 's', kind: 'tool', text: 'Edit' })).toEqual({ kind: 'tool', text: 'Edit' });
    expect(nextBlock(text, { sessionId: 's', kind: 'clear', text: '' })).toBeUndefined();
  });

  it('applies the deltas of every session in one change per frame, and leaves other sessions’ blocks as they were', () => {
    resetStreaming();
    queueStream({ sessionId: 'a', kind: 'text', text: 'One' });
    queueStream({ sessionId: 'b', kind: 'text', text: 'Two' });
    flushStreaming();
    const before = useStreaming.getState().blocks;
    let changes = 0;
    const off = useStreaming.subscribe(() => changes++);
    queueStream({ sessionId: 'a', kind: 'text', text: ' more' });
    queueStream({ sessionId: 'a', kind: 'text', text: ' and more' });
    expect(changes).toBe(0);
    flushStreaming();
    off();
    const after = useStreaming.getState().blocks;
    expect(changes).toBe(1);
    expect(after.get('a')).toEqual({ kind: 'text', text: 'One more and more' });
    expect(after.get('b')).toBe(before.get('b'));
  });

  it('drops a session’s block and what waits for the next frame when it stops', () => {
    resetStreaming();
    queueStream({ sessionId: 'a', kind: 'text', text: 'One' });
    flushStreaming();
    queueStream({ sessionId: 'a', kind: 'text', text: ' more' });
    clearStreaming('a');
    flushStreaming();
    expect(useStreaming.getState().blocks.has('a')).toBe(false);
  });
});
