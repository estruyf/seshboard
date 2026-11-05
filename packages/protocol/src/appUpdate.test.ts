import { describe, expect, it } from 'vitest';
import { channelOf, compareVersions, remoteUpdateFor } from './appUpdate.ts';

const stableHere = { version: '1.2.0', availableVersion: null, channel: 'stable' as const };
const there = (version: string | null, update: { availableVersion?: string | null; downloadedVersion?: string | null; channel?: 'stable' | 'beta' } | null = {}) => ({
  version,
  update: update ? { availableVersion: update.availableVersion ?? null, downloadedVersion: update.downloadedVersion ?? null, channel: update.channel ?? 'stable' } : null,
});

describe('compareVersions', () => {
  it('orders releases, and a beta before its release, by number', () => {
    expect(compareVersions('1.3.0', '1.2.9')).toBeGreaterThan(0);
    expect(compareVersions('1.3.0-beta.19', '1.3.0')).toBeLessThan(0);
    expect(compareVersions('1.3.0-beta.9', '1.3.0-beta.19')).toBeLessThan(0);
    expect(compareVersions('1.3.0', '1.3.0')).toBe(0);
    expect(compareVersions('demo', '1.3.0')).toBe(0);
  });

  it('knows the channel from the version', () => {
    expect(channelOf('1.3.0-beta.2')).toBe('beta');
    expect(channelOf('1.3.0')).toBe('stable');
  });
});

describe('remoteUpdateFor', () => {
  it('is behind what it found itself', () => {
    expect(remoteUpdateFor(there('1.1.0', { availableVersion: '1.2.0' }), stableHere)).toEqual({ kind: 'behind', version: '1.2.0', source: 'there' });
    expect(remoteUpdateFor(there('1.1.0', { downloadedVersion: '1.1.5' }), { ...stableHere, version: '1.1.0' })).toEqual({ kind: 'behind', version: '1.1.5', source: 'there' });
  });

  it('is behind what this Mac knows, its feed or its own version, before it checked', () => {
    expect(remoteUpdateFor(there('1.1.0'), stableHere)).toEqual({ kind: 'behind', version: '1.2.0', source: 'here' });
    expect(remoteUpdateFor(there('1.1.0'), { ...stableHere, availableVersion: '1.2.1' })).toEqual({ kind: 'behind', version: '1.2.1', source: 'here' });
    // An older version, from before updating from here, with no updater to read.
    expect(remoteUpdateFor(there('1.0.0', null), stableHere)).toEqual({ kind: 'behind', version: '1.2.0', source: 'here' });
  });

  it('takes the newer of the two, and there when both know the same', () => {
    expect(remoteUpdateFor(there('1.1.0', { availableVersion: '1.2.0' }), { ...stableHere, availableVersion: '1.2.1' })).toEqual({ kind: 'behind', version: '1.2.1', source: 'here' });
    expect(remoteUpdateFor(there('1.1.0', { availableVersion: '1.2.0' }), stableHere)).toMatchObject({ source: 'there' });
  });

  it('counts a beta known here only for a computer on Beta', () => {
    const betaHere = { version: '1.3.0-beta.19', availableVersion: '1.3.0-beta.20', channel: 'beta' as const };
    expect(remoteUpdateFor(there('1.2.0', { channel: 'stable' }), betaHere)).toEqual({ kind: 'none' });
    expect(remoteUpdateFor(there('1.3.0-beta.18', { channel: 'beta' }), betaHere)).toEqual({ kind: 'behind', version: '1.3.0-beta.20', source: 'here' });
    // No updater to read: its own version says its channel.
    expect(remoteUpdateFor(there('1.3.0-beta.18', null), betaHere)).toMatchObject({ kind: 'behind', version: '1.3.0-beta.20' });
  });

  it('says nothing for the same version or one it can not read', () => {
    expect(remoteUpdateFor(there('1.2.0'), stableHere)).toEqual({ kind: 'none' });
    expect(remoteUpdateFor(there(null), stableHere)).toEqual({ kind: 'none' });
    expect(remoteUpdateFor(there('demo'), stableHere)).toEqual({ kind: 'none' });
    expect(remoteUpdateFor(there('1.1.0'), { ...stableHere, version: 'dev' })).toEqual({ kind: 'none' });
  });

  it('is ahead of this Mac only on a channel this Mac gets', () => {
    expect(remoteUpdateFor(there('1.2.5'), stableHere)).toEqual({ kind: 'ahead', version: '1.2.5' });
    expect(remoteUpdateFor(there('1.3.0-beta.2', { channel: 'beta' }), stableHere)).toEqual({ kind: 'none' });
    expect(remoteUpdateFor(there('1.3.0-beta.2', { channel: 'beta' }), { ...stableHere, channel: 'beta' })).toEqual({ kind: 'ahead', version: '1.3.0-beta.2' });
  });
});
