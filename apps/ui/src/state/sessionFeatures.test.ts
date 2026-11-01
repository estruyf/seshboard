import { describe, expect, it } from 'vitest';
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
});
