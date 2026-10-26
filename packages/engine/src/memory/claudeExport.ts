import { firstSentence, memoryMeta, slugify, splitFrontmatter, yamlScalar, type MemoryKind } from '@seshboard/protocol';

/**
 * The Claude app's data export, as far as memory goes. Undocumented and recently changed, so everything here is lenient:
 * a field that's missing or the wrong shape is skipped, never an error. Conversations are never read.
 */

/** One memory file of the export (`memory_files`), its Markdown already with frontmatter. */
export interface ExportFile {
  path: string;
  content: string;
  updatedAt: string | null;
}

export interface ParsedExport {
  files: ExportFile[];
  /** Claude project names by uuid (from `projects/<uuid>.json`). */
  projects: Map<string, string>;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown) => (typeof v === 'string' ? v : null);

/**
 * The memory files in one JSON document of the export: today's `memories/<account>.json` (`memory_files`), or the older
 * single `memories.json` array. `project_memories` and `conversations_memory` mostly repeat the files and are left out.
 */
export function memoryFilesOf(json: unknown): ExportFile[] {
  const list = Array.isArray(json) ? json : (obj(json)?.memory_files ?? obj(json)?.memories);
  if (!Array.isArray(list)) return [];
  return list.flatMap((item, i): ExportFile[] => {
    if (typeof item === 'string') return item.trim() ? [{ path: `/memory-${i + 1}.md`, content: item, updatedAt: null }] : [];
    const o = obj(item);
    const content = str(o?.content) ?? str(o?.text) ?? str(o?.memory);
    if (!o || !content?.trim()) return [];
    const path = str(o.path) ?? `/memory-${i + 1}.md`;
    return [{ path: path.startsWith('/') ? path : `/${path}`, content, updatedAt: str(o.updated_at) ?? str(o.updatedAt) }];
  });
}

/** A Claude project's uuid and name, from `projects/<uuid>.json` (or one entry of an older `projects.json` array). */
export function projectOf(json: unknown, fileUuid: string | null): { uuid: string; name: string } | null {
  const o = obj(json);
  const uuid = str(o?.uuid) ?? str(o?.id) ?? fileUuid;
  const name = str(o?.name);
  return uuid && name ? { uuid, name } : null;
}

/** Where an export path belongs and what type it gets (the table in the issue). */
export type Suggestion = { kind: 'personal' } | { kind: 'area'; name: string } | { kind: 'claude-project'; uuid: string };

export function suggestionFor(path: string): { type: MemoryKind; suggestion: Suggestion } {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'projects' && parts.length > 1) return { type: 'project', suggestion: { kind: 'claude-project', uuid: parts[1]! } };
  if (parts[0] === 'areas' && parts[1]) return { type: 'project', suggestion: { kind: 'area', name: parts[1].replace(/\.md$/i, '') } };
  if (parts[0] === 'people' || parts[0] === 'topics') return { type: 'reference', suggestion: { kind: 'personal' } };
  return { type: 'user', suggestion: { kind: 'personal' } };
}

/** An export file as it would be imported. */
export interface Candidate {
  /** The export path (stable across exports: a later import finds and updates it). */
  id: string;
  fileName: string;
  name: string;
  description: string;
  aliases: string[];
  body: string;
  updatedAt: string | null;
  type: MemoryKind;
  suggestion: Suggestion;
}

/**
 * The export's files as candidates: name, description and aliases from their frontmatter (`sources` points at
 * claude.ai conversations and is dropped), the body, a type and where they would go. File names are the last part of
 * the path; when two collide, the folders (a Claude project by its name) are put in front: `projects-website-overview.md`.
 */
export function candidatesOf(parsed: ParsedExport): Candidate[] {
  const base = (path: string) => slugify(path.split('/').pop()!.replace(/\.md$/i, '')) || 'memory';
  const counts = new Map<string, number>();
  for (const file of parsed.files) counts.set(base(file.path), (counts.get(base(file.path)) ?? 0) + 1);
  return parsed.files.map((file) => {
    const { data, body } = splitFrontmatter(file.content);
    const meta = memoryMeta(data);
    const { type, suggestion } = suggestionFor(file.path);
    const parts = file.path.split('/').filter(Boolean);
    const folders = parts.slice(0, -1).map((part, i) => (parts[0] === 'projects' && i === 1 ? slugify(parsed.projects.get(part) ?? part) : slugify(part)));
    const fileName = counts.get(base(file.path))! > 1 && folders.length ? `${[...folders, base(file.path)].join('-')}.md` : `${base(file.path)}.md`;
    const aliases = Array.isArray(data.aliases) ? data.aliases.filter((a): a is string => typeof a === 'string') : typeof data.aliases === 'string' ? [data.aliases] : [];
    return {
      id: file.path,
      fileName,
      name: meta.name ?? fileName.replace(/\.md$/, ''),
      description: meta.description ?? firstSentence(body),
      aliases,
      body: body.trim(),
      updatedAt: file.updatedAt,
      type,
      suggestion,
    };
  });
}

