import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COLOR_PATTERN, contrastOf, fromOklch, parseColor, toHex, toOklch } from './color.ts';
import { closestShikiTheme, ignoredThemeKeys, parseJsonc, parseThemeFile, themeJsonSchema, THEME_TOKENS, themeSlug, uniqueThemeName } from './theme.ts';

const ok = (raw: unknown) => {
  const result = parseThemeFile(raw);
  if ('error' in result) throw new Error(result.error);
  return result;
};
const refused = (raw: unknown) => {
  const result = parseThemeFile(raw);
  if (!('error' in result)) throw new Error('expected the file to be refused');
  return result.error;
};

describe('theme colours', () => {
  it('reads every accepted format', () => {
    expect(toHex(parseColor('#abc')!)).toBe('#aabbcc');
    expect(toHex(parseColor('#15181F')!)).toBe('#15181f');
    expect(toHex(parseColor('#15181f80')!)).toBe('#15181f80');
    expect(toHex(parseColor('rgb(21 24 31 / 0.35)')!)).toBe('#15181f59');
    expect(toHex(parseColor('rgba(0, 0, 0, 60%)')!)).toBe('#00000099');
    expect(toHex(parseColor('hsl(210deg 40% 50%)')!)).toBe('#4d80b3');
    expect(toHex(parseColor('oklch(70% 0.1 250 / 0.5)')!)).toBe('#6da3da80');
  });

  it('refuses everything else', () => {
    for (const value of ['red', 'url(x.png)', 'var(--sb-bg)', 'color-mix(in srgb, red, blue)', '#fff; }', '#12345', 'rgb(1 2 3);', 'expression(alert(1))', '']) {
      expect(parseColor(value), value).toBeNull();
      expect(new RegExp(COLOR_PATTERN).test(value), value).toBe(false);
    }
  });

  it('refuses a long run of spaces at once, and a value over 80 characters before the pattern runs', () => {
    const started = Date.now();
    expect(new RegExp(COLOR_PATTERN).test(`rgb(1${' '.repeat(50_000)}x`)).toBe(false);
    expect(parseThemeFile({ format: 'seshboard-theme', name: 'x', mode: 'dark', colors: { bg: `rgb(1${' '.repeat(50_000)}x` } })).toHaveProperty('error');
    expect(Date.now() - started).toBeLessThan(500);
    expect(toHex(parseColor('rgb(1 ,2,  3)')!)).toBe('#010203');
  });

  it('converts to and from OKLCH without drift', () => {
    for (const hex of ['#ffffff', '#15181f', '#ffd43b', '#916c00', '#74c0fc', '#d1186b']) expect(toHex(fromOklch(toOklch(parseColor(hex)!)))).toBe(hex);
  });

  it('measures WCAG contrast', () => {
    expect(contrastOf('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastOf('#916c00', '#ffffff')).toBeCloseTo(4.83, 2);
    expect(contrastOf('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });
});

describe('theme files', () => {
  it('reads a full theme', () => {
    const colors = Object.fromEntries(THEME_TOKENS.map((t) => [t, '#123456']));
    const ansi = Array.from({ length: 16 }, () => '#000000');
    const { theme, ignored } = ok({
      $schema: 'https://example.com/schema.json',
      name: 'Full',
      author: 'Someone',
      version: 1,
      light: { canvas: '#ffffff', accent: '#ffd43b', colors, syntax: 'github-light-default' },
      dark: { canvas: '#15181f', accent: '#ffd43b', colors, terminal: { background: '#000', foreground: '#fff', cursor: '#ff0', selection: '#ffffff40', ansi }, syntax: { name: 'mine', type: 'dark', tokenColors: [{ scope: ['comment'], settings: { foreground: '#888888', fontStyle: 'italic bold' } }] } },
    });
    expect(ignored).toEqual([]);
    expect(theme.light?.colors?.bg).toBe('#123456');
    expect(theme.dark?.terminal?.ansi).toHaveLength(16);
    expect(theme.dark?.syntax).toMatchObject({ name: 'mine', tokenColors: [{ settings: { fontStyle: 'italic bold' } }] });
  });

  it('reads a minimal canvas and accent theme', () => {
    const { theme } = ok({ name: 'Minimal', version: 1, dark: { canvas: '#1e1e2e', accent: '#cba6f7' } });
    expect(theme).toEqual({ name: 'Minimal', version: 1, dark: { canvas: '#1e1e2e', accent: '#cba6f7' } });
  });

  it('reads a light-only theme', () => {
    const { theme } = ok({ name: 'Paper', version: 1, light: { canvas: '#fdf6e3', accent: '#b58900' } });
    expect(theme.dark).toBeUndefined();
  });

  it('needs a name, the format version and a mode', () => {
    expect(refused({ version: 1, dark: {} })).toBe('name is missing.');
    expect(refused({ name: '  ', version: 1, dark: {} })).toBe('name is empty.');
    expect(refused({ name: 'x'.repeat(49), version: 1, dark: {} })).toBe('name is longer than 48 characters.');
    expect(refused({ name: 'A', dark: {} })).toBe('version is missing.');
    expect(refused({ name: 'A', version: 1 })).toMatch(/neither a light nor a dark mode/);
    expect(refused({ name: 'A', version: 2, dark: {} })).toMatch(/newer Seshboard/);
    expect(refused([])).toMatch(/one JSON object/);
  });

  it('refuses any value that is not a colour, naming the first problem', () => {
    const bad = (value: unknown) => refused({ name: 'A', version: 1, dark: { colors: { bg: value } } });
    expect(bad('url(https://x.test/a.png)')).toBe('dark.colors.bg uses url(…). Themes can only hold colour values: #hex, rgb(), hsl() or oklch().');
    expect(bad('var(--sb-text)')).toMatch(/^dark\.colors\.bg uses var\(…\)\./);
    expect(bad('color-mix(in srgb, red 10%, blue)')).toMatch(/uses color-mix\(…\)/);
    expect(bad('#fff;')).toMatch(/uses “#fff;”/);
    expect(bad('#fff }')).toMatch(/uses “#fff }”/);
    expect(bad('red')).toMatch(/uses “red”/);
    expect(bad(12)).toMatch(/should be a string/);
    expect(refused({ name: 'A', version: 1, light: { canvas: 'url(x)' } })).toMatch(/^light\.canvas uses url/);
    expect(refused({ name: 'A', version: 1, dark: { terminal: { ansi: [...Array(15).fill('#000'), 'var(--x)'] } } })).toMatch(/^dark\.terminal\.ansi\[15\] uses var/);
    expect(refused({ name: 'A', version: 1, dark: { terminal: { ansi: ['#000'] } } })).toMatch(/needs exactly 16 colours/);
    // The first problem in the file, not the last.
    expect(refused({ name: 'A', version: 1, light: { colors: { bg: 'url(a)', text: 'var(--b)' } } })).toMatch(/^light\.colors\.bg/);
  });

  it('checks syntax themes: the Shiki allowlist and inline TextMate themes', () => {
    expect(ok({ name: 'A', version: 1, dark: { syntax: 'solarized-dark' } }).theme.dark?.syntax).toBe('solarized-dark');
    expect(refused({ name: 'A', version: 1, dark: { syntax: 'solarized-drak' } })).toBe('dark.syntax uses “solarized-drak”, which isn\'t one of the code themes Seshboard ships. Did you mean “solarized-dark”?');
    expect(refused({ name: 'A', version: 1, dark: { syntax: 'zzzzzzzzzzzzzzzz' } })).not.toMatch(/Did you mean/);
    const inline = (rule: unknown) => refused({ name: 'A', version: 1, light: { syntax: { tokenColors: [rule] } } });
    expect(inline({ scope: 'comment', settings: { foreground: 'url(x)' } })).toMatch(/^light\.syntax\.tokenColors\[0\]\.settings\.foreground uses url/);
    expect(inline({ scope: 'comment', settings: { fontStyle: 'strikethrough' } })).toMatch(/fontStyle can only use italic, bold, underline/);
    // Editor colours in an inline theme are ignored, and listed.
    const { theme, ignored } = ok({ name: 'A', version: 1, light: { syntax: { name: 'x', colors: { 'editor.background': 'url(x)' }, tokenColors: [{ scope: 'a', settings: { foreground: '#000', background: '#fff' } }] } } });
    expect(theme.light?.syntax).toEqual({ name: 'x', tokenColors: [{ scope: 'a', settings: { foreground: '#000' } }] });
    expect(ignored).toEqual(['light.syntax.colors', 'light.syntax.tokenColors[0].settings.background']);
    expect(closestShikiTheme('github-dark-defualt')).toBe('github-dark-default');
  });

  it('ignores unknown keys and lists them', () => {
    const { theme, ignored } = ok({ name: 'A', version: 1, fonts: { ui: 'x' }, light: { canvas: '#fff', terminal: { ansi: [] }, colors: { 'tab-bg': '#fff', $comment: 'mine' } } });
    expect(ignored).toEqual(['fonts', 'light.terminal', 'light.colors.tab-bg']);
    expect(theme).toEqual({ name: 'A', version: 1, light: { canvas: '#fff', colors: {} } });
    expect(ignoredThemeKeys({ $comment: 'x', name: 'A' })).toEqual([]);
  });

  it('reads JSON with comments and trailing commas', () => {
    expect(parseJsonc('{\n  // a comment\n  "a": "keeps // this", /* and */ "b": [1, 2,],\n}')).toEqual({ a: 'keeps // this', b: [1, 2] });
    expect(parseJsonc('{"a": "comma, }"}')).toEqual({ a: 'comma, }' });
    expect(() => parseJsonc('{"a": }')).toThrow();
  });

  it('names files and copies', () => {
    expect(themeSlug('Solarized Dark')).toBe('solarized-dark');
    expect(themeSlug('Café · Noir!')).toBe('cafe-noir');
    expect(themeSlug('***')).toBe('theme');
    expect(uniqueThemeName('Solarized', ['solarized'])).toBe('Solarized 2');
    expect(uniqueThemeName('Solarized', ['Solarized', 'Solarized 2'])).toBe('Solarized 3');
    expect(uniqueThemeName('Nord', ['Solarized'])).toBe('Nord');
  });

  it('keeps docs/switchboard-theme.schema.json in step with the schema', () => {
    // UPDATE_THEME_SCHEMA=1 npx vitest run theme.test rewrites the file after a schema change.
    const file = join(import.meta.dirname, '../../../docs/switchboard-theme.schema.json');
    const generated = `${JSON.stringify(themeJsonSchema(), null, 2)}\n`;
    if (process.env.UPDATE_THEME_SCHEMA === '1') writeFileSync(file, generated);
    expect(readFileSync(file, 'utf8')).toBe(generated);
  });
});
