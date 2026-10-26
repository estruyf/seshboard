import { contrastOf, parseColor, composite, toHex } from '@seshboard/protocol/color';
import { THEME_MODES, THEME_TOKENS, type InlineSyntaxTheme, type ThemeFile, type ThemeMode, type ThemeSyntax, type ThemeToken } from '@seshboard/protocol/theme-format';
import { resolveTheme, themeModes, type ResolvedTheme } from './themeResolve.ts';

/** WCAG AA for normal text; high contrast themes aim for AAA. */
export const AA = 4.5;
export const AAA = 7;

/** The two colours of code that matter for reading it: plain code and comments (null when the theme doesn't say). */
export interface SyntaxColors {
  foreground: string | null;
  comment: string | null;
}

/** A pair of colours below the target. */
export interface ContrastIssue {
  mode: ThemeMode;
  /** "Muted text on background". */
  label: string;
  fg: string;
  bg: string;
  ratio: number;
  need: number;
}

/** A translucent colour as it shows on `bg`, so the swatch and the ratio match what you see. */
const onTop = (fg: string, bg: string) => {
  const f = parseColor(fg);
  const b = parseColor(bg);
  return f && b && f.a < 1 ? toHex(composite(f, b)) : fg;
};

/**
 * The pairs that must stay readable, per mode the theme has: text and muted text on the background, text
 * on the accent, and code (plain and comments) on the code background. Those below `need` come back.
 */
export function contrastIssues(theme: ThemeFile, resolved: ResolvedTheme, syntax: Partial<Record<ThemeMode, SyntaxColors>> = {}, need = AA): ContrastIssue[] {
  const issues: ContrastIssue[] = [];
  for (const mode of THEME_MODES) {
    if (!theme[mode]) continue;
    const t = resolved[mode].tokens;
    const pairs: Array<[string, string | null, string]> = [
      ['Text on background', t.text, t.bg],
      ['Muted text on background', t.muted, t.bg],
      ['Text on accent', t['on-accent'], t.accent],
      ['Code on code background', syntax[mode]?.foreground ?? null, onTop(t['code-bg'], t.bg)],
      ['Comments on code background', syntax[mode]?.comment ?? null, onTop(t['code-bg'], t.bg)],
    ];
    for (const [label, fg, bg] of pairs) {
      if (!fg) continue;
      const ratio = contrastOf(fg, bg);
      if (ratio < need) issues.push({ mode, label, fg, bg, ratio, need });
    }
  }
  return issues;
}

/** Scopes of a TextMate rule as a list. */
const scopesOf = (scope: string | string[] | undefined) => (scope === undefined ? [] : Array.isArray(scope) ? scope : scope.split(',').map((s) => s.trim()));

/**
 * Plain code and comment colours of a syntax theme (a Shiki theme or an inline one): the editor
 * foreground or the rule without a scope, and the first rule for `comment`.
 */
export function syntaxColorsOf(theme: { colors?: Record<string, string>; fg?: string; tokenColors?: Array<{ scope?: string | string[]; settings?: { foreground?: string } }> }): SyntaxColors {
  const rules = theme.tokenColors ?? [];
  const foreground = theme.colors?.['editor.foreground'] ?? theme.fg ?? rules.find((r) => r.scope === undefined && r.settings?.foreground)?.settings?.foreground ?? null;
  const comment = rules.find((r) => r.settings?.foreground && scopesOf(r.scope).some((s) => s === 'comment' || s.startsWith('comment.')))?.settings?.foreground ?? null;
  return { foreground: foreground && parseColor(foreground) ? foreground : null, comment: comment && parseColor(comment) ? comment : null };
}

/** How a mode's code colours read in the report: "Demo Time (default)", "nord (Shiki)", "inline theme, 12 scopes". */
export function syntaxLabel(syntax: ThemeSyntax | null | undefined): string {
  if (!syntax) return 'Demo Time (default)';
  if (typeof syntax === 'string') return `${syntax} (Shiki)`;
  const scopes = (syntax as InlineSyntaxTheme).tokenColors.reduce((n, rule) => n + scopesOf(rule.scope).length, 0);
  return `inline theme, ${scopes} ${scopes === 1 ? 'scope' : 'scopes'}`;
}

/** What the import dialog says about a theme, before anything is added. */
export interface ThemeReport {
  modes: 'both' | ThemeMode;
  total: number;
  /** Colours the theme sets, per mode it has. */
  set: Partial<Record<ThemeMode, number>>;
  /** Tokens generated from canvas and accent, per mode it has, with their values (for swatches). */
  generated: Partial<Record<ThemeMode, Array<{ token: ThemeToken; value: string }>>>;
  /** The code colours, per mode. */
  code: Record<ThemeMode, string>;
}

export function themeReport(theme: ThemeFile, resolved: ResolvedTheme = resolveTheme(theme)): ThemeReport {
  const report: ThemeReport = { modes: themeModes(theme), total: THEME_TOKENS.length, set: {}, generated: {}, code: { light: syntaxLabel(theme.light?.syntax), dark: syntaxLabel(theme.dark?.syntax) } };
  for (const mode of THEME_MODES) {
    if (!theme[mode]) continue;
    report.set[mode] = resolved[mode].set.length;
    report.generated[mode] = resolved[mode].generated.map((token) => ({ token, value: resolved[mode].tokens[token] }));
  }
  return report;
}
