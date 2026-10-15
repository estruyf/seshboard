import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPair } from '@switchboard/protocol';
import { openCacheDatabase } from '../db/database.ts';
import { DEVICE_EXPIRY_MS, DeviceStore } from './devices.ts';
import { Pairing, PAIRING_CONFIRM_MS, PAIRING_MAX_FAILURES, PAIRING_OFFER_MS, type PairingState } from './pairing.ts';

describe('pairing', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  const make = () => {
    const states: PairingState[] = [];
    return { pairing: new Pairing((state) => states.push(state)), states };
  };

  it('offers a secret for two minutes', () => {
    const { pairing } = make();
    expect(pairing.psk()).toBeNull();
    pairing.start();
    expect(pairing.psk()).toHaveLength(32);
    vi.advanceTimersByTime(PAIRING_OFFER_MS);
    expect(pairing.psk()).toBeNull();
    expect(pairing.state().offer).toBeNull();
  });

  it('lets the secret be used once', () => {
    const { pairing } = make();
    pairing.start();
    expect(pairing.claim()).toBe(true);
    expect(pairing.claim()).toBe(false);
    expect(pairing.psk()).toBeNull();
  });

  it('gives each QR code its own secret', () => {
    const { pairing } = make();
    const first = pairing.start().secret;
    const second = pairing.start().secret;
    expect(first).not.toEqual(second);
  });

  it('closes after too many failures, until Pair a device is clicked again', () => {
    const { pairing } = make();
    pairing.start();
    for (let i = 0; i < PAIRING_MAX_FAILURES - 1; i++) pairing.failed();
    expect(pairing.psk()).not.toBeNull();
    pairing.failed();
    expect(pairing.state()).toEqual({ offer: null, request: null, locked: true });
    pairing.start();
    expect(pairing.state().locked).toBe(false);
  });

  it('asks on the Mac, and takes no answer for a no', async () => {
    const { pairing, states } = make();
    pairing.start();
    pairing.claim();
    const allowed = pairing.ask('Phone', '123456');
    const request = pairing.state().request!;
    expect(request).toMatchObject({ name: 'Phone', code: '123456' });
    expect(pairing.decide('someone-else', true)).toBe(false);
    expect(pairing.decide(request.id, true)).toBe(true);
    await expect(allowed).resolves.toBe(true);

    const timedOut = pairing.ask('Phone', '654321');
    vi.advanceTimersByTime(PAIRING_CONFIRM_MS);
    await expect(timedOut).resolves.toBe(false);

    const cancelled = pairing.ask('Phone', '000000');
    pairing.cancel();
    await expect(cancelled).resolves.toBe(false);
    expect(states.at(-1)).toEqual({ offer: null, request: null, locked: false });
  });
});

describe('paired devices', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => cleanups.splice(0).forEach((c) => c()));

  const store = () => {
    const dir = mkdtempSync(join(tmpdir(), 'switchboard-devices-'));
    const cache = openCacheDatabase(join(dir, 'cache.sqlite'));
    cleanups.push(() => (cache.close(), rmSync(dir, { recursive: true, force: true })));
    const clock = { now: 1_000 };
    return { devices: new DeviceStore(cache.db, () => clock.now), clock };
  };

  it('finds a paired key, and nothing else', () => {
    const { devices } = store();
    const key = generateKeyPair().publicKey;
    const device = devices.add('Phone', key);
    expect(devices.find(key)).toEqual(device);
    expect(devices.find(generateKeyPair().publicKey)).toBeNull();
  });

  it('refuses a revoked device, and lets it pair again as a new one', () => {
    const { devices } = store();
    const key = generateKeyPair().publicKey;
    const old = devices.add('Phone', key);
    expect(devices.revoke(old.id)).toBe(true);
    expect(devices.revoke(old.id)).toBe(false);
    expect(devices.find(key)).toBeNull();
    expect(devices.list()).toEqual([]);
    const again = devices.add('Phone', key);
    expect(again.id).not.toBe(old.id);
    expect(devices.find(key)?.id).toBe(again.id);
  });

  it('lets a device that was not used for 30 days expire', () => {
    const { devices, clock } = store();
    const key = generateKeyPair().publicKey;
    const device = devices.add('Phone', key);
    clock.now += DEVICE_EXPIRY_MS - 1;
    devices.touch(device.id);
    clock.now += DEVICE_EXPIRY_MS - 1;
    expect(devices.find(key)).not.toBeNull();
    clock.now += 1;
    expect(devices.find(key)).toBeNull();
    expect(devices.list()).toEqual([]);
  });
});
