import { z } from 'zod';
import { COLOR_PATTERN } from './color.ts';
import { FONT_STYLES, SHIKI_THEMES, THEME_FORMAT, THEME_MODES, THEME_NAME_MAX, THEME_SCHEMA_URL, THEME_TOKENS, type ThemeFile } from './themeFormat.ts';

export * from './themeFormat.ts';
export * from './color.ts';

const COLOR_HINT = 'Themes can only hold colour values: #hex, rgb(), hsl() or oklch().';
const colorRe = new RegExp(COLOR_PATTERN);

/** A colour value; everything else (url(), var(), color-mix(), named colours, `;`, `}`) is refused. */
const Color = z
  .string()
  // `abort`: a longer value is refused before the pattern looks at it.
  .max(80, { abort: true })
  .regex(colorRe, { error: COLOR_HINT })
  .meta({ description: 'A colour: #rgb, #rrggbb, #rrggbbaa, rgb(), hsl() or oklch().' });

const Comment = z.union([z.string(), z.array(z.string())]).optional().meta({ description: 'Notes for people reading the file; ignored.' });

const TOKEN_HELP: Partial<Record<(typeof THEME_TOKENS)[number], string>> = {
  bg: 'The conversation and the window background.',
  sidebar: 'The sidebar and other side panels.',
  card: 'Cards: your prompt, plans, permission and question cards, the message box.',
  popover: 'Menus, popovers and dialogs.',
  'code-bg': 'Code blocks and diffs.',
  border: 'Lines between areas.',
  'overlay-border': 'Borders on menus and dialogs, and on fields and chips inside them.',
  'overlay-shadow': 'The shadow colour under menus and dialogs (the app builds the layers).',
  paper: 'Reading mode: the page behind the text. Dark themes usually keep bg; light ones a slightly warm lift of it.',
  'paper-text': 'Reading mode: the text on the paper. Readable on paper.',
  selected: 'The selected row. Usually translucent; generated from text when missing.',
  'focus-ring': 'The outline around the focused control while you move with Tab.',
  scrim: 'The backdrop behind dialogs.',
  warn: 'Needs you: a permission or a question.',
  unread: 'Finished, unread.',
  memory: 'Claude Code memory: MEMORY.md in What loads here, memory pills.',
  remote: 'Things on another computer: its chips, badges and the line over its sessions. Readable on bg, sidebar and card.',
  trigger: 'Event triggers: the bolt on a session a trigger started, and event fields in a trigger\'s prompt.',
  pipeline: 'Pipelines: the pipeline icon on a parent and a run row, step kinds and @ links in the editor. Never a state.',
  accent: 'The yellow fill in Demo Time: primary buttons and tints.',
  'accent-ink': 'The accent as text, icons, dots and spinners: readable on bg.',
  'on-accent': 'Text on an accent fill.',
  'diff-added': 'The background of added lines.',
  'diff-removed': 'The background of removed lines.',
  'terminal-bg': 'The terminal panel (always dark).',
  'terminal-shadow': 'The shadow the terminal panel casts on the conversation.',
};

const Colors = z
  .object({
    $comment: Comment,
    ...Object.fromEntries(THEME_TOKENS.map((token) => [token, TOKEN_HELP[token] ? Color.meta({ description: TOKEN_HELP[token] }).optional() : Color.optional()])),
  })
  .meta({ description: 'Token overrides, by their --sb-* name without the prefix. They win over what canvas and accent generate.' });

const Terminal = z
  .object({
    $comment: Comment,
    background: Color.optional(),
    foreground: Color.optional(),
    cursor: Color.optional(),
    selection: Color.optional(),
    ansi: z.array(Color).length(16, { error: 'needs exactly 16 colours: the 8 normal ones, then the 8 bright ones.' }).optional(),
  })
  .meta({ description: "The terminal's colours. Only read from dark: the terminal panel is always dark." });

const FontStyle = z
  .string()
  .max(40)
  .regex(new RegExp(`^\\s*(?:(?:${FONT_STYLES.join('|')})(?:\\s+|$))*$`), { error: `can only use ${FONT_STYLES.join(', ')}.` });

/** An inline TextMate theme. Only `name`, `type` and `tokenColors` are read; editor colours are ignored. */
export const InlineSyntaxSchema = z.object({
  $comment: Comment,
  name: z.string().max(80).optional(),
  type: z.enum(THEME_MODES).optional(),
  tokenColors: z
    .array(
      z.object({
        name: z.string().max(200).optional(),
        scope: z.union([z.string().max(2000), z.array(z.string().max(500)).max(500)]).optional(),
        settings: z.object({ foreground: Color.optional(), fontStyle: FontStyle.optional() }),
      }),
    )
    .max(2000),
});

