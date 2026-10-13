import { describe, expect, it } from 'vitest';
import type { LaterItem } from '@switchboard/protocol/client';
import { queueHint } from './queueHint.ts';

const item = (id: string, overrides: Partial<LaterItem> = {}): LaterItem => ({
  id,
  cwd: '/work/app',
  prompt: `Prompt ${id}`,
  attachments: [],
  typed: null,
  context: [],
  model: null,
  effort: null,
  permissionMode: 'default',
  workspace: 'current',
  baseRef: 'fresh',
  branch: null,
  profileId: null,
  createdAt: 0,
  position: 0,
  waitFor: { kind: 'project' },
  ...overrides,
});

describe('queue hint on "Claude finished"', () => {
  it('names the first item waiting on the session, its project or the item it came from', () => {
    const items = [item('none', { waitFor: { kind: 'none' } }), item('other', { cwd: '/work/other' }), item('here')];
    expect(queueHint(items, [], { sessionId: 's1', cwd: '/work/app' })).toBe('Next in the queue: Prompt here');
    // A worktree of the project counts as the project.
    expect(queueHint(items, [], { sessionId: 's1', cwd: '/work/app/.claude/worktrees/fix' })).toBe('Next in the queue: Prompt here');
    expect(queueHint([item('mine', { cwd: '/x', waitFor: { kind: 'session', sessionId: 's1' } })], [], { sessionId: 's1', cwd: null })).toBe('Next in the queue: Prompt mine');
    expect(queueHint([item('chain', { cwd: '/x', waitFor: { kind: 'item', itemId: 'started' } })], [{ itemId: 'started', sessionId: 's1' }], { sessionId: 's1', cwd: null })).toBe('Next in the queue: Prompt chain');
  });

  it('says nothing without a match, and never for items that wait for nothing', () => {
    expect(queueHint([item('none', { waitFor: { kind: 'none' } })], [], { sessionId: 's1', cwd: '/work/app' })).toBeNull();
    expect(queueHint([item('other', { cwd: '/work/other' })], [], { sessionId: 's1', cwd: '/work/app' })).toBeNull();
    expect(queueHint([], [], { sessionId: 's1', cwd: '/work/app' })).toBeNull();
  });

  it('keeps the first line, shortened', () => {
    const long = item('long', { prompt: `${'a'.repeat(100)}\nsecond line` });
    expect(queueHint([long], [], { sessionId: 's1', cwd: '/work/app' })).toBe(`Next in the queue: ${'a'.repeat(79)}…`);
  });
});
