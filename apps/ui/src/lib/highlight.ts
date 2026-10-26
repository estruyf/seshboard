import type { HighlighterCore, ThemeRegistration } from 'shiki/core';
import type { InlineSyntaxTheme, ShikiThemeName, ThemeMode, ThemeSyntax } from '@seshboard/protocol/theme-format';
import { SizedCache } from './sizedCache.ts';

/** Fence names → Shiki grammar, loaded only when first needed. */
const GRAMMARS: Record<string, () => Promise<unknown>> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  docker: () => import('shiki/langs/docker.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
  astro: () => import('shiki/langs/astro.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
};

const ALIASES: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  shell: 'shellscript',
  console: 'shellscript',
  py: 'python',
  md: 'markdown',
  yml: 'yaml',
  rs: 'rust',
  dockerfile: 'docker',
  kt: 'kotlin',
  cs: 'csharp',
  'c++': 'cpp',
  rb: 'ruby',
  gql: 'graphql',
  svg: 'xml',
};

/** The Shiki grammar for a fence or file extension, or null when we don't highlight it. */
export function grammarFor(language: string | undefined): string | null {
  if (!language) return null;
  const name = language.toLowerCase();
  const resolved = ALIASES[name] ?? name;
  return resolved in GRAMMARS ? resolved : null;
}

/**
 * Shiki's bundled themes a theme may use for code (`SHIKI_THEMES` in the protocol), each loaded the
 * first time a theme asks for it. Spelled out so the bundler only ships these.
 */
export const SYNTAX_THEMES: Record<ShikiThemeName, () => Promise<{ default: unknown }>> = {
  'andromeeda': () => import('shiki/themes/andromeeda.mjs'),
  'aurora-x': () => import('shiki/themes/aurora-x.mjs'),
  'ayu-dark': () => import('shiki/themes/ayu-dark.mjs'),
  'ayu-light': () => import('shiki/themes/ayu-light.mjs'),
  'ayu-mirage': () => import('shiki/themes/ayu-mirage.mjs'),
  'catppuccin-frappe': () => import('shiki/themes/catppuccin-frappe.mjs'),
  'catppuccin-latte': () => import('shiki/themes/catppuccin-latte.mjs'),
  'catppuccin-macchiato': () => import('shiki/themes/catppuccin-macchiato.mjs'),
  'catppuccin-mocha': () => import('shiki/themes/catppuccin-mocha.mjs'),
  'dark-plus': () => import('shiki/themes/dark-plus.mjs'),
  'dracula': () => import('shiki/themes/dracula.mjs'),
  'dracula-soft': () => import('shiki/themes/dracula-soft.mjs'),
  'everforest-dark': () => import('shiki/themes/everforest-dark.mjs'),
  'everforest-light': () => import('shiki/themes/everforest-light.mjs'),
  'github-dark': () => import('shiki/themes/github-dark.mjs'),
  'github-dark-default': () => import('shiki/themes/github-dark-default.mjs'),
  'github-dark-dimmed': () => import('shiki/themes/github-dark-dimmed.mjs'),
  'github-dark-high-contrast': () => import('shiki/themes/github-dark-high-contrast.mjs'),
  'github-light': () => import('shiki/themes/github-light.mjs'),
  'github-light-default': () => import('shiki/themes/github-light-default.mjs'),
  'github-light-high-contrast': () => import('shiki/themes/github-light-high-contrast.mjs'),
  'gruvbox-dark-hard': () => import('shiki/themes/gruvbox-dark-hard.mjs'),
  'gruvbox-dark-medium': () => import('shiki/themes/gruvbox-dark-medium.mjs'),
  'gruvbox-dark-soft': () => import('shiki/themes/gruvbox-dark-soft.mjs'),
  'gruvbox-light-hard': () => import('shiki/themes/gruvbox-light-hard.mjs'),
  'gruvbox-light-medium': () => import('shiki/themes/gruvbox-light-medium.mjs'),
  'gruvbox-light-soft': () => import('shiki/themes/gruvbox-light-soft.mjs'),
  'houston': () => import('shiki/themes/houston.mjs'),
  'kanagawa-dragon': () => import('shiki/themes/kanagawa-dragon.mjs'),
  'kanagawa-lotus': () => import('shiki/themes/kanagawa-lotus.mjs'),
  'kanagawa-wave': () => import('shiki/themes/kanagawa-wave.mjs'),
  'light-plus': () => import('shiki/themes/light-plus.mjs'),
  'material-theme': () => import('shiki/themes/material-theme.mjs'),
  'material-theme-darker': () => import('shiki/themes/material-theme-darker.mjs'),
  'material-theme-lighter': () => import('shiki/themes/material-theme-lighter.mjs'),
  'material-theme-ocean': () => import('shiki/themes/material-theme-ocean.mjs'),
  'material-theme-palenight': () => import('shiki/themes/material-theme-palenight.mjs'),
  'min-dark': () => import('shiki/themes/min-dark.mjs'),
  'min-light': () => import('shiki/themes/min-light.mjs'),
  'monokai': () => import('shiki/themes/monokai.mjs'),
  'night-owl': () => import('shiki/themes/night-owl.mjs'),
  'night-owl-light': () => import('shiki/themes/night-owl-light.mjs'),
  'nord': () => import('shiki/themes/nord.mjs'),
  'one-dark-pro': () => import('shiki/themes/one-dark-pro.mjs'),
  'one-light': () => import('shiki/themes/one-light.mjs'),
  'poimandres': () => import('shiki/themes/poimandres.mjs'),
  'rose-pine': () => import('shiki/themes/rose-pine.mjs'),
  'rose-pine-dawn': () => import('shiki/themes/rose-pine-dawn.mjs'),
  'rose-pine-moon': () => import('shiki/themes/rose-pine-moon.mjs'),
  'slack-dark': () => import('shiki/themes/slack-dark.mjs'),
  'slack-ochin': () => import('shiki/themes/slack-ochin.mjs'),
  'snazzy-light': () => import('shiki/themes/snazzy-light.mjs'),
  'solarized-dark': () => import('shiki/themes/solarized-dark.mjs'),
  'solarized-light': () => import('shiki/themes/solarized-light.mjs'),
  'synthwave-84': () => import('shiki/themes/synthwave-84.mjs'),
  'tokyo-night': () => import('shiki/themes/tokyo-night.mjs'),
  'vesper': () => import('shiki/themes/vesper.mjs'),
  'vitesse-black': () => import('shiki/themes/vitesse-black.mjs'),
  'vitesse-dark': () => import('shiki/themes/vitesse-dark.mjs'),
  'vitesse-light': () => import('shiki/themes/vitesse-light.mjs'),
};

