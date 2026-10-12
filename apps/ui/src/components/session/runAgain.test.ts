import { describe, expect, it, vi } from 'vitest';
import type { DisplayItem } from '../transcript/displayItems.ts';
import { runAgain, type RunAgainDeps } from './runAgain.ts';

const ITEMS: DisplayItem[] = [
  { kind: 'user', key: 'u1', at: 1, text: 'Plan the checkout refactor', images: [{ imageId: 'i1', mediaType: 'image/png', bytes: 10 }, { imageId: 'i2', mediaType: 'image/tiff', bytes: 10 }], subagent: false },
  { kind: 'text', key: 't1', at: 2, text: 'On it.', subagent: false },
  { kind: 'user', key: 'u2', at: 3, text: 'And the tests', images: [], subagent: false },
];

function deps() {
  const calls: string[] = [];
  return {
    calls,
    image: vi.fn(async (id: string) => ({ mediaType: id === 'i1' ? 'image/png' : 'image/tiff', data: `data-${id}` })),
    createSession: vi.fn(async () => (calls.push('create'), { sessionId: 'new-1' })),
    interrupt: vi.fn(() => void calls.push('interrupt')),
    open: vi.fn(() => void calls.push('open')),
    archive: vi.fn(() => void calls.push('archive')),
  } satisfies RunAgainDeps & { calls: string[] };
}

describe('runAgain', () => {
  it('starts the first prompt with its images on the other model, then archives the original', async () => {
    const fake = deps();
    const host = { cwd: '/work/app/.claude/worktrees/a', state: 'running', permissionMode: 'acceptEdits' as const, effort: 'high' as const, profileId: 'work' };
    expect(await runAgain({ items: ITEMS, model: 'opus', cwd: '/work/app', host }, fake)).toBe('new-1');
    expect(fake.createSession).toHaveBeenCalledWith({
      cwd: '/work/app/.claude/worktrees/a',
      prompt: 'Plan the checkout refactor',
      // An image type a new prompt can't carry is left out.
      attachments: [{ type: 'image', mediaType: 'image/png', data: 'data-i1' }],
      model: 'opus',
      permissionMode: 'acceptEdits',
      effort: 'high',
      profileId: 'work',
    });
    expect(fake.calls).toEqual(['create', 'interrupt', 'open', 'archive']);
  });

  it('works for a session that is not running, and archives nothing when starting fails', async () => {
    const fake = deps();
    await runAgain({ items: ITEMS, model: 'haiku', cwd: '/work/app', host: null }, fake);
    expect(fake.createSession).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/work/app', permissionMode: 'default', effort: null, profileId: null }));
    expect(fake.calls).toEqual(['create', 'open', 'archive']);
    const failing = { ...deps(), createSession: vi.fn(async () => Promise.reject(new Error('Folder not found'))) };
    await expect(runAgain({ items: ITEMS, model: 'opus', cwd: '/work/app' }, failing)).rejects.toThrow('Folder not found');
    expect(failing.archive).not.toHaveBeenCalled();
  });
});
