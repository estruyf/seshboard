import { describe, expect, it } from 'vitest';
import { ESCAPE_AGAIN_MS, escapeToStop } from './escapeStop.ts';

describe('escapeToStop', () => {
  it('stops at once with one Esc', () => {
    expect(escapeToStop(null, 1000, false)).toBe('stop');
  });

  it('arms on the first Esc and stops on a second soon after', () => {
    expect(escapeToStop(null, 1000, true)).toBe('arm');
    expect(escapeToStop(1000, 1000 + ESCAPE_AGAIN_MS, true)).toBe('stop');
  });

  it('arms again when the second Esc comes too late', () => {
    expect(escapeToStop(1000, 1001 + ESCAPE_AGAIN_MS, true)).toBe('arm');
  });
});