/** The code colours for each mode: a Shiki theme, an inline TextMate theme, or null for Demo Time's. */
export interface SyntaxChoice {
  light: ThemeSyntax | null;
  dark: ThemeSyntax | null;
}

/** A short stable hash, so an inline theme's id changes when its rules do. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** The name Shiki knows a mode's code colours by: `demotime-dark`, `nord`, or `inline-dark-<hash>`. */
export function syntaxThemeId(syntax: ThemeSyntax | null, mode: ThemeMode): string {
  if (!syntax) return `demotime-${mode}`;
  if (typeof syntax === 'string') return syntax;
  return `inline-${mode}-${hash(JSON.stringify(syntax.tokenColors))}`;
}

/**
 * An inline TextMate theme as Shiki takes it: only its rules' scopes, foreground and font style (already
 * validated as colours and italic/bold/underline). Its own editor colours are never read: the code
 * background is always the app's `code-bg`.
 */
export function inlineRegistration(theme: InlineSyntaxTheme, id: string, mode: ThemeMode): ThemeRegistration {
  return {
    name: id,
    type: theme.type ?? mode,
    colors: {},
    tokenColors: theme.tokenColors.map((rule) => ({
      ...(rule.scope !== undefined ? { scope: rule.scope } : {}),
      settings: {
        ...(rule.settings.foreground ? { foreground: rule.settings.foreground } : {}),
        ...(rule.settings.fontStyle !== undefined ? { fontStyle: rule.settings.fontStyle.trim() } : {}),
      },
    })),
  } as ThemeRegistration;
}

/** Demo Time's Shiki themes without font styles, so code looks as it always has (colours only). */
const plainColors = (theme: ThemeRegistration): ThemeRegistration => ({
  ...theme,
  tokenColors: theme.tokenColors?.map((rule) => ({ ...rule, settings: { ...rule.settings, fontStyle: undefined } })),
});

let choice: SyntaxChoice = { light: null, dark: null };
let current = { light: 'demotime-light', dark: 'demotime-dark' };

/** The syntax themes in use, as a key: highlighted HTML is cached per key, so a theme change never shows stale colours. */
export const syntaxKey = () => `${current.light}|${current.dark}`;

/** Switches the code colours (from the active theme); returns the new key. Blocks highlight again when it changes. */
export function setSyntaxThemes(next: SyntaxChoice): string {
  choice = next;
  current = { light: syntaxThemeId(next.light, 'light'), dark: syntaxThemeId(next.dark, 'dark') };
  return syntaxKey();
}

