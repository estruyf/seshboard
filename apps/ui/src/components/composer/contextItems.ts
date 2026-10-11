import { isAbsolutePath, MAX_CONTEXT_ITEMS, pathInside, separatorOf, type ContextItem } from '@switchboard/protocol/client';
import { basename } from '../../lib/format.ts';

/** A chip in the context tray: an item to send with the message, and an id to remove it by. */
export type ContextChip = ContextItem & { id: string };

let nextId = 0;
/** Ids only need to be unique while the app runs (chips are saved with drafts, and get new ids when read back). */
const newId = () => `ctx-${Date.now().toString(36)}-${(nextId++).toString(36)}`;

/** The same file and lines, or the same text from the same place: added twice, it shows once. */
export function sameItem(a: ContextItem, b: ContextItem): boolean {
  if (a.kind === 'file' && b.kind === 'file') return a.path === b.path && a.range?.start === b.range?.start && a.range?.end === b.range?.end;
  if (a.kind === 'text' && b.kind === 'text') return a.source === b.source && a.text === b.text && a.path === b.path;
  return false;
}

/** Adds items after the chips already there, leaving out ones that are there already, up to the limit. */
export function addChips(current: readonly ContextChip[], items: readonly ContextItem[]): ContextChip[] {
  const next = [...current];
  for (const item of items) {
    if (next.length >= MAX_CONTEXT_ITEMS) break;
    if (next.some((chip) => sameItem(chip, item))) continue;
    next.push({ ...item, id: newId() } as ContextChip);
  }
  return next;
}

/**
 * `path` relative to `cwd` when it is inside it, otherwise as it is. Written with `/` on Windows too, as the `@`
 * file picker (from git) writes them.
 */
export function relativeTo(path: string, cwd: string | null): string {
  const inside = cwd ? pathInside(path, cwd) : null;
  if (!inside) return path;
  return separatorOf(cwd!) === '\\' ? inside.replace(/\\/g, '/') : inside;
}

/** A folder's path with one separator at the end, the one it is written with. */
export const asFolder = (path: string) => `${path.replace(/[\\/]+$/, '')}${separatorOf(path) === '\\' && !path.includes('/') ? '\\' : '/'}`;
const lines = (range: { start: number; end: number }) => (range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`);

/** What a chip shows (`auth.ts:12-40`, `src/`), and its tooltip (the path, relative to the session's folder). */
export function chipLabel(item: ContextItem, cwd: string | null): { label: string; detail: string } {
  if (item.kind === 'file') {
    const where = relativeTo(item.path, cwd);
    if (item.directory) return { label: `${basename(item.path)}/`, detail: asFolder(where) };
    const range = item.range ? `:${lines(item.range)}` : '';
    return { label: `${basename(item.path)}${range}`, detail: item.range ? `${where}, lines ${lines(item.range)}` : where };
  }
  const where = item.path ? relativeTo(item.path, cwd) + (item.range ? `, lines ${lines(item.range)}` : '') : null;
  const size = item.text.split('\n').length;
  return { label: item.label, detail: [where, size === 1 ? '1 line of text' : `${size} lines of text`].filter(Boolean).join(' · ') };
}

/**
 * The `@` mention for a file or folder, as Claude Code reads it: relative to the session's folder when inside it,
 * folders ending in `/`, a range of lines as `#L12-40`, and quoted when the path has spaces.
 */
export function mentionFor(item: Extract<ContextItem, { kind: 'file' }>, cwd: string | null): string {
  let target = relativeTo(item.path, cwd);
  if (item.directory) target = asFolder(target);
  if (!item.directory && item.range) target += `#L${lines(item.range)}`;
  return /\s/.test(target) ? `@"${target}"` : `@${target}`;
}

/** A code fence longer than any run of backticks in the text, so the text can't close it early. */
export function fenceFor(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * The message Claude gets: what you typed, then the files as `@` mentions on one line (Claude reads them itself), then
 * each piece of text in a fenced block under its label.
 */
export function promptWithContext(text: string, chips: readonly ContextItem[], cwd: string | null): string {
  const files = chips.filter((c): c is Extract<ContextItem, { kind: 'file' }> => c.kind === 'file');
  const texts = chips.filter((c): c is Extract<ContextItem, { kind: 'text' }> => c.kind === 'text');
  const parts = [text.trim()];
  if (files.length) parts.push(files.map((f) => mentionFor(f, cwd)).join(' '));
  for (const item of texts) {
    const fence = fenceFor(item.text);
    parts.push(`${item.label}:\n${fence}${item.language ?? ''}\n${item.text.replace(/\n+$/, '')}\n${fence}`);
  }
  return parts.filter(Boolean).join('\n\n');
}

/** Dropped files and folders, as context. */
export const droppedItems = (dropped: ReadonlyArray<{ path: string; directory: boolean }>): ContextItem[] =>
  dropped.filter((f) => isAbsolutePath(f.path)).map((f) => ({ kind: 'file', path: f.path, directory: f.directory }));

/** A short summary of chips for a list (the Unsent list, a sidebar row): "2 files", "1 file and 1 text". */
export function chipsSummary(chips: readonly ContextItem[]): string {
  const files = chips.filter((c) => c.kind === 'file').length;
  const texts = chips.length - files;
  const say = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
  return [files && say(files, 'file', 'files'), texts && say(texts, 'text', 'texts')].filter(Boolean).join(' and ');
}
