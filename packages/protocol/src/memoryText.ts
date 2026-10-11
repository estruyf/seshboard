/**
 * Pure helpers for Claude Code's memory and instruction files (Markdown with an optional YAML frontmatter), shared
 * by the engine, which writes them, and the UI, which previews them. Plain TypeScript, no zod.
 */

/** Claude Code loads the first 200 lines of MEMORY.md. */
export const MEMORY_INDEX_LIMIT = 200;

/** The four kinds of memory Claude Code writes. */
export const MEMORY_TYPES = ['project', 'feedback', 'reference', 'user'] as const;
export type MemoryKind = (typeof MEMORY_TYPES)[number];

/** `\r\n` when the text uses it, else `\n`. */
export const detectEol = (text: string): '\n' | '\r\n' => (text.includes('\r\n') ? '\r\n' : '\n');

/** The lines a file has, as an editor counts them (a final newline doesn't start another one). */
export function countLines(text: string): number {
  if (text === '') return 0;
  const lines = text.split(/\r?\n/);
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

const unquote = (value: string) => {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) return v.slice(1, -1);
  return v;
};

/** `[a, "b"]` as a list, anything else as a string. */
const scalar = (value: string): string | string[] => {
  const v = value.trim();
  if (v.startsWith('[') && v.endsWith(']'))
    return v
      .slice(1, -1)
      .split(',')
      .map(unquote)
      .filter(Boolean);
  return unquote(v);
};

export interface Frontmatter {
  /** Top-level keys; a nested block is an object, a `- item` block a list. Unknown keys are kept. */
  data: Record<string, unknown>;
  /** Everything after the closing `---` (and the blank lines after it). */
  body: string;
  /** The frontmatter block as written, `---` lines included (empty when there is none). */
  raw: string;
}

/**
 * Splits a file into its YAML frontmatter and body. Only the shapes Claude Code writes are read (`key: value`, a nested
 * block of `key: value`, a list of `- item`); anything else is skipped rather than failing.
 */
export function splitFrontmatter(text: string): Frontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match) return { data: {}, body: text, raw: '' };
  const data: Record<string, unknown> = {};
  let current: string | null = null;
  for (const line of match[1]!.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indented = /^\s+/.test(line);
    if (indented && current) {
      const item = /^\s+-\s*(.*)$/.exec(line);
      const pair = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      const existing = data[current];
      if (item) data[current] = [...(Array.isArray(existing) ? existing : []), unquote(item[1]!)];
      else if (pair) data[current] = { ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}), [pair[1]!]: scalar(pair[2]!) };
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!pair) {
      current = null;
      continue;
    }
    current = pair[1]!;
    data[current] = pair[2]!.trim() === '' ? null : scalar(pair[2]!);
  }
  const rest = text.slice(match[0].length).replace(/^(?:[ \t]*\r?\n)+/, '');
  return { data, body: rest, raw: match[0] };
}

const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** A memory's name, description and type from its frontmatter (type at the top level or under `metadata`). */
export function memoryMeta(data: Record<string, unknown>): { name: string | null; description: string | null; type: string | null; originSessionId: string | null; source: string | null } {
  const metadata = data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata) ? (data.metadata as Record<string, unknown>) : {};
  return {
    name: str(data.name),
    description: str(data.description),
    type: str(data.type) ?? str(metadata.type),
    originSessionId: str(metadata.originSessionId) ?? str(data.originSessionId),
    source: str(metadata.source) ?? str(data.source),
  };
}

/** A rule's `paths:` (a list, or one string), or undefined when it has none. */
export function rulePaths(data: Record<string, unknown>): string[] | undefined {
  const paths = data.paths;
  if (typeof paths === 'string' && paths.trim()) return paths.split(',').map((p) => p.trim()).filter(Boolean);
  if (Array.isArray(paths)) {
    const list = paths.filter((p): p is string => typeof p === 'string' && p.trim() !== '');
    return list.length ? list : undefined;
  }
  return undefined;
}

/** A piece of a memory's body: plain text, or a `[[name]]` / `[[name|label]]` link (as written in `raw`). */
export type BodyToken = { text: string } | { link: string; label: string; raw: string };

/**
 * A body split into text and `[[name]]` links. Links inside code (fenced blocks, `inline code`) and escaped ones
 * (`\[[`) stay text. Joining every token's `text`/`raw` gives the body back.
 */
