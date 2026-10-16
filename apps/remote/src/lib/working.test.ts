import { describe, expect, it } from 'vitest';
import type { RemoteMessage } from '@switchboard/protocol/remote-client';
import { formatDuration, turnStart, workingLabel } from './working.ts';

const message = (uuid: string, role: RemoteMessage['role'], timestamp: number, blocks: RemoteMessage['blocks']): RemoteMessage => ({ uuid, role, timestamp, parentToolUseId: null, blocks });

describe('Working line', () => {
  it('says how long the turn has taken', () => {
    expect(formatDuration(9_200)).toBe('9s');
    expect(formatDuration(252_000)).toBe('4m 12s');
    expect(formatDuration(3_900_000)).toBe('1h 5m');
    expect(formatDuration(-5)).toBe('0s');
  });

  it('times the turn from your last message, not from tool results', () => {
    const messages = [
      message('a', 'user', 1_000, [{ type: 'text', text: 'Fix it' }]),
      message('b', 'assistant', 2_000, [{ type: 'tool_use', id: 't1', name: 'Bash', input: {}, truncated: false }]),
      message('c', 'user', 3_000, [{ type: 'tool_result', toolUseId: 't1', isError: false, text: 'ok', truncated: false }]),
    ];
    expect(turnStart(messages)).toBe(1_000);
    expect(turnStart([...messages, message('d', 'user', 4_000, [{ type: 'image' }])])).toBe(4_000);
    // A background task finishing starts a turn too.
    expect(turnStart([...messages, message('e', 'system', 5_000, [{ type: 'text', text: 'Background command "x" completed' }])])).toBe(5_000);
    expect(turnStart([])).toBeNull();
  });

  it('says what Claude is doing', () => {
    expect(workingLabel({ kind: null, text: '' })).toBe('Working');
    expect(workingLabel({ kind: 'thinking', text: 'Hmm' })).toBe('Thinking');
    expect(workingLabel({ kind: 'tool', text: 'Bash' })).toBe('Using Bash');
  });
});
