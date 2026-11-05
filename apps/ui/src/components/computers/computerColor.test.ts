import { describe, expect, it } from 'vitest';
import { COMPUTER_COLORS } from '@seshboard/protocol/client';
import { COMPUTER_COLOR_NAME, COMPUTER_COLOR_VAR, computerTint } from './computerColor.ts';

describe('computerTint', () => {
  it('leaves violet to the theme, and points the remote token at the colour picked', () => {
    expect(computerTint('violet')).toBeUndefined();
    expect(computerTint(null)).toBeUndefined();
    expect(computerTint('green')).toEqual({ '--sb-remote': 'var(--sb-profile-green)' });
  });

  it('has a name and a token for every colour', () => {
    for (const color of COMPUTER_COLORS) {
      expect(COMPUTER_COLOR_NAME[color]).toBeTruthy();
      expect(COMPUTER_COLOR_VAR[color]).toMatch(/^var\(--sb-/);
    }
  });
});
