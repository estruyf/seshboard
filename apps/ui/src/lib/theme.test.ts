import { describe, expect, it } from 'vitest';
import { contrastOf, parseColor, toHex, toOklch } from '@seshboard/protocol/color';
import { parseThemeFile, THEME_MODES, THEME_TOKENS, type ThemeFile, type ThemeMode, type ThemeSyntax, type ThemeTokens } from '@seshboard/protocol/theme';
import styles from '../styles.css?raw';
import themesDoc from '../../../../docs/themes.md?raw';
import { BUILT_IN_THEMES } from '../themes/index.ts';
import { themeCss, overlayShadow } from './themeCss.ts';
import { CONTRAST, DEMO_TIME_TOKENS, generateTokens } from './themeGenerate.ts';
import { AA, contrastIssues, syntaxColorsOf, syntaxLabel, themeReport } from './themeReport.ts';
import { DEMO_TIME, exportThemeFile, resolveTheme } from './themeResolve.ts';

const parse = (raw: unknown): ThemeFile => {
  const result = parseThemeFile(raw);
  if ('error' in result) throw new Error(result.error);
  return result.theme;
};

/** Distance in OKLab (about 0.02 is a just-noticeable difference). */
function deltaE(a: string, b: string): number {
  const x = toOklch(parseColor(a)!);
  const y = toOklch(parseColor(b)!);
  const lab = (c: typeof x) => [c.l, c.c * Math.cos((c.h * Math.PI) / 180), c.c * Math.sin((c.h * Math.PI) / 180)];
  const [l1, a1, b1] = lab(x);
  const [l2, a2, b2] = lab(y);
  return Math.hypot(l1! - l2!, a1! - a2!, b1! - b2!) + Math.abs(parseColor(a)!.a - parseColor(b)!.a);
}

