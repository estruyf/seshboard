import { bundledThemes } from 'shiki/themes';
import { describe, expect, it } from 'vitest';
import { SHIKI_THEMES, type InlineSyntaxTheme } from '@seshboard/protocol/theme-format';
import { highlightCacheKey, highlightWith, inlineRegistration, setSyntaxThemes, SYNTAX_THEMES, syntaxKey, syntaxThemeId } from './highlight.ts';

const inline: InlineSyntaxTheme = { name: 'Mine', tokenColors: [{ scope: ['comment'], settings: { foreground: '#00ff00', fontStyle: 'italic' } }, { scope: 'keyword', settings: { foreground: '#ff0000' } }] };

describe('syntax themes', () => {
  it('can load every theme on the allowlist, and only those', () => {
    expect(Object.keys(SYNTAX_THEMES).sort()).toEqual([...SHIKI_THEMES].sort());
    for (const name of SHIKI_THEMES) expect(Object.keys(bundledThemes), name).toContain(name);
  });

  it('names each mode for Shiki: Demo Time by default, the Shiki name, or an inline theme by its rules', () => {
    expect(syntaxThemeId(null, 'dark')).toBe('demotime-dark');
    expect(syntaxThemeId('nord', 'dark')).toBe('nord');
    expect(syntaxThemeId(inline, 'light')).toMatch(/^inline-light-/);
    expect(syntaxThemeId(inline, 'light')).toBe(syntaxThemeId({ ...inline, name: 'Renamed' }, 'light'));
    expect(syntaxThemeId(inline, 'light')).not.toBe(syntaxThemeId({ tokenColors: [inline.tokenColors[1]!] }, 'light'));
  });

  it('reads only scopes, foreground and font style from an inline theme', () => {
    const extra = { ...inline, colors: { 'editor.background': '#000000' }, tokenColors: [{ scope: 'string', settings: { foreground: '#123456', background: '#ffffff' } }] } as unknown as InlineSyntaxTheme;
    expect(inlineRegistration(extra, 'inline-dark-x', 'dark')).toEqual({ name: 'inline-dark-x', type: 'dark', colors: {}, tokenColors: [{ scope: 'string', settings: { foreground: '#123456' } }] });
  });

  it('keys cached HTML by the syntax themes in use', () => {
    expect(setSyntaxThemes({ light: null, dark: null })).toBe('demotime-light|demotime-dark');
    const before = highlightCacheKey(syntaxKey(), 'typescript', 'const a = 1;');
    setSyntaxThemes({ light: 'github-light-default', dark: inline });
    expect(syntaxKey()).toMatch(/^github-light-default\|inline-dark-/);
    expect(highlightCacheKey(syntaxKey(), 'typescript', 'const a = 1;')).not.toBe(before);
    setSyntaxThemes({ light: null, dark: null });
  });

  it('highlights with a Shiki theme and an inline one, both modes as CSS variables', async () => {
    const html = await highlightWith('// note\nconst a = 1;', 'ts', { light: 'github-light-default', dark: inline });
    expect(html).toContain('--shiki-light:');
    expect(html).toContain('--shiki-dark:#00FF00');
    expect(html).toContain('--shiki-dark-font-style:italic');
  });
});
