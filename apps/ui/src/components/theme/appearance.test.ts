import { describe, expect, it } from 'vitest';
import { appearanceChoice, appearancePatch } from './appearance.ts';

describe('appearance cards', () => {
  it('picks Seshboard for every colour theme, and Black and white by the mode on screen', () => {
    expect(appearanceChoice('nord', 'dark')).toBe('seshboard');
    expect(appearanceChoice('demo-time', 'light')).toBe('seshboard');
    expect(appearanceChoice('black-and-white', 'dark')).toBe('bw-dark');
    expect(appearanceChoice('black-and-white', 'light')).toBe('bw-light');
  });

  it('goes back to the last colour theme from Black and white', () => {
    expect(appearancePatch('seshboard', { colorThemeId: 'nord' })).toEqual({ themeId: 'nord' });
    expect(appearancePatch('seshboard', { colorThemeId: 'black-and-white' })).toEqual({ themeId: 'demo-time' });
    expect(appearancePatch('seshboard', { colorThemeId: '' })).toEqual({ themeId: 'demo-time' });
  });

  it('sets the mode with each Black and white card', () => {
    expect(appearancePatch('bw-dark', { colorThemeId: 'nord' })).toEqual({ themeId: 'black-and-white', colorScheme: 'dark' });
    expect(appearancePatch('bw-light', { colorThemeId: 'nord' })).toEqual({ themeId: 'black-and-white', colorScheme: 'light' });
  });
});