const Syntax = z
  .union([z.enum(SHIKI_THEMES), InlineSyntaxSchema])
  .meta({ description: "Code colours: one of Shiki's bundled themes by name, or an inline TextMate theme. Missing means Demo Time's." });

const Mode = z.object({
  $comment: Comment,
  canvas: Color.optional().meta({ description: 'The background every missing token is generated from.' }),
  accent: Color.optional().meta({ description: 'The accent every missing token is generated from.' }),
  colors: Colors.optional(),
  syntax: Syntax.optional(),
});

/** A theme file. At least one of `light` and `dark`; a missing mode uses Demo Time. */
export const ThemeFileSchema = z
  .object({
    $schema: z.string().max(500).optional(),
    $comment: Comment,
    name: z.string().trim().min(1, { error: 'is empty.' }).max(THEME_NAME_MAX, { error: `is longer than ${THEME_NAME_MAX} characters.` }),
    author: z.string().trim().max(120).optional(),
    version: z.literal(THEME_FORMAT).meta({ description: 'The theme format: 1.' }),
    light: Mode.optional(),
    dark: Mode.extend({ terminal: Terminal.optional() }).optional(),
  })
  .meta({ title: 'Seshboard theme', description: 'A colour theme for Seshboard. See docs/themes.md.' });

/** The JSON Schema for `$schema` (docs/switchboard-theme.schema.json is generated from this). */
export function themeJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(ThemeFileSchema, { io: 'input', target: 'draft-07' }) as Record<string, unknown>;
  return { ...schema, $id: THEME_SCHEMA_URL };
}

// --- Messages ---------------------------------------------------------------------------------

/** `dark.terminal.ansi[3]` for a zod path. */
const pathText = (path: ReadonlyArray<PropertyKey>) =>
  path.reduce<string>((out, key) => (typeof key === 'number' ? `${out}[${key}]` : out ? `${out}.${String(key)}` : String(key)), '');

const at = (raw: unknown, path: ReadonlyArray<PropertyKey>): unknown =>
  path.reduce<unknown>((value, key) => (value !== null && typeof value === 'object' ? (value as Record<PropertyKey, unknown>)[key] : undefined), raw);

/** How a refused value reads in a message: `url(…)`, or the value itself when it is short. */
function shortValue(value: unknown): string {
  if (typeof value !== 'string') return value === null ? 'null' : Array.isArray(value) ? 'a list' : typeof value === 'object' ? 'an object' : typeof value;
  const fn = /^\s*([a-z-]+)\(/i.exec(value);
  if (fn) return `${fn[1]}(…)`;
  return `“${value.length > 24 ? `${value.slice(0, 23)}…` : value}”`;
}

/** Edit distance, for "Did you mean …?". */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row[j]!;
      row[j] = next;
    }
  }
  return row[b.length]!;
}

/** The closest bundled Shiki theme to a name, if one is close enough to be a typo. */
export function closestShikiTheme(name: string): string | null {
  const lower = name.toLowerCase();
  let best: { theme: string; d: number } | null = null;
  for (const theme of SHIKI_THEMES) {
    // A name that is part of one ("solarized") is as close as the letters it misses.
    const d = theme.includes(lower) ? Math.min(distance(lower, theme), theme.length - lower.length) : distance(lower, theme);
    if (!best || d < best.d) best = { theme, d };
  }
  return best && best.d <= Math.max(3, Math.floor(name.length / 3)) ? best.theme : null;
}

/** The first problem with a syntax value, as a sentence after its path. */
function syntaxProblem(value: unknown): { path: PropertyKey[]; message: string } {
  if (typeof value === 'string') {
    const guess = closestShikiTheme(value);
    return { path: [], message: `uses ${shortValue(value)}, which isn't one of the code themes Seshboard ships.${guess ? ` Did you mean “${guess}”?` : ''}` };
  }
  const parsed = InlineSyntaxSchema.safeParse(value);
  const issue = parsed.success ? undefined : parsed.error.issues[0];
  if (!issue) return { path: [], message: 'must be the name of a code theme or an inline TextMate theme.' };
  return { path: issue.path as PropertyKey[], message: issueMessage(issue, at(value, issue.path)) };
}

function issueMessage(issue: z.core.$ZodIssue, value: unknown): string {
  if (value === undefined) return 'is missing.';
  if (issue.message === COLOR_HINT) return `uses ${shortValue(value)}. ${COLOR_HINT}`;
  if (issue.code === 'invalid_type') return `should be ${issue.expected === 'object' ? 'an object' : issue.expected === 'array' ? 'a list' : `a ${issue.expected}`}, not ${shortValue(value)}.`;
  if (issue.code === 'invalid_value') return `can't be ${JSON.stringify(value)}.`;
  if (issue.code === 'too_big' && issue.origin === 'array') return `has too many entries.`;
  if (issue.code === 'too_big' && issue.origin === 'string') return issue.message.startsWith('is ') ? issue.message : 'is too long.';
  return /^[a-z]/.test(issue.message) ? issue.message : `is not valid (${issue.message}).`;
}

