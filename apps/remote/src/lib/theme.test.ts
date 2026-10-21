import { describe, expect, it } from 'vitest';
import { cleanTheme, DEMO_TIME_SWATCH, OWN_THEME, swatchOf, themeComputer, themeVars } from './theme.ts';

const github = { name: 'GitHub', light: { bg: '#ffffff', accent: '#0969da', text: '#1f2328', 'overlay-border': '#d0d7de', 'overlay-shadow': '#1f232833' }, dark: { bg: '#0d1117', accent: '#58a6ff' } };

describe('a computer\'s theme on the phone', () => {
  it('keeps only colours of the tokens the phone has', () => {
    const theme = cleanTheme({ ...github, light: { ...github.light, 'terminal-bg': '#000000', link: 'url(https://example.com/x)', ok: 'red; }', warn: 12 } });
    expect(theme?.light).toEqual(github.light);
    expect(cleanTheme({ light: {} })).toBeNull();
    expect(cleanTheme('GitHub')).toBeNull();
    expect(cleanTheme({ name: 'Plain' })).toEqual({ name: 'Plain', light: {}, dark: {} });
  });

  it('gives the variables of the mode, with the overlay border as edge and the shadow in layers', () => {
    const vars = themeVars(github, 'light');
    expect(vars['--sb-bg']).toBe('#ffffff');
    expect(vars['--sb-edge']).toBe('#d0d7de');
    expect(vars['--sb-overlay-shadow']).toMatch(/^0 2px 6px #[0-9a-f]{8}, 0 12px 32px -4px #1f232833$/);
    expect(vars['--sb-link']).toBeUndefined();
    expect(themeVars(github, 'dark')).toEqual({ '--sb-bg': '#0d1117', '--sb-accent': '#58a6ff' });
  });

  it('shows the picked computer\'s theme, else the first one\'s, or none', () => {
    expect(themeComputer(null, ['a', 'b'])).toBe('a');
    expect(themeComputer('b', ['a', 'b'])).toBe('b');
    expect(themeComputer('gone', ['a', 'b'])).toBe('a');
    expect(themeComputer(OWN_THEME, ['a', 'b'])).toBeNull();
    expect(themeComputer(null, [])).toBeNull();
  });

  it('draws a swatch of background, accent and text, Demo Time\'s for what is missing', () => {
    expect(swatchOf(null, 'dark')).toEqual(DEMO_TIME_SWATCH.dark);
    expect(swatchOf(github, 'light')).toEqual(['#ffffff', '#0969da', '#1f2328']);
    expect(swatchOf(github, 'dark')).toEqual(['#0d1117', '#58a6ff', DEMO_TIME_SWATCH.dark[2]]);
  });
});
