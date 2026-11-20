import { describe, expect, it } from 'vitest';
import type { ProviderFeature } from '@seshboard/protocol/client';
import { sessionCan } from './sessionFeatures.ts';

describe('sessionCan', () => {
  const providers = [{ id: 'copilot' as const, supports: ['rename' as const, 'delete' as const] }];

  it("always lets Claude Code's sessions, and another provider's only what it has", () => {
    expect(sessionCan({}, 'pipeline', providers)).toBe(true);
    expect(sessionCan(null, 'rename', providers)).toBe(true);
    expect(sessionCan({ provider: 'copilot' }, 'rename', providers)).toBe(true);
    expect(sessionCan({ provider: 'copilot' }, 'pipeline', providers)).toBe(false);
    // Providers not loaded yet: nothing of Claude Code's is offered for it.
    expect(sessionCan({ provider: 'copilot' }, 'rename', [])).toBe(false);
  });

  it("follows Codex's supports as the engine flips them on, with nothing of Codex's own", () => {
    // Phase 2's list, then the session actions Phase 3 adds (flipped here, not in the registry).
    const base: ProviderFeature[] = ['delete', 'effort', 'worktree', 'branch', 'later', 'schedule', 'trigger'];
    const phase2 = [{ id: 'codex' as const, supports: base }];
    const phase3 = [{ id: 'codex' as const, supports: [...base, 'fork', 'ask', 'rename'] as ProviderFeature[] }];
    for (const feature of ['fork', 'ask', 'rename'] as const) {
      expect(sessionCan({ provider: 'codex' }, feature, phase2)).toBe(false);
      expect(sessionCan({ provider: 'codex' }, feature, phase3)).toBe(true);
    }
    expect(sessionCan({ provider: 'codex' }, 'rewind', phase3)).toBe(false);
  });
});