/** Known keys at each level, to list the ones a file has that Seshboard ignores. */
const KNOWN: Record<string, readonly string[]> = {
  root: ['$schema', 'name', 'author', 'version', 'light', 'dark'],
  light: ['canvas', 'accent', 'colors', 'syntax'],
  dark: ['canvas', 'accent', 'colors', 'syntax', 'terminal'],
  colors: THEME_TOKENS,
  terminal: ['background', 'foreground', 'cursor', 'selection', 'ansi'],
  syntax: ['name', 'type', 'tokenColors'],
  rule: ['name', 'scope', 'settings'],
  settings: ['foreground', 'fontStyle'],
};

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Keys the app doesn't read, as paths (`colors.tab-bg`, `fonts`). `$`-keys (`$comment`) are never listed. */
export function ignoredThemeKeys(raw: unknown): string[] {
  const out: string[] = [];
  const walk = (value: unknown, level: string, path: string) => {
    if (!isObject(value)) return;
    for (const key of Object.keys(value)) {
      if (key.startsWith('$')) continue;
      const here = path ? `${path}.${key}` : key;
      if (!KNOWN[level]!.includes(key)) {
        out.push(here);
        continue;
      }
      const child = value[key];
      if (level === 'root' && (key === 'light' || key === 'dark')) walk(child, key, here);
      else if (key === 'colors' || key === 'terminal') walk(child, key, here);
      else if (key === 'syntax') walk(child, 'syntax', here);
      else if (level === 'syntax' && key === 'tokenColors' && Array.isArray(child)) child.forEach((rule, i) => walk(rule, 'rule', `${here}[${i}]`));
      else if (level === 'rule' && key === 'settings') walk(child, 'settings', here);
    }
  };
  walk(raw, 'root', '');
  return out;
}

/** Drops `$comment` and the keys nothing reads, so a stored theme only holds what the app uses. */
function clean(theme: z.infer<typeof ThemeFileSchema>): ThemeFile {
  return JSON.parse(JSON.stringify(theme, (key, value) => (key === '$comment' ? undefined : value))) as ThemeFile;
}

/**
 * Validates a parsed theme file. On success, the theme (unknown keys dropped) and the keys that were
 * ignored; otherwise the first problem, with its path: "dark.colors.bg uses url(…). Themes can only hold colour values…".
 */
export function parseThemeFile(raw: unknown): { theme: ThemeFile; ignored: string[] } | { error: string } {
  if (!isObject(raw)) return { error: 'This is not a Seshboard theme: the file should hold one JSON object.' };
  if (typeof raw.version === 'number' && raw.version > THEME_FORMAT) {
    return { error: `This theme was made for a newer Seshboard (format ${raw.version}). Update Seshboard, then import it again.` };
  }
  if (raw.light === undefined && raw.dark === undefined) return { error: 'This theme has neither a light nor a dark mode. It needs at least one.' };
  const parsed = ThemeFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const syntaxAt = issue.path.findIndex((key) => key === 'syntax');
    if (syntaxAt === 1 && issue.path.length >= 2) {
      const base = issue.path.slice(0, 2) as PropertyKey[];
      const problem = syntaxProblem(at(raw, base));
      return { error: `${pathText([...base, ...problem.path])} ${problem.message}` };
    }
    return { error: `${pathText(issue.path as PropertyKey[]) || 'The theme'} ${issueMessage(issue, at(raw, issue.path))}` };
  }
  return { theme: clean(parsed.data), ignored: ignoredThemeKeys(raw) };
}

/**
 * Reads JSON that may have comments and trailing commas (as VS Code's theme files do). Strings are
 * left alone; anything else that doesn't parse throws, as `JSON.parse` does.
 */
export function parseJsonc(text: string): unknown {
  let out = '';
  let i = 0;
  // Commas waiting to see whether a } or ] comes next (then they were trailing, and are dropped).
  let pendingComma = '';
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (/\s/.test(ch)) {
      if (pendingComma) pendingComma += ch;
      else out += ch;
      i++;
      continue;
    }
    if (pendingComma) {
      out += ch === '}' || ch === ']' ? pendingComma.slice(1) : pendingComma;
      pendingComma = '';
    }
    if (ch === ',') {
      pendingComma = ',';
      i++;
    } else if (ch === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      out += text.slice(start, ++i);
    } else {
      out += ch;
      i++;
    }
  }
  return JSON.parse(out + pendingComma);
}
