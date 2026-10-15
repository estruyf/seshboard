import { describe, expect, it } from 'vitest';
import { agentsToggleStep } from './agentsPanel.ts';

describe('the Agents toggle', () => {
  it('opens a closed panel', () => {
    expect(agentsToggleStep(false, false, true)).toBe('open');
  });

  it('brings an open panel behind another tab to the front instead of closing it', () => {
    expect(agentsToggleStep(true, false, true)).toBe('front');
  });

  it('closes a panel that is in front, or the only one open', () => {
    expect(agentsToggleStep(true, true, true)).toBe('close');
    expect(agentsToggleStep(true, false, false)).toBe('close');
  });
});
