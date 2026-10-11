import { detectEol, splitFrontmatter, yamlScalar } from '@switchboard/protocol';

/** The fields Switchboard edits; everything else in the frontmatter is kept as written. */
export interface FrontmatterChange {
  name?: string;
  description?: string;
  type?: string;
}

const indented = (line: string) => /^\s+\S/.test(line);
const blank = (line: string) => line.trim() === '';

/** Index of the top-level `key:` line, or -1. */
const topLevel = (lines: string[], key: string) => lines.findIndex((line) => line.startsWith(`${key}:`));

/** How many lines after `at` belong to its value (indented or blank lines before the next top-level key). */
function valueLines(lines: string[], at: number): number {
  let n = 0;
  while (at + 1 + n < lines.length && (indented(lines[at + 1 + n]!) || (blank(lines[at + 1 + n]!) && lines.slice(at + 2 + n).some(indented)))) n++;
  // Blank lines at the end of a block belong to whatever follows.
  while (n > 0 && blank(lines[at + n]!)) n--;
  return n;
}

/** Sets a top-level scalar, replacing its old value (a multi-line one too); a new key goes after `after` or at the top. */
function setTop(lines: string[], key: string, value: string, after?: string): void {
  const line = `${key}: ${yamlScalar(value)}`;
  const at = topLevel(lines, key);
  if (at !== -1) {
    lines.splice(at, 1 + valueLines(lines, at), line);
    return;
  }
  const anchor = after ? topLevel(lines, after) : -1;
  lines.splice(anchor === -1 ? 0 : anchor + 1 + valueLines(lines, anchor), 0, line);
}

/** Sets the type where it already is (top level or under `metadata:`), else under `metadata:`, as Claude Code writes it. */
function setType(lines: string[], type: string): void {
  if (topLevel(lines, 'type') !== -1) return setTop(lines, 'type', type);
  const meta = topLevel(lines, 'metadata');
  if (meta === -1) {
    lines.push('metadata:', `  type: ${yamlScalar(type)}`);
    return;
  }
  const end = meta + 1 + valueLines(lines, meta);
  for (let i = meta + 1; i < end; i++) {
    const match = /^(\s+)type:/.exec(lines[i]!);
    if (match) {
      lines.splice(i, 1, `${match[1]}type: ${yamlScalar(type)}`);
      return;
    }
  }
  const indent = /^(\s+)/.exec(lines[meta + 1] ?? '')?.[1] ?? '  ';
  lines.splice(meta + 1, 0, `${indent}type: ${yamlScalar(type)}`);
}

/**
 * A memory file with its name, description or type changed and its body replaced. Every other line of the frontmatter
 * (unknown fields, comments, `metadata` entries such as `originSessionId`) stays as it was, and so do the file's line
 * endings. A file without frontmatter gets one.
 */
export function editMemoryFile(text: string, change: FrontmatterChange, body?: string): string {
  const eol = detectEol(text);
  const { raw, body: oldBody } = splitFrontmatter(text);
  const lines = raw ? raw.split(/\r?\n/).slice(1).filter((_, i, all) => i < all.length - 1 || all[i] !== '') : [];
  // `raw` ends with the closing `---` (and maybe its newline): drop it to edit what is between.
  if (lines.at(-1)?.startsWith('---')) lines.pop();
  if (change.name !== undefined) setTop(lines, 'name', change.name);
  if (change.description !== undefined) setTop(lines, 'description', change.description.replace(/\s+/g, ' ').trim(), 'name');
  if (change.type !== undefined) setType(lines, change.type);
  const content = (body ?? oldBody).replace(/\r\n/g, '\n').replace(/^(?:[ \t]*\n)+/, '').trimEnd();
  const out = `---\n${lines.join('\n')}\n---\n\n${content}\n`;
  return eol === '\n' ? out : out.replace(/\n/g, eol);
}
