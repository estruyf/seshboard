import { isAbsolutePath } from '@switchboard/protocol/paths';
import type { ContextItemInput } from '@switchboard/protocol/companion-client';

/**
 * Turning what is selected in VS Code into context items. Pure (no `vscode` import), so it can be tested: the
 * extension reads the editor, the Explorer and the Problems view into these plain shapes first.
 */

/** A selection in an editor, with VS Code's zero-based lines. */
export interface EditorSelection {
  /** The file's path; null for an untitled editor. */
  path: string | null;
  /** The editor's name, for an untitled one ("Untitled-1"). */
  name: string;
  startLine: number;
  endLine: number;
  /** Where the selection ends on its last line: at 0, that line isn't part of it. */
  endCharacter: number;
  isEmpty: boolean;
  /** The editor has changes that aren't saved: Claude would read the old file. */
  dirty: boolean;
  /** The selected text (the whole document when nothing is selected). */
  text: string;
  languageId: string;
}

export type SelectionResult =
  | { kind: 'item'; item: ContextItemInput }
  /** Its text can't be sent (the file is excluded, ignored or denied to Claude) and Claude can't read the unsaved version. */
  | { kind: 'withheld'; item: ContextItemInput; reason: string };

const base = (path: string) => path.split(/[\\/]/).pop() || path;

/** VS Code language ids that aren't the usual fence name. */
const FENCE: Record<string, string> = { typescriptreact: 'tsx', javascriptreact: 'jsx', shellscript: 'sh', plaintext: '' };
const fenceLanguage = (languageId: string) => (languageId in FENCE ? FENCE[languageId]! : /^[\w+#.-]{1,40}$/.test(languageId) ? languageId : '');

/** The lines a selection covers, counted from 1. A selection that ends at the start of a line leaves that line out. */
export function selectedLines(selection: Pick<EditorSelection, 'startLine' | 'endLine' | 'endCharacter'>): { start: number; end: number } {
  const last = selection.endCharacter === 0 && selection.endLine > selection.startLine ? selection.endLine - 1 : selection.endLine;
  return { start: selection.startLine + 1, end: last + 1 };
}

/**
 * The context for a selection: a reference to the file and its lines (or the whole file when nothing is selected), so
 * Claude reads it itself. Unsaved changes and untitled editors go as text, since Claude would read the file on disk;
 * unless the file's text is withheld (`withhold` says why), when only the reference goes.
 */
export function selectionItem(selection: EditorSelection, withhold: string | null = null): SelectionResult {
  const range = selection.isEmpty ? undefined : selectedLines(selection);
  const reference = (path: string): ContextItemInput => ({ kind: 'file', path, ...(range ? { range } : {}) });
  if (selection.path && !selection.dirty) return { kind: 'item', item: reference(selection.path) };
  if (selection.path && withhold) return { kind: 'withheld', item: reference(selection.path), reason: withhold };
  const name = selection.path ? base(selection.path) : selection.name;
  const where = range ? (range.start === range.end ? `Line ${range.start} of ${name}` : `Lines ${range.start}-${range.end} of ${name}`) : name;
  return {
    kind: 'item',
    item: {
      kind: 'text',
      source: 'selection',
      label: selection.path ? `${where} (unsaved)` : where,
      text: selection.text,
      ...(selection.path ? { path: selection.path } : {}),
      ...(range ? { range } : {}),
      language: fenceLanguage(selection.languageId),
    },
  };
}

/** Files and folders (the Explorer, open editors, changed files), each once, as references. */
export function resourceItems(resources: ReadonlyArray<{ path: string; directory: boolean }>): ContextItemInput[] {
  const seen = new Set<string>();
  const out: ContextItemInput[] = [];
  for (const resource of resources) {
    if (!isAbsolutePath(resource.path) || seen.has(resource.path)) continue;
    seen.add(resource.path);
    out.push({ kind: 'file', path: resource.path, directory: resource.directory });
  }
  return out;
}

/** A problem from the Problems view, with VS Code's zero-based position. */
export interface Problem {
  path: string;
  line: number;
  character: number;
  severity: 'error' | 'warning';
  message: string;
  source?: string;
  code?: string | number;
}

/** At most this many problems go in one message; the text says how many were left out. */
export const MAX_PROBLEMS = 200;

/**
 * Errors and warnings as text, one per line (`src/auth.ts:12:5 error TS2345: …`), errors first. `relative` shortens
 * paths for reading; `file` is the one file they are for, or null for the workspace.
 */
export function problemsItem(problems: readonly Problem[], relative: (path: string) => string, file: string | null): ContextItemInput | null {
  if (problems.length === 0) return null;
  const sorted = [...problems].sort((a, b) => Number(a.severity === 'warning') - Number(b.severity === 'warning') || a.path.localeCompare(b.path) || a.line - b.line);
  const lines = sorted.slice(0, MAX_PROBLEMS).map((p) => {
    const code = p.code !== undefined && p.code !== '' ? ` ${p.source ? `${p.source}(${p.code})` : p.code}` : p.source ? ` ${p.source}` : '';
    return `${relative(p.path)}:${p.line + 1}:${p.character + 1} ${p.severity}${code}: ${p.message.replace(/\s*\n\s*/g, ' ')}`;
  });
  if (sorted.length > MAX_PROBLEMS) lines.push(`… and ${sorted.length - MAX_PROBLEMS} more`);
  const errors = problems.filter((p) => p.severity === 'error').length;
  const warnings = problems.length - errors;
  const counts = [errors && `${errors} ${errors === 1 ? 'error' : 'errors'}`, warnings && `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`].filter(Boolean).join(', ');
  return {
    kind: 'text',
    source: 'problems',
    label: file ? `Problems in ${base(file)} (${counts})` : `Problems in the workspace (${counts})`,
    text: lines.join('\n'),
    ...(file ? { path: file } : {}),
  };
}

/** Selected terminal output, as text. Null for an empty selection. */
export function terminalItem(text: string, terminalName: string): ContextItemInput | null {
  // Terminals pad lines with spaces; keep the text, drop the padding.
  const cleaned = text.replace(/[ \t]+$/gm, '').replace(/^\n+|\n+$/g, '');
  if (!cleaned.trim()) return null;
  return { kind: 'text', source: 'terminal', label: terminalName ? `Terminal: ${terminalName}` : 'Terminal output', text: cleaned };
}

/** The paths the items are about, to find the session whose folder holds them. */
export function itemPaths(items: readonly ContextItemInput[]): string[] {
  return items.flatMap((item) => (item.kind === 'file' ? [item.path] : item.path ? [item.path] : []));
}

/** What the confirmation says was added: "auth.ts lines 12-40", "3 files", "Problems in auth.ts". */
export function describeItems(items: readonly ContextItemInput[]): string {
  if (items.length === 1) {
    const item = items[0]!;
    if (item.kind === 'text') return item.label;
    const name = base(item.path) + (item.directory ? '/' : '');
    return item.range ? `${name} ${item.range.start === item.range.end ? `line ${item.range.start}` : `lines ${item.range.start}-${item.range.end}`}` : name;
  }
  const files = items.filter((i) => i.kind === 'file').length;
  const texts = items.length - files;
  return [files && `${files} ${files === 1 ? 'file' : 'files'}`, texts && `${texts} ${texts === 1 ? 'text' : 'texts'}`].filter(Boolean).join(' and ');
}
