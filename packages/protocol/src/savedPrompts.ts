/**
 * Saved prompts with blanks. A blank is written in the text as `{{name}}` or `{{name:type}}`:
 *
 * - `text` (the default), `choice=a|b|c` (a dropdown of those options), `issue` (a GitHub issue), `pr` (a pull
 *   request), `branch` (a local branch) or `file` (a file in the project). An unknown type is `text`.
 * - A `?` after the name makes it optional: `{{context?}}`.
 * - The same name twice is one blank, filled once.
 * - `\{{` writes literal braces.
 *
 * Plain TypeScript without zod: the renderer parses and fills prompts too.
 */

export const BLANK_TYPES = ['text', 'choice', 'issue', 'pr', 'branch', 'file'] as const;
export type BlankType = (typeof BLANK_TYPES)[number];

/** A run of text between blanks, with escapes undone (`raw` is as written). */
export interface PromptText {
  kind: 'text';
  text: string;
  raw: string;
}

/** A blank, as written (`raw`) and as read. */
export interface PromptBlank {
  kind: 'blank';
  name: string;
  type: BlankType;
  /** A choice's options, in order; empty for the other types (and for a choice written without any). */
  options: string[];
  optional: boolean;
  raw: string;
}

export type PromptPart = PromptText | PromptBlank;

/** What a blank is, without where it was written. */
export type BlankSpec = Pick<PromptBlank, 'name' | 'type' | 'options' | 'optional'>;

/** The longest name of a saved prompt. */
export const PROMPT_NAME_MAX = 60;
/** The longest text of a saved prompt. */
export const PROMPT_TEXT_MAX = 20_000;

/** The longest blank name. */
export const BLANK_NAME_MAX = 40;

// Inside the braces: no braces at all, so `{{a{{b}}}}` is the text `{{a`, the blank `b` and the text `}}`.
const BLANK = /\{\{([^{}]*)\}\}/g;

/** Reads what is between `{{` and `}}`; null when it isn't a blank (no name, or a name that is too long). */
function readBlank(inside: string): BlankSpec | null {
  const colon = inside.indexOf(':');
  let name = (colon === -1 ? inside : inside.slice(0, colon)).trim();
  const spec = colon === -1 ? '' : inside.slice(colon + 1).trim();
  let optional = false;
  if (name.endsWith('?')) {
    optional = true;
    name = name.slice(0, -1).trim();
  }
  if (!name || name.length > BLANK_NAME_MAX) return null;
  const equals = spec.indexOf('=');
  const typeName = (equals === -1 ? spec : spec.slice(0, equals)).trim().toLowerCase();
  const type: BlankType = (BLANK_TYPES as readonly string[]).includes(typeName) ? (typeName as BlankType) : 'text';
  const options =
    type === 'choice' && equals !== -1
      ? spec
          .slice(equals + 1)
          .split('|')
          .map((option) => option.trim())
          .filter((option, i, all) => option !== '' && all.indexOf(option) === i)
      : [];
  return { name, type, options, optional };
}