export function bodyTokens(body: string): BodyToken[] {
  const tokens: BodyToken[] = [];
  let text = '';
  const flush = () => {
    if (text) tokens.push({ text });
    text = '';
  };
  let fence: string | null = null;
  for (const line of body.split(/(?<=\n)/)) {
    const marker = /^\s{0,3}(```|~~~)/.exec(line)?.[1];
    if (fence || marker) {
      if (marker && !fence) fence = marker;
      else if (marker === fence) fence = null;
      text += line;
      continue;
    }
    let i = 0;
    while (i < line.length) {
      if (line[i] === '\\' && line.startsWith('[[', i + 1)) {
        text += line.slice(i, i + 3);
        i += 3;
        continue;
      }
      if (line[i] === '`') {
        const ticks = /^`+/.exec(line.slice(i))![0];
        const close = line.indexOf(ticks, i + ticks.length);
        const end = close === -1 ? i + ticks.length : close + ticks.length;
        text += line.slice(i, end);
        i = end;
        continue;
      }
      if (line.startsWith('[[', i)) {
        const close = line.indexOf(']]', i + 2);
        const inner = close === -1 ? '' : line.slice(i + 2, close);
        if (close !== -1 && inner.trim() && !inner.includes('[') && !inner.includes(']')) {
          const [name, label] = inner.split('|', 2) as [string, string | undefined];
          flush();
          tokens.push({ link: name.trim(), label: (label ?? name).trim(), raw: line.slice(i, close + 2) });
          i = close + 2;
          continue;
        }
      }
      text += line[i];
      i++;
    }
  }
  flush();
  return tokens;
}

/** `[[name]]` links only resolve inside memory: elsewhere they become the plain name. */
export const flattenLinks = (text: string): string => text.replace(/\[\[([^\[\]\n]+?)\]\]/g, (_, name: string) => name.trim());

/** The heading a memory gets in the instructions: its name in Title Case (`sidebar-order` → "Sidebar Order"). */
export function defaultHeading(name: string): string {
  return name
    .replace(/\.md$/i, '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ');
}

/** A memory name from a heading: lower case, words joined by `-` ("Design system" → `design-system`). */
export function slugify(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'memory'
  );
}

/** The first sentence of a section, as plain text, for a memory's description. */
export function firstSentence(text: string, max = 150): string {
  let fenced = false;
  const plain = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    // Code blocks, headings, tables and comments aren't sentences.
    .filter((line) => {
      if (/^(```|~~~)/.test(line)) return (fenced = !fenced), false;
      return !fenced && line !== '' && !/^(#|\||<!--)/.test(line);
    })
    .map((line) => line.replace(/^([-*+]|\d+[.)])\s+/, ''))
    .join(' ')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const end = /[.!?](\s|$)/.exec(plain);
  const sentence = end ? plain.slice(0, end.index + 1) : plain;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

export interface MarkdownSection {
  level: number;
  /** The heading's text, without the `#`s. */
  title: string;
  /** Index of the heading's line. */
  line: number;
  /** Index of the line after the section: the next heading of the same or a higher level, or the end. */
  end: number;
}

/** Every heading of a Markdown file outside code fences, with where its section ends. */
export function parseSections(text: string): MarkdownSection[] {
  const lines = text.split(/\r?\n/);
  const found: Array<{ level: number; title: string; line: number }> = [];
  let fence: string | null = null;
  // A frontmatter block isn't part of the content.
  let start = 0;
  if (lines[0] === '---') {
    const close = lines.indexOf('---', 1);
    if (close > 0) start = close + 1;
  }
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    const fenceMatch = /^\s{0,3}(```|~~~)/.exec(line);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1]!;
      else if (fenceMatch[1] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) found.push({ level: heading[1]!.length, title: heading[2]!.trim(), line: i });
  }
  // A final newline leaves an empty last element, which isn't a line.
  const total = lines.at(-1) === '' ? lines.length - 1 : lines.length;
  return found.map((h, index) => {
    const next = found.slice(index + 1).find((n) => n.level <= h.level);
    return { ...h, end: next ? next.line : total };
  });
}

/** The text under a section's heading (its subsections too), without the heading, trimmed of blank lines. */
export function sectionBody(text: string, section: MarkdownSection): string {
  return text
    .split(/\r?\n/)
    .slice(section.line + 1, section.end)
    .join('\n')
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/(?:\n[ \t]*)+$/, '')
    .trimEnd();
}

/** Two headings are the same when their words are, whatever the case and spacing. */
export const sameHeading = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();

/** A one-line YAML value: as it is when that reads back the same, else double-quoted. */
export const yamlScalar = (v: string) => (v === '' || /^[\s"'[{>|*&!%@`#,?-]|: |\s#|[\n\r]|:$/.test(v) || v.trim() !== v || /^(true|false|null|~|yes|no|on|off|[-+]?\d[\d._]*(e[-+]?\d+)?)$/i.test(v) ? JSON.stringify(v) : v);

/** A memory file in the format Claude Code writes: name and description at the top, the type under `metadata`. */
export function memoryFileText({ name, description, type, body, metadata = {} }: { name: string; description: string; type: string; body: string; metadata?: Record<string, string> }): string {
  const extra = Object.entries(metadata)
    .map(([key, value]) => `\n  ${key}: ${yamlScalar(value)}`)
    .join('');
  return `---\nname: ${name}\ndescription: ${yamlScalar(description.replace(/\s+/g, ' ').trim())}\nmetadata:\n  type: ${type}${extra}\n---\n\n${body.trim()}\n`;
}

/** A memory's file name (without `.md`): letters, digits, `.`, `_` and `-`, not the index's name. */
export const validMemoryName = (name: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(name) && !/^memory$/i.test(name) && !name.endsWith('.md');

/** The line MEMORY.md gets for a memory: `- [Title](file.md) — hook`, as Claude Code writes them. */
export const memoryIndexLine = (title: string, file: string, hook: string) => `- [${title.trim()}](${file})${hook.trim() ? ` — ${hook.replace(/\s+/g, ' ').trim()}` : ''}`;
