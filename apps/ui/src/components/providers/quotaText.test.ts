import { describe, expect, it } from 'vitest';
import { quotaFooter, quotaLeft, quotaLine, quotaSummary, quotaUsed, resetDay, SHOWS_USAGE, usageNotShown, usageNotShownShort } from './quotaText.ts';

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

describe('premium requests in the Usage view', () => {
  it('says what is left and what was used, or that there is no limit', () => {
    expect(quotaLeft(quota)).toBeCloseTo(85.87);
    expect(quotaLeft({ ...quota, percentUsed: 120 })).toBe(0);
    expect(quotaLeft({ ...quota, entitlement: null })).toBeNull();
    expect(quotaUsed(quota, 'en-US')).toBe('212 of 1,500 used');
    expect(quotaUsed({ ...quota, entitlement: null }, 'en-US')).toBe('212 used, no limit on this plan');
  });
});

describe('the premium requests ring', () => {
  it('says the details in its tooltip', () => {
    expect(quotaSummary(quota, 'en-US')).toBe('Premium requests: 212 of 1,500 used (14%) · resets Nov 1');
    expect(quotaSummary({ ...quota, entitlement: null, resetsAt: null }, 'en-US')).toBe('Premium requests: 212 used, no limit on this plan');
  });
});

describe("a provider whose usage isn't shown", () => {
  it('is Codex for now, said plainly in the Usage view and under the box', () => {
    expect(SHOWS_USAGE).toEqual({ copilot: true, codex: false });
    expect(usageNotShown('codex')).toBe("Seshboard doesn't show OpenAI Codex usage yet.");
    expect(usageNotShownShort('codex')).toBe('Codex usage not shown yet');
  });
});
