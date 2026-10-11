import type { ExportCandidate, ImportEntry, MemoryImportPreview } from '@switchboard/protocol/client';

/** What to paste in the Claude app to get its memory out as a list Switchboard can split. */
export const PASTE_PROMPT =
  'Write out every memory you have of me, verbatim, as a Markdown list: one bullet per memory, in your own words as you stored them. No introduction and nothing after the list.';

/** A row of the import preview as the dialog holds it: ticked or not, and where it goes. */
export interface ImportRow {
  entry: ImportEntry;
  checked: boolean;
  target: string;
}

export const rowsOf = (preview: MemoryImportPreview): ImportRow[] => preview.entries.map((entry) => ({ entry, checked: entry.checked, target: entry.target }));

/** The rows Import writes: ticked, and with somewhere to go. */
export const picked = (rows: readonly ImportRow[]) => rows.filter((r) => r.checked && r.target !== 'skip');

/** How many lines the personal MEMORY.md has after the import: one more for every new memory going there. */
export function personalLinesAfter(preview: MemoryImportPreview, rows: readonly ImportRow[]): number {
  return preview.personalIndexLines + picked(rows).filter((r) => r.target === 'personal' && r.entry.status === 'new').length;
}

/** The flags on a row, as the preview shows them (most important first). */
export function flagsOf(entry: ImportEntry, target: string): Array<{ label: string; tone: 'error' | 'caution' | 'muted' | 'link' }> {
  const flags: Array<{ label: string; tone: 'error' | 'caution' | 'muted' | 'link' }> = [];
  if (entry.secret) flags.push({ label: 'looks like a token', tone: 'error' });
  if (entry.duplicateOf) flags.push({ label: `duplicate of “${entry.duplicateOf}”`, tone: 'caution' });
  if (entry.noProject && target === 'personal') flags.push({ label: 'no matching project', tone: 'muted' });
  if (entry.status === 'newer') flags.push({ label: 'newer than yours', tone: 'link' });
  if (entry.status === 'same') flags.push({ label: 'already imported', tone: 'muted' });
  if (entry.status === 'older') flags.push({ label: 'older than yours', tone: 'muted' });
  return flags;
}

/** About you and how you work: what the Claude app should know. Project notes stay unticked. */
export const copiedByDefault = (memory: Pick<ExportCandidate, 'type'>) => memory.type === 'user' || memory.type === 'feedback';