/** The `--sb-*` values in a block of styles.css. */
function cssBlock(css: string, start: string): Record<string, string> {
  const from = css.indexOf(start);
  const body = css.slice(from, css.indexOf('}', from));
  return Object.fromEntries([...body.matchAll(/--sb-([a-z-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

const STYLES: Record<ThemeMode, Record<string, string>> = { light: cssBlock(styles, ':root {'), dark: cssBlock(styles, '@media (prefers-color-scheme: dark)') };

/** A styles.css value as the theme writes it (selected is a color-mix of text there; shadows are layers). */
function cssValue(mode: ThemeMode, token: string): string {
  const raw = STYLES[mode][token]!;
  if (token === 'selected') return toHex({ ...parseColor(STYLES[mode].text!)!, a: mode === 'light' ? 0.1 : 0.11 });
  return raw;
}

const SAMPLES: Array<[ThemeMode, string, string]> = [
  ['light', '#fdf6e3', '#b58900'],
  ['dark', '#002b36', '#b58900'],
  ['dark', '#2e3440', '#88c0d0'],
  ['dark', '#1e1e2e', '#cba6f7'],
  ['light', '#eff1f5', '#8839ef'],
  ['dark', '#000000', '#ff0000'],
  ['light', '#ffffff', '#0969da'],
  ['light', '#d8d8d8', '#00ffff'],
  ['dark', '#3a3a3a', '#ffd43b'],
];

describe('generating a theme from canvas and accent', () => {
  it.each(SAMPLES)('meets the contrast targets (%s, %s, %s)', (mode, canvas, accent) => {
    const t = generateTokens(mode, canvas, accent);
    for (const token of THEME_TOKENS) expect(parseColor(t[token]), token).not.toBeNull();
    for (const surface of [t.bg, t.sidebar, t.card]) {
      expect(contrastOf(t.text, surface)).toBeGreaterThanOrEqual(CONTRAST.text);
      expect(contrastOf(t.muted, surface)).toBeGreaterThanOrEqual(CONTRAST.muted);
      expect(contrastOf(t.faint, surface)).toBeGreaterThanOrEqual(CONTRAST.faint);
    }
    expect(contrastOf(t['accent-ink'], t.bg)).toBeGreaterThanOrEqual(CONTRAST.accentInk);
    for (const token of ['ok', 'warn', 'error', 'caution', 'link', 'unread'] as const) expect(contrastOf(t[token], t.bg), token).toBeGreaterThanOrEqual(CONTRAST.status - 0.01);
    for (const token of THEME_TOKENS.filter((x) => x.startsWith('profile-'))) expect(contrastOf(t[token], t.bg), token).toBeGreaterThanOrEqual(CONTRAST.profile - 0.01);
    // on-accent is black or white, whichever reads better on the accent.
    expect(['#000000', '#ffffff']).toContain(t['on-accent']);
    expect(contrastOf(t['on-accent'], t.accent)).toBeGreaterThanOrEqual(contrastOf(t['on-accent'] === '#000000' ? '#ffffff' : '#000000', t.accent));
    expect(t.selected).toBe(toHex({ ...parseColor(t.text)!, a: mode === 'light' ? 0.1 : 0.11 }));
    expect(t.bg).toBe(toHex(parseColor(canvas)!));
    expect(t.accent).toBe(toHex(parseColor(accent)!));
    // The terminal stays dark in both modes.
    expect(contrastOf(t['terminal-bg'], '#000000')).toBeLessThan(1.6);
  });

  it('takes link and unread from a blue accent, and keeps Demo Time\'s blue otherwise', () => {
    expect(toOklch(parseColor(generateTokens('dark', '#2e3440', '#5e81ac').link)!).h).toBeCloseTo(toOklch(parseColor('#5e81ac')!).h, 0);
    expect(generateTokens('dark', '#15181f', '#ffd43b').link).toBe(DEMO_TIME_TOKENS.dark.link);
  });

  it('comes close to Demo Time from its canvas and accent', () => {
    // Known differences: on-accent is pure black (Demo Time uses its near-black), the greys and text of a
    // white canvas get a hint of the yellow accent (Demo Time's are cool blue-grey), the diff backgrounds
    // are 14% (12%), and accent-ink and dark warn are solved to just 4.5:1.
    const greys = 0.05;
    const LIMIT: Partial<Record<keyof ThemeTokens, number>> = { 'on-accent': 0.25, 'terminal-bg': 0.03, warn: 0.03, text: greys, 'paper-text': greys, muted: greys, faint: greys, selected: greys };
    const report: string[] = [];
    for (const mode of THEME_MODES) {
      const demo = DEMO_TIME_TOKENS[mode];
      const generated = generateTokens(mode, demo.bg, demo.accent);
      for (const token of THEME_TOKENS) {
        const d = deltaE(generated[token], demo[token]);
        if (d > 0.005) report.push(`${mode} ${token}: ${demo[token]} → ${generated[token]} (ΔE ${d.toFixed(3)})`);
        expect(d, `${mode} ${token}: ${demo[token]} vs ${generated[token]}`).toBeLessThanOrEqual(LIMIT[token] ?? 0.025);
      }
    }
    expect(report.length).toBeGreaterThan(0);
  });
});

describe('Demo Time', () => {
  it('keeps its exact tokens from styles.css', () => {
    const resolved = resolveTheme(DEMO_TIME);
    for (const mode of THEME_MODES) {
      for (const token of THEME_TOKENS) {
        const css = cssValue(mode, token);
        if (token === 'overlay-shadow') {
          const ours = overlayShadow(mode, resolved[mode].tokens[token]).match(/#[0-9a-f]+/g)!.map((c) => parseColor(c)!);
          const theirs = css.match(/rgb\([^)]+\)/g)!.map((c) => parseColor(c)!);
          expect(ours.length).toBe(theirs.length);
          ours.forEach((c, i) => expect(Math.abs(c.a - theirs[i]!.a)).toBeLessThan(1 / 255));
          continue;
        }
        expect(deltaE(resolved[mode].tokens[token], css), `${mode} ${token}`).toBeLessThan(0.004);
      }
    }
  });

  it('sets every token, so its export is a full starting point', () => {
    for (const mode of THEME_MODES) expect(Object.keys(DEMO_TIME[mode]!.colors!).sort()).toEqual([...THEME_TOKENS].sort());
    expect(Object.keys(exportThemeFile(DEMO_TIME, { full: true }).dark!.colors!)).toHaveLength(THEME_TOKENS.length);
  });

  it("matches the terminal's previous palette", () => {
    expect(resolveTheme(DEMO_TIME).terminal).toEqual({ background: '#0d1016', foreground: '#d9dbe1', cursor: '#ffd43b', selection: '#ffd43b40', ansi: DEMO_TIME.dark!.terminal!.ansi });
  });
});

describe('resolving a theme', () => {
  it('generates from canvas and accent, then applies colors, then derives selected', () => {
    const theme = parse({ name: 'T', version: 1, dark: { canvas: '#002b36', accent: '#b58900', colors: { text: '#93a1a1', sidebar: 'rgb(7 54 66)' } } });
    const { dark, light } = resolveTheme(theme);
    expect(dark.tokens.sidebar).toBe('#073642');
    expect(dark.tokens.text).toBe('#93a1a1');
    expect(dark.tokens.selected).toBe('#93a1a11c');
    expect(dark.set).toEqual(['bg', 'sidebar', 'text', 'accent']);
    expect(light.fallback).toBe(true);
    expect(light.tokens).toEqual(resolveTheme(DEMO_TIME).light.tokens);
  });

  it("falls back to the mode's bg and accent, then Demo Time's", () => {
    const fromColors = resolveTheme(parse({ name: 'T', version: 1, dark: { colors: { bg: '#101010', accent: '#ff8800' } } })).dark;
    expect(fromColors.canvas).toBe('#101010');
    expect(fromColors.tokens.sidebar).not.toBe(DEMO_TIME_TOKENS.dark.sidebar);
    const nothing = resolveTheme(parse({ name: 'T', version: 1, dark: {} })).dark;
    expect(nothing.canvas).toBe(DEMO_TIME_TOKENS.dark.bg);
    expect(nothing.accent).toBe(DEMO_TIME_TOKENS.dark.accent);
  });

  it('writes CSS with only validated colour values', () => {
    const css = themeCss(resolveTheme(parse({ name: 'T', version: 1, dark: { canvas: '#002b36', accent: '#b58900' } })));
    expect(css).toContain('html:root {');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(':root .theme-dark {');
    expect(css).not.toMatch(/url\(|var\(|expression/);
    for (const line of css.split('\n').filter((l) => l.includes('--sb-'))) expect(line).toMatch(/^\s+--sb-[a-z-]+: [#0-9a-z ,.()-]+;$/);
    // The terminal panel's block leaves the shadow it casts to the app's own theme.
    expect(css.slice(css.indexOf('.theme-dark'))).not.toContain('--sb-terminal-shadow');
  });
});

describe('exporting and importing', () => {
  const roundTrip = (theme: ThemeFile, full = false) => parse(JSON.parse(JSON.stringify(exportThemeFile(theme, { full }))));
  /** What a theme looks like: the tokens of both modes, the terminal and the code colours. */
  const looks = (theme: ThemeFile) => {
    const r = resolveTheme(theme);
    return { light: r.light.tokens, dark: r.dark.tokens, terminal: r.terminal, syntax: [r.light.syntax, r.dark.syntax] };
  };

  it('gives the same tokens back for Demo Time', () => {
    expect(looks(roundTrip(DEMO_TIME, true))).toEqual(looks(DEMO_TIME));
  });

  it('gives the same tokens back for a generated theme, and writes only what differs', () => {
    const theme = parse({ name: 'Mocha', version: 1, dark: { canvas: '#1e1e2e', accent: '#cba6f7', colors: { text: '#cdd6f4', warn: 'hsl(330 80% 70%)' } }, light: { canvas: 'oklch(0.96 0.01 270)', accent: '#8839ef' } });
    const exported = exportThemeFile(theme);
    expect(exported.$schema).toMatch(/switchboard-theme\.schema\.json$/);
    expect(exported.dark!.colors).toEqual({ text: '#cdd6f4', warn: toHex(parseColor('hsl(330 80% 70%)')!) });
    expect(exported.light!.colors).toBeUndefined();
    expect(looks(roundTrip(theme))).toEqual(looks(theme));
  });

  it.each(BUILT_IN_THEMES.map((b) => [b.id, b.raw] as const))('gives the same tokens back for %s', (_id, raw) => {
    const theme = parse(raw);
    expect(looks(roundTrip(theme))).toEqual(looks(theme));
  });
});

/** The plain and comment colours of a syntax value (Demo Time's when null). */
async function syntaxOf(syntax: ThemeSyntax | undefined, mode: ThemeMode) {
  if (!syntax) return syntaxColorsOf((await import(`./themes/demotime-${mode}.json`)).default);
  if (typeof syntax === 'string') return syntaxColorsOf((await import(`../../../../node_modules/@shikijs/themes/dist/${syntax}.mjs`)).default);
  return syntaxColorsOf(syntax);
}

describe('built-in themes', () => {
  it('ship in picker order with Demo Time first', () => {
    expect(BUILT_IN_THEMES.map((b) => b.id)).toEqual(['demo-time', 'catppuccin', 'nord', 'solarized', 'graphite', 'midnight', 'paper', 'signal', 'forest', 'plum', 'aluminium', 'ocean', 'neon']);
  });

  it.each(BUILT_IN_THEMES.map((b) => [b.id, b.raw] as const))('%s parses, has its modes and keeps text readable', (id, raw) => {
    const result = parseThemeFile(raw);
    if ('error' in result) throw new Error(result.error);
    expect(result.ignored).toEqual([]);
    const theme = result.theme;
    // Nord is dark only, as the original is; every other built-in has both modes.
    const modes = id === 'nord' ? (['dark'] as const) : THEME_MODES;
    expect(THEME_MODES.filter((mode) => theme[mode])).toEqual(modes);
    const resolved = resolveTheme(theme);
    // Text, muted text and the accent as text reach WCAG AA. Solarized's own palette keeps a
    // few pairs under it (text on the accent, comments in code), as the original does; the import report lists them.
    for (const mode of modes) {
      const t = resolved[mode].tokens;
      expect(contrastOf(t.text, t.bg), `${mode} text`).toBeGreaterThanOrEqual(AA);
      expect(contrastOf(t.muted, t.bg), `${mode} muted`).toBeGreaterThanOrEqual(AA);
      expect(contrastOf(t['accent-ink'], t.bg), `${mode} accent-ink`).toBeGreaterThanOrEqual(AA);
    }
  });

  it('Demo Time keeps every pair readable, code included', async () => {
    const resolved = resolveTheme(DEMO_TIME);
    const syntax = { light: await syntaxOf(undefined, 'light'), dark: await syntaxOf(undefined, 'dark') };
    expect(contrastIssues(DEMO_TIME, resolved, syntax, AA)).toEqual([]);
  });

  it.each(['graphite', 'midnight', 'paper', 'signal', 'forest', 'plum', 'aluminium', 'ocean', 'neon'])('%s, made for the app icon, keeps every pair readable, code included', async (id) => {
    const theme = BUILT_IN_THEMES.find((b) => b.id === id)!.raw as ThemeFile;
    const syntax = { light: await syntaxOf(undefined, 'light'), dark: await syntaxOf(undefined, 'dark') };
    expect(contrastIssues(theme, resolveTheme(theme), syntax, AA)).toEqual([]);
  });
});

describe('the import report', () => {
  it('counts set and generated colours, and names the code colours', () => {
    const theme = parse({ name: 'S', version: 1, dark: { canvas: '#002b36', accent: '#b58900', colors: { text: '#93a1a1' }, syntax: 'solarized-dark' } });
    const report = themeReport(theme);
    expect(report.modes).toBe('dark');
    expect(report.total).toBe(THEME_TOKENS.length);
    expect(report.set).toEqual({ dark: 3 });
    expect(report.generated.dark).toHaveLength(THEME_TOKENS.length - 3);
    expect(report.generated.light).toBeUndefined();
    expect(report.code).toEqual({ light: 'Demo Time (default)', dark: 'solarized-dark (Shiki)' });
    expect(syntaxLabel({ tokenColors: [{ scope: ['comment', 'string'], settings: {} }, { scope: 'keyword', settings: {} }] })).toBe('inline theme, 3 scopes');
  });

  it('warns about every pair under AA, with the ratio', () => {
    const theme = parse({ name: 'S', version: 1, light: { canvas: '#fdf6e3', accent: '#b58900', colors: { muted: '#93a1a1', 'on-accent': '#fdf6e3' } } });
    const issues = contrastIssues(theme, resolveTheme(theme), { light: { foreground: '#073642', comment: '#cccccc' } });
    expect(issues.map((i) => i.label)).toEqual(['Muted text on background', 'Text on accent', 'Comments on code background']);
    expect(issues[0]!.ratio).toBeCloseTo(contrastOf('#93a1a1', '#fdf6e3'), 5);
    expect(issues[0]).toMatchObject({ mode: 'light', fg: '#93a1a1', bg: '#fdf6e3', need: AA });
  });

  it('reads plain and comment colours from a syntax theme', () => {
    expect(syntaxColorsOf({ colors: { 'editor.foreground': '#d9dbe1' }, tokenColors: [{ scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#8b949e' } }] })).toEqual({ foreground: '#d9dbe1', comment: '#8b949e' });
    expect(syntaxColorsOf({ tokenColors: [{ settings: { foreground: '#000000' } }, { scope: 'comment.line', settings: { foreground: '#008000' } }] })).toEqual({ foreground: '#000000', comment: '#008000' });
  });
});

describe('docs/themes.md', () => {
  const examples = [...themesDoc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]!).filter((block) => block.trimStart().startsWith('{'));

  it('only has examples that import', () => {
    expect(examples.length).toBeGreaterThanOrEqual(3);
    for (const example of examples) parse(JSON.parse(example));
  });

  it("shows Demo Time as it ships", () => {
    const shown = examples.map((e) => parse(JSON.parse(e))).find((t) => t.name === 'Demo Time')!;
    expect(shown.light).toEqual(DEMO_TIME.light);
    expect(shown.dark).toEqual(DEMO_TIME.dark);
  });

  it('quotes the generated accent-ink', () => {
    expect(themesDoc).toContain(`\`${generateTokens('light', '#ffffff', '#ffd43b')['accent-ink']}\` instead of \`#916c00\``);
  });
});

