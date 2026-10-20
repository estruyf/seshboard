import { describe, expect, it } from 'vitest';
import { tabTitle } from './signals.ts';

describe('tabTitle', () => {
  it('starts with what needs you, and names the open session', () => {
    expect(tabTitle(0, null)).toBe('Switchboard Remote');
    expect(tabTitle(2, null)).toBe('(2) Switchboard Remote');
    expect(tabTitle(2, 'Publish the beta')).toBe('(2) Publish the beta · Switchboard');
    expect(tabTitle(0, 'Publish the beta')).toBe('Publish the beta · Switchboard');
  });
});