/**
 * A memory file for an imported entry, in Claude Code's format: name, description and aliases at the top; the type and
 * where it came from (`source: claude-app`, the export's `path` and `updated_at`) under `metadata`.
 */
export function importedFileText(c: Pick<Candidate, 'id' | 'name' | 'description' | 'aliases' | 'body' | 'updatedAt'>, type: string, source = 'claude-app'): string {
  const lines = ['---', `name: ${yamlScalar(c.name)}`, `description: ${yamlScalar(c.description.replace(/\s+/g, ' ').trim())}`];
  if (c.aliases.length) lines.push('aliases:', ...c.aliases.map((a) => `  - ${yamlScalar(a)}`));
  lines.push('metadata:', `  type: ${type}`, `  source: ${source}`);
  if (!c.id.startsWith('paste:')) lines.push(`  path: ${yamlScalar(c.id)}`);
  if (c.updatedAt) lines.push(`  updated_at: ${yamlScalar(c.updatedAt)}`);
  lines.push('---', '', c.body.trim(), '');
  return lines.join('\n');
}

/**
 * Text pasted from the Claude app ("write out your memories of me") as candidates: one per heading section, else one per
 * bullet (with the lines under it), else one per paragraph. It is data: shown and written to files, never sent to Claude.
 */
export function candidatesFromPaste(text: string): Candidate[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const chunks: string[] = [];
  if (lines.some((l) => /^#{1,6}\s+\S/.test(l))) {
    let current: string[] = [];
    for (const line of lines) {
      if (/^#{1,6}\s+\S/.test(line) && current.join('').trim()) {
        chunks.push(current.join('\n'));
        current = [];
      }
      current.push(line);
    }
    chunks.push(current.join('\n'));
  } else if (lines.some((l) => /^\s*([-*•]|\d+[.)])\s+\S/.test(l))) {
    let current: string[] = [];
    for (const line of lines) {
      if (/^([-*•]|\d+[.)])\s+\S/.test(line)) {
        if (current.join('').trim()) chunks.push(current.join('\n'));
        current = [line.replace(/^([-*•]|\d+[.)])\s+/, '')];
      } else if (current.length && (/^\s+\S/.test(line) || line.trim() === '')) current.push(line.trim());
      // Text before the first bullet ("Here is what I remember:") is the app talking, not a memory.
    }
    if (current.join('').trim()) chunks.push(current.join('\n'));
  } else {
    chunks.push(...text.split(/\n\s*\n/));
  }
  const used = new Map<string, number>();
  return chunks
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk, i) => {
      const heading = /^#{1,6}\s+(.+)$/m.exec(chunk.split('\n')[0]!)?.[1];
      const body = heading ? chunk.split('\n').slice(1).join('\n').trim() || heading : chunk;
      // A name from the heading, else the first words of the first sentence.
      let slug = slugify((heading ?? firstSentence(body)).split(/\s+/).slice(0, 5).join(' '));
      const n = (used.get(slug) ?? 0) + 1;
      used.set(slug, n);
      if (n > 1) slug = `${slug}-${n}`;
      return { id: `paste:${i}`, fileName: `${slug}.md`, name: slug, description: firstSentence(body), aliases: [], body, updatedAt: null, type: 'user' as MemoryKind, suggestion: { kind: 'personal' as const } };
    });
}

/** Words of a description, for telling near-duplicates apart. */
const words = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => w.length > 2) ?? []);

/** Whether two descriptions say nearly the same thing: at least 3 words each and 70% of them shared. */
export function similar(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (x.size < 3 || y.size < 3) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / new Set([...x, ...y]).size >= 0.7;
}

/** The text for the Claude app's memory import: one bullet per memory, plain sentences. */
export function textForClaudeApp(memories: ReadonlyArray<{ name: string; description: string | null; body: string }>): string {
  const flat = (text: string) =>
    text
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, name: string, label?: string) => label ?? name)
      .replace(/^#+\s+/gm, '')
      .replace(/\s*\n\s*/g, ' ')
      .trim();
  const items = memories.map((m) => `- ${flat(m.body) || flat(m.description ?? m.name)}`);
  return `Please remember these things about me and how I like to work:\n\n${items.join('\n')}\n`;
}