/** Undoes `\{{` in a run of text. */
const unescape = (raw: string) => raw.replace(/\\\{\{/g, '{{');

/** The parts of a saved prompt: runs of text and blanks, in order. Neighbouring text is one run. */
export function parse(text: string): PromptPart[] {
  const parts: PromptPart[] = [];
  let rawText = '';
  const flush = () => {
    if (rawText) parts.push({ kind: 'text', text: unescape(rawText), raw: rawText });
    rawText = '';
  };
  let at = 0;
  BLANK.lastIndex = 0;
  for (let match = BLANK.exec(text); match; match = BLANK.exec(text)) {
    const start = match.index;
    // `\{{` is literal: the braces stay text, and the search goes on after them.
    if (start > 0 && text[start - 1] === '\\') {
      BLANK.lastIndex = start + 2;
      continue;
    }
    const blank = readBlank(match[1]!);
    if (!blank) {
      BLANK.lastIndex = start + 1;
      continue;
    }
    rawText += text.slice(at, start);
    flush();
    parts.push({ kind: 'blank', ...blank, raw: match[0] });
    at = start + match[0].length;
  }
  rawText += text.slice(at);
  flush();
  return parts;
}

/** The blanks of a prompt, one per name (as first written), in order. */
export function blanksOf(text: string | readonly PromptPart[]): PromptBlank[] {
  const parts = typeof text === 'string' ? parse(text) : text;
  const seen = new Set<string>();
  const out: PromptBlank[] = [];
  for (const part of parts) {
    if (part.kind !== 'blank' || seen.has(part.name)) continue;
    seen.add(part.name);
    out.push(part);
  }
  return out;
}

const valueOf = (values: Readonly<Record<string, string | undefined>>, name: string) => values[name]?.trim() ?? '';

/** The prompt with its blanks filled in, and literal braces as written. An empty blank leaves nothing. */
export function fill(text: string, values: Readonly<Record<string, string | undefined>>): string {
  return parse(text)
    .map((part) => (part.kind === 'text' ? part.text : valueOf(values, part.name)))
    .join('')
    .trim();
}

/** The names of the required blanks that are still empty, in order. */
export function missing(text: string, values: Readonly<Record<string, string | undefined>>): string[] {
  return blanksOf(text)
    .filter((blank) => !blank.optional && valueOf(values, blank.name) === '')
    .map((blank) => blank.name);
}

/** The prompt as plain text when you stop filling it in: the filled blanks stay, the empty ones become `[Label]`. */
export function toPlainText(text: string, values: Readonly<Record<string, string | undefined>>): string {
  return parse(text)
    .map((part) => (part.kind === 'text' ? part.text : valueOf(values, part.name) || `[${blankLabel(part)}]`))
    .join('');
}

/** How a blank is called on screen: its name with spaces for `_` and `-`, starting with a capital. */
export function blankLabel(blank: Pick<BlankSpec, 'name'>): string {
  const spaced = blank.name.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** What each type is called: in the Add blank menu, a chip's spoken label and its form. */
export const BLANK_TYPE_LABELS: Record<BlankType, string> = {
  issue: 'GitHub issue',
  pr: 'Pull request',
  branch: 'Branch',
  choice: 'Choice',
  text: 'Text',
  file: 'File',
};

/** The words for each type in a prompt's summary line ("2 blanks · issue, choice") and on a chip named after its type. */
export const BLANK_TYPE_WORDS: Record<BlankType, string> = { issue: 'issue', pr: 'pull request', branch: 'branch', choice: 'choice', text: 'text', file: 'file' };

/** "No blanks", "1 blank · issue", "2 blanks · pull request, branch": what a prompt asks for. */
export function blanksSummary(text: string): string {
  const blanks = blanksOf(text);
  if (blanks.length === 0) return 'No blanks';
  const types = [...new Set(blanks.map((blank) => BLANK_TYPE_WORDS[blank.type]))];
  return `${blanks.length === 1 ? '1 blank' : `${blanks.length} blanks`} · ${types.join(', ')}`;
}

/** "1 blank left", "2 blanks left": next to Send while required blanks are empty. */
export const blanksLeftText = (count: number) => (count === 1 ? '1 blank left' : `${count} blanks left`);

/** The start of a prompt for a list: its first line, with each blank as ▢, cut at `max`. */
export function promptPreview(text: string, max = 80): string {
  const flat = parse(text)
    .map((part) => (part.kind === 'text' ? part.text : '▢'))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** Writes a blank as it goes in the text: `{{name}}`, `{{name?:pr}}`, `{{env:choice=a|b}}`. */
export function blankSource(blank: BlankSpec): string {
  const name = `${blank.name}${blank.optional ? '?' : ''}`;
  if (blank.type === 'text') return `{{${name}}}`;
  if (blank.type === 'choice') return `{{${name}:choice=${blank.options.join('|')}}}`;
  return `{{${name}:${blank.type}}}`;
}

/** Text typed around blanks, written so it stays text: `{{` becomes `\{{`. */
export const escapeText = (text: string) => text.replace(/\{\{/g, '\\{{');

/** The text of a prompt from its parts (text runs as typed, blanks as written). */
export function joinParts(parts: readonly PromptPart[]): string {
  return parts.map((part) => (part.kind === 'text' ? escapeText(part.text) : part.raw)).join('');
}

/** A name that isn't used in the prompt yet: `issue`, then `issue-2`, `issue-3`. */
export function freeBlankName(text: string, wanted: string): string {
  const taken = new Set(blanksOf(text).map((blank) => blank.name));
  const base = wanted.slice(0, BLANK_NAME_MAX - 3) || 'blank';
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/**
 * What is wrong with a prompt's blanks, for the editor: a choice without options, a name used for two different kinds
 * of blank. Empty when it is fine.
 */
export function blankProblems(text: string): string[] {
  const problems: string[] = [];
  const first = new Map<string, PromptBlank>();
  for (const part of parse(text)) {
    if (part.kind !== 'blank') continue;
    if (part.type === 'choice' && part.options.length === 0 && !problems.some((p) => p.includes(`“${part.name}”`))) problems.push(`The choice “${part.name}” needs options.`);
    const earlier = first.get(part.name);
    if (!earlier) first.set(part.name, part);
    else if (earlier.type !== part.type || earlier.options.join('|') !== part.options.join('|')) {
      const problem = `“${part.name}” is used for two different blanks. Give each its own name.`;
      if (!problems.includes(problem)) problems.push(problem);
    }
  }
  return problems;
}

/** Where a saved prompt is kept. `global`: every project. `personal`: one project, just for you. `shared`: one project, in its actions file. */
export const PROMPT_SCOPES = ['global', 'personal', 'shared'] as const;
export type PromptScopeKind = (typeof PROMPT_SCOPES)[number];

/** What ordering needs of a saved prompt. */
export interface PromptUse {
  name: string;
  uses: number;
  lastUsedAt: number | null;
  updatedAt: number;
}

/** Most recently used first; never used ones after, newest first, then by name. */
export function byRecentUse<T extends PromptUse>(prompts: readonly T[]): T[] {
  return [...prompts].sort((a, b) => (b.lastUsedAt ?? -1) - (a.lastUsedAt ?? -1) || b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
}

/** Most used first, then most recently used (New session's chips). */
export function byMostUsed<T extends PromptUse>(prompts: readonly T[]): T[] {
  return [...prompts].sort((a, b) => b.uses - a.uses || (b.lastUsedAt ?? -1) - (a.lastUsedAt ?? -1) || a.name.localeCompare(b.name));
}
