import { beforeEach, describe, expect, it } from 'vitest';
import type { SessionSummary } from '@seshboard/protocol/client';
import { saveNote } from './sessionNotes.ts';
import { useSessions } from './sessionsStore.ts';

const summary = { id: 'a', title: 'a', note: 'push after review' } as SessionSummary;
const noteOf = () => useSessions.getState().sessions.get('a')?.note ?? null;

describe('saveNote', () => {
  beforeEach(() => useSessions.setState({ sessions: new Map([['a', summary]]) }));

  it('shows the note at once and keeps it once the engine saved it', async () => {
    const calls: unknown[] = [];
    await saveNote({ call: async (_m, params) => void calls.push(params) }, 'a', '  waiting on Jan ');
    expect(noteOf()).toBe('waiting on Jan');
    expect(calls).toEqual([{ sessionId: 'a', note: 'waiting on Jan' }]);
  });

  it('puts the note it had back when saving fails', async () => {
    await expect(saveNote({ call: async () => Promise.reject(new Error('offline')) }, 'a', 'new')).rejects.toThrow('offline');
    expect(noteOf()).toBe('push after review');
    await expect(saveNote(null, 'a', null)).rejects.toThrow('Not connected');
    expect(noteOf()).toBe('push after review');
  });
});
