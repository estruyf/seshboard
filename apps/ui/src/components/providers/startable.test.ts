import { describe, expect, it } from 'vitest';
import { providerCanStart, startableProfiles, stepToolProfiles } from './startable.ts';

const catalog = [
  { id: 'copilot' as const, canStart: true },
  { id: 'codex' as const, canStart: false },
];
const profiles = [
  { id: 'default', provider: 'claude' as const },
  { id: 'copilot', provider: 'copilot' as const },
  { id: 'codex', provider: 'codex' as const },
];

describe('which providers can start a session', () => {
  it('is Claude Code always, another provider when its catalog entry says so', () => {
    expect(providerCanStart('claude', [])).toBe(true);
    expect(providerCanStart('copilot', catalog)).toBe(true);
    expect(providerCanStart('codex', catalog)).toBe(false);
  });

  it('is no for another provider while the catalog has not loaded', () => {
    expect(providerCanStart('copilot', [])).toBe(false);
  });
});

describe('the profiles offered to start a session', () => {
  it('leaves out the profiles of a read-only provider', () => {
    expect(startableProfiles(profiles, catalog).map((p) => p.id)).toEqual(['default', 'copilot']);
  });

  it('keeps the one picked now, so the choice never shows empty', () => {
    expect(startableProfiles(profiles, catalog, 'codex').map((p) => p.id)).toEqual(['default', 'copilot', 'codex']);
  });
});

describe("a pipeline step's other tools", () => {
  it('are the providers that can start sessions and have a profile, with their first profile', () => {
    const two = [...profiles, { id: 'copilot-2', provider: 'copilot' as const }];
    expect(stepToolProfiles(two, catalog).map((t) => [t.info.id, t.profileId])).toEqual([['copilot', 'copilot']]);
    expect(stepToolProfiles([{ id: 'default', provider: 'claude' }], catalog)).toEqual([]);
  });
});
