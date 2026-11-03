import { describe, expect, it } from 'vitest';
import type { OptionalProvider, ProviderUpdateState } from '@seshboard/protocol';
import { appStateFake } from '../system/testing.ts';
import { copilotUpdater } from './copilot/copilotUpdate.ts';
import { ProviderUpdates } from './providerUpdates.ts';

describe('ProviderUpdates', () => {
  it("checks a provider's CLI while it has a profile, and stops when its last profile goes", async () => {
    let providers: OptionalProvider[] = [];
    const broadcasts: ProviderUpdateState[][] = [];
    const updates = new ProviderUpdates({
      providers: () => providers,
      create: (_provider, onChange) =>
        copilotUpdater({
          store: appStateFake(),
          binary: async () => ({ path: '/usr/local/bin/copilot', version: '1.0.90' }),
          env: async () => ({}),
          ready: Promise.resolve(),
          onChange,
          log: () => {},
          version: async () => 'GitHub Copilot CLI 1.0.90\nUpdate available: 1.0.105\n',
        }),
      automatic: false,
      onChange: (list) => broadcasts.push(list),
    });
    updates.sync();
    expect(updates.list()).toEqual([]);
    expect(broadcasts).toEqual([]);
    expect(() => updates.get('copilot')).toThrow(/No copilot profile/);

    providers = ['copilot'];
    updates.sync();
    expect(broadcasts.at(-1)?.map((s) => [s.provider, s.status])).toEqual([['copilot', 'idle']]);
    await updates.get('copilot').check();
    expect(broadcasts.at(-1)?.[0]).toMatchObject({ status: 'available', latestVersion: '1.0.105' });
    // Another profile of the same provider changes nothing.
    const count = broadcasts.length;
    updates.sync();
    expect(broadcasts.length).toBe(count);

    providers = [];
    updates.sync();
    expect(broadcasts.at(-1)).toEqual([]);
    updates.close();
  });
});
