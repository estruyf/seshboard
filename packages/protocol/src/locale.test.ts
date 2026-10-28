import { describe, expect, it } from 'vitest';
import { safeLocale } from './locale.ts';

describe('safeLocale', () => {
  it('keeps a tag Intl takes', () => {
    expect(safeLocale('en-US')).toBe('en-US');
    expect(safeLocale('en-GB')).toBe('en-GB');
    expect(safeLocale('nl-be')).toBe('nl-BE');
  });

  it('falls back to the system locale for a missing or malformed tag', () => {
    // '' is what Electron's app.getLocale() returns on Windows when the app has no locale file for the language.
    for (const tag of [undefined, '', ' ', 'en_US', 'nl-BE.UTF-8', 'C']) expect(safeLocale(tag)).toBeUndefined();
  });
});