/** What the cache stores a block under: the syntax themes, the grammar and the code. */
export const highlightCacheKey = (key: string, grammar: string, code: string) => `${key}\u0000${grammar}\u0000${code}`;

let highlighter: Promise<HighlighterCore> | undefined;
const loaded = new Set<string>();
/**
 * Highlighted HTML by syntax themes, grammar and code, capped by size: a block Claude is still writing is
 * highlighted again as it grows, and each of those copies counts against the budget.
 */
const cache = new SizedCache(4_000_000);
const MAX_CODE = 50_000;

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, light, dark] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      // The Demo Time theme's syntax colours (github.com/estruyf/vscode-demo-time-theme), to match the app.
      import('./themes/demotime-light.json'),
      import('./themes/demotime-dark.json'),
    ]);
    const themes = [light.default, dark.default].map((t) => plainColors(t as unknown as ThemeRegistration));
    return createHighlighterCore({ themes, langs: [], engine: createJavaScriptRegexEngine() });
  })();
  // A failed load (a chunk that didn't arrive) is tried again next time instead of failing forever.
  highlighter.catch(() => (highlighter = undefined));
  return highlighter;
}

/** Loads a mode's syntax theme into Shiki the first time it is used. */
async function ensureTheme(shiki: HighlighterCore, syntax: ThemeSyntax | null, mode: ThemeMode, id: string): Promise<void> {
  if (!syntax || shiki.getLoadedThemes().includes(id)) return;
  if (typeof syntax === 'string') {
    const module = await SYNTAX_THEMES[syntax as ShikiThemeName]();
    await shiki.loadTheme(module.default as ThemeRegistration);
  } else await shiki.loadTheme(inlineRegistration(syntax, id, mode));
}

/** Shiki, the grammar and both modes' syntax themes, loaded; then the HTML. */
async function render(code: string, grammar: string, syntax: SyntaxChoice, themes: { light: string; dark: string }): Promise<string> {
  const shiki = await getHighlighter();
  if (!loaded.has(grammar)) {
    const module = (await GRAMMARS[grammar]!()) as { default: Parameters<HighlighterCore['loadLanguage']>[0] };
    await shiki.loadLanguage(module.default);
    loaded.add(grammar);
  }
  await ensureTheme(shiki, syntax.light, 'light', themes.light);
  await ensureTheme(shiki, syntax.dark, 'dark', themes.dark);
  // defaultColor false: both modes' colours stay CSS variables, so light and dark switch without highlighting again.
  return shiki.codeToHtml(code, { lang: grammar, themes, defaultColor: false });
}

/**
 * Highlighted HTML for a code block (both themes as CSS variables), or null
 * when the language isn't supported. Shiki, each grammar and each syntax theme load on first use.
 */
export async function highlight(code: string, language: string | undefined): Promise<string | null> {
  const grammar = grammarFor(language);
  if (!grammar || code.length > MAX_CODE) return null;
  const themes = { ...current };
  const key = highlightCacheKey(`${themes.light}|${themes.dark}`, grammar, code);
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const html = await render(code, grammar, choice, themes);
    cache.set(key, html);
    return html;
  } catch {
    // Highlighting is a nicety: the block stays plain text.
    return null;
  }
}

/** A sample in another theme's code colours (the import preview), without touching the active ones. */
export async function highlightWith(code: string, language: string, syntax: SyntaxChoice): Promise<string | null> {
  const grammar = grammarFor(language);
  if (!grammar) return null;
  try {
    return await render(code, grammar, syntax, { light: syntaxThemeId(syntax.light, 'light'), dark: syntaxThemeId(syntax.dark, 'dark') });
  } catch {
    return null;
  }
}

/** A mode's syntax theme as data (for its plain and comment colours in the contrast report). */
export async function syntaxThemeData(syntax: ThemeSyntax | null, mode: ThemeMode): Promise<{ colors?: Record<string, string>; tokenColors?: Array<{ scope?: string | string[]; settings?: { foreground?: string } }> }> {
  if (!syntax) return ((await (mode === 'light' ? import('./themes/demotime-light.json') : import('./themes/demotime-dark.json'))).default as never);
  if (typeof syntax === 'string') return (await SYNTAX_THEMES[syntax as ShikiThemeName]()).default as never;
  return syntax as never;
}

/** Language from a file path, for diffs and file contents. */
export function languageFromPath(path: string): string | undefined {
  const ext = /\.([a-z0-9+]+)$/i.exec(path)?.[1]?.toLowerCase();
  if (/(^|\/)Dockerfile$/.test(path)) return 'docker';
  return ext;
}
