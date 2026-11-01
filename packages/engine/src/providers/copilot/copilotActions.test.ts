import { describe, expect, it } from 'vitest';
import { backgroundTasks, effortsOf, forkBoundary, rewindOutcome, rewindPreview } from './copilotActions.ts';
import type { CopilotEvent } from './copilotEvents.ts';

const events: CopilotEvent[] = [
  { type: 'session.start', id: 'e1' },
  { type: 'user.message', id: 'u1', data: { content: 'Fix it' } },
  { type: 'assistant.message', id: 'a1', data: { content: 'Looking.', toolRequests: [{ toolCallId: 't1', name: 'view' }, { toolCallId: 't2', name: 'bash' }] } },
  { type: 'tool.execution_complete', id: 'r1', data: { toolCallId: 't1' } },
  // Copilot's own bookkeeping between them, written without an id.
  { type: 'session.info' },
  { type: 'tool.execution_complete', id: 'r2', data: { toolCallId: 't2' } },
  { type: 'assistant.message', id: 'a2', data: { content: 'Fixed.' } },
  { type: 'user.message', id: 'u2', data: { content: 'Thanks' } },
];

describe('forkBoundary', () => {
  it('ends just after the message, past the results of the tools it asked for', () => {
    expect(forkBoundary(events, 'a1')).toBe('a2');
    expect(forkBoundary(events, 'a2')).toBe('u2');
    expect(forkBoundary(events, 'u1')).toBe('a1');
  });

  it('keeps everything for the last message, and knows nothing of other ids', () => {
    expect(forkBoundary(events, 'u2')).toBeNull();
    expect(forkBoundary(events, 'gone')).toBeUndefined();
  });

  it('finds a message the converter named by its place, and skips events without an id', () => {
    // `copilot-4` is the event without an id; the boundary is the next one that has one.
    expect(forkBoundary(events, 'copilot-4')).toBe('r2');
    expect(forkBoundary(events, 'r1')).toBe('r2');
  });
});

describe('Copilot rewind', () => {
  it('previews the files and lines that go back', () => {
    expect(
      rewindPreview({
        available: true,
        files: [
          { path: '/w/a.ts', linesAdded: 3, linesRemoved: 1 },
          { path: '/w/b.ts', linesAdded: 0, linesRemoved: 4 },
        ],
      }),
    ).toEqual({ canRewind: true, error: null, files: ['/w/a.ts', '/w/b.ts'], insertions: 3, deletions: 5 });
  });

  it('says why, in words, when it cannot', () => {
    expect(rewindPreview({ available: false, reason: 'session-busy', files: [] })).toMatchObject({ canRewind: false, error: 'Copilot is still working. Rewind once it finishes.' });
    expect(rewindPreview({ available: false, reason: 'something-new', files: [] }).error).toBe("Copilot can't rewind this session.");
    expect(rewindOutcome({ outcome: 'truncation-failed', restoredFiles: ['/w/a.ts'] })).toMatchObject({ canRewind: false, error: "Restored the files, but couldn't rewind the conversation." });
    expect(rewindOutcome({ outcome: 'weird', restoredFiles: [], error: 'Disk full' }).error).toBe('Disk full');
  });

  it('counts a rewind whose clean-up failed as done', () => {
    expect(rewindOutcome({ outcome: 'snapshot-prune-failed', restoredFiles: ['/w/a.ts'], error: 'EBUSY' })).toEqual({ canRewind: true, error: null, files: ['/w/a.ts'], insertions: 0, deletions: 0 });
  });
});

describe('Copilot background tasks', () => {
  it('keeps running background work, as Claude Code task types', () => {
    const started = '2026-10-30T10:00:00.000Z';
    expect(
      backgroundTasks([
        { type: 'shell', id: 's1', description: '', command: 'npm run dev', status: 'running', startedAt: started, attachmentMode: 'detached' },
        { type: 'shell', id: 's2', description: 'npm test', status: 'running', startedAt: started, attachmentMode: 'attached' },
        { type: 'agent', id: 'g1', description: 'Review', status: 'idle', startedAt: started, executionMode: 'background' },
        { type: 'workflow', id: 'w1', description: 'Deploy', status: 'running', startedAt: 'soon', executionMode: 'background' },
      ]),
    ).toEqual([
      { taskId: 's1', type: 'local_bash', description: 'npm run dev', startedAt: Date.parse(started) },
      { taskId: 'w1', type: 'workflow', description: 'Deploy', startedAt: expect.any(Number) },
    ]);
  });
});

describe('effortsOf', () => {
  it('keeps the levels Seshboard knows', () => {
    expect(effortsOf(['low', 'medium', 'turbo', 'xhigh'])).toEqual(['low', 'medium', 'xhigh']);
    expect(effortsOf(undefined)).toBeUndefined();
  });
});
