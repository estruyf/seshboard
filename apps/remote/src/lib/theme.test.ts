import { describe, expect, it } from 'vitest';
import css from '../styles.css?raw';
import { cleanModeChoice, cleanTheme, DEMO_TIME_SWATCH, OWN_THEME, resolveMode, swatchOf, themeComputer, themeVars } from './theme.ts';

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
    const both = [
      { id: 'a', theme: github },
      { id: 'b', theme: github },
    ];
    expect(themeComputer(null, both)).toBe('a');
    expect(themeComputer('b', both)).toBe('b');
    expect(themeComputer('gone', both)).toBe('a');
    expect(themeComputer(OWN_THEME, both)).toBeNull();
    expect(themeComputer(null, [])).toBeNull();
  });

  it('by default follows the first computer that sent a theme, not an old pairing that never connects', () => {
    const computers = [
      { id: 'old', theme: null },
      { id: 'mac', theme: github },
    ];
    expect(themeComputer(null, computers)).toBe('mac');
    expect(themeComputer('gone', computers)).toBe('mac');
    expect(themeComputer('old', computers)).toBe('old');
    expect(themeComputer(null, [{ id: 'new', theme: null }])).toBe('new');
  });

  it('shows the mode picked in Appearance, or the phone\'s', () => {
    expect(resolveMode('system', true)).toBe('dark');
    expect(resolveMode('system', false)).toBe('light');
    expect(resolveMode('light', true)).toBe('light');
    expect(resolveMode('dark', false)).toBe('dark');
    expect(cleanModeChoice('dark')).toBe('dark');
    expect(cleanModeChoice('sepia')).toBe('system');
    expect(cleanModeChoice(null)).toBe('system');
  });

  it('has the same dark tokens for the phone in dark mode and for Appearance set to Dark', () => {
    const block = (selector: string) => css.slice(css.indexOf(selector)).match(/\{([^}]*)\}/)?.[1]?.replace(/\s+/g, ' ').trim();
    const system = block(":root:not([data-mode='light'])");
    expect(system).toContain('--sb-bg:');
    expect(block(":root[data-mode='dark']")).toBe(system);
  });

  it('draws a swatch of background, accent and text, Demo Time\'s for what is missing', () => {
    expect(swatchOf(null, 'dark')).toEqual(DEMO_TIME_SWATCH.dark);
    expect(swatchOf(github, 'light')).toEqual(['#ffffff', '#0969da', '#1f2328']);
    expect(swatchOf(github, 'dark')).toEqual(['#0d1117', '#58a6ff', DEMO_TIME_SWATCH.dark[2]]);
  });
});
