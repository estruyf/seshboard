import { describe, expect, it } from 'vitest';
import { quotaFooter, quotaLine, resetDay } from './quotaText.ts';

const quota = { used: 212, entitlement: 1500, percentUsed: 14.13, resetsAt: '2026-11-01' };

describe("a provider's premium requests", () => {
  it("reads as New session's usage line", () => {
    expect(quotaLine('Copilot', quota, 'en-US')).toBe('Copilot · Premium requests 14% · resets Nov 1');
    expect(quotaLine('Copilot', { ...quota, resetsAt: null }, 'en-US')).toBe('Copilot · Premium requests 14%');
    expect(quotaLine('Copilot', { ...quota, entitlement: null, percentUsed: 0 }, 'en-US')).toBe('Copilot · Premium requests 212 used · resets Nov 1');
  });

  it("reads as a session's footer", () => {
    expect(quotaFooter(quota, 'en-US')).toBe('Premium requests 212 of 1,500');
    expect(quotaFooter({ ...quota, entitlement: null }, 'en-US')).toBe('212 premium requests');
  });

  it('takes a date alone as a local day', () => {
    expect(resetDay('2026-12-01', 'en-US')).toBe('Dec 1');
    expect(resetDay('not a date', 'en-US')).toBe('not a date');
  });
});
