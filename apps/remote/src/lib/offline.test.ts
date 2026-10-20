import { describe, expect, it } from 'vitest';
import { isQuickTunnel, offlineHelp, offlineLine, offlineReason } from './offline.ts';

const QUICK = 'https://quiet-river.trycloudflare.com';
const NAMED = 'https://remote.example.com';

describe('offlineReason', () => {
  it('says the phone has no network first', () => {
    expect(offlineReason({ online: false, address: QUICK, failure: { kind: 'timeout' } })).toBe('no-network');
  });

  it('takes a timeout or a slow failure for a computer that sleeps', () => {
    expect(offlineReason({ online: true, address: QUICK, failure: { kind: 'timeout' } })).toBe('asleep');
    expect(offlineReason({ online: true, address: NAMED, failure: { kind: 'refused', elapsedMs: 8_000 } })).toBe('asleep');
  });

  it('takes a quick refusal of a quick tunnel for a changed address, and of another tunnel for Switchboard being off', () => {
    expect(offlineReason({ online: true, address: QUICK, failure: { kind: 'refused', elapsedMs: 300 } })).toBe('address');
    expect(offlineReason({ online: true, address: NAMED, failure: { kind: 'refused', elapsedMs: 300 } })).toBe('tunnel');
  });

  it('has no reason for a connection that dropped', () => {
    expect(offlineReason({ online: true, address: QUICK, failure: { kind: 'dropped' } })).toBe('unknown');
  });
});

describe('offline wording', () => {
  it('names the computer', () => {
    expect(offlineLine('address', "Elio's iMac")).toBe("Can't reach Elio's iMac");
    expect(offlineLine('unknown', "Elio's iMac")).toBe("Can't reach Elio's iMac");
    expect(offlineLine('no-network', "Elio's iMac")).toBe('This phone is offline');
  });

  it('explains quick tunnels', () => {
    expect(offlineHelp('address', "Elio's iMac", QUICK).text[0]).toBe('Quick tunnels get a new address each time they start.');
    expect(offlineHelp('asleep', "Elio's iMac", QUICK).text[0]).toContain('quiet-river.trycloudflare.com');
    expect(isQuickTunnel('not a url')).toBe(false);
  });
});
