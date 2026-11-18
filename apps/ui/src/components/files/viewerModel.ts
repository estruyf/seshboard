import type { UnifiedRow } from '../../lib/unifiedDiff.ts';

/**
 * The lines of a file Claude changed, from its diff: each new line, with the line it replaced (for the tooltip), or
 * null for a line that is new. Removed lines with nothing in their place mark the line after them.
 */
export function changedLines(rows: readonly UnifiedRow[]): Map<number, string | null> {
  const out = new Map<number, string | null>();
  let removed: string[] = [];
  let lastNew = 0;
  const flush = () => {
    // Lines only taken out: the line now where they were gets the mark, with what was there.
    if (removed.length && !out.has(lastNew + 1)) out.set(lastNew + 1, removed.join('\n'));
    removed = [];
  };
  for (const row of rows) {
    if (row.kind === 'del') removed.push(row.text);
    else if (row.kind === 'add') {
      out.set(row.newLine!, removed.length ? removed.shift()! : null);
      lastNew = row.newLine!;
    } else if (row.kind === 'same') {
      flush();
      lastNew = row.newLine!;
    } else flush();
  }
  flush();
  return out;
}

/** A heading of a Markdown file, for the outline: its level, its text, and which heading it is (from 0). */
export interface OutlineHeading {
  level: number;
  text: string;
  index: number;
}

/** The headings of a Markdown file in order, leaving out lines inside fenced code. */
export function markdownOutline(text: string): OutlineHeading[] {
  const out: OutlineHeading[] = [];
  let fence: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker[0]!.repeat(marker.length);
      else if (marker.startsWith(fence)) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) out.push({ level: heading[1]!.length, text: heading[2]!.replace(/[*_`]/g, ''), index: out.length });
  }
  return out;
}

/** "lines 6–12" or "line 6", for a selection's toolbar. */
export const lineSpan = (start: number, end: number) => (start === end ? `line ${start}` : `lines ${start}–${end}`);

/** The language a file's fence names: its extension, or nothing. */
export function fenceLanguage(path: string): string | undefined {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : undefined;
}
