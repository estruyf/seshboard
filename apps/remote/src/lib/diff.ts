/**
 * A unified diff as lines to draw: added, removed, the hunk headers, context, and the file headers git writes first
 * (left out). Pure, with tests.
 */
export interface DiffLine {
  kind: 'add' | 'del' | 'hunk' | 'context' | 'note';
  text: string;
}

const FILE_HEADER = /^(diff --git |index |--- |\+\+\+ |new file mode |deleted file mode |old mode |new mode |similarity index |rename from |rename to |Binary files )/;

export function diffLines(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let inHunk = false;
  for (const line of diff.replace(/\n$/, '').split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true;
      lines.push({ kind: 'hunk', text: line });
    } else if (!inHunk) {
      if (line.startsWith('Binary files ')) lines.push({ kind: 'note', text: 'A binary file: no diff to show.' });
      else if (line && !FILE_HEADER.test(line)) lines.push({ kind: 'note', text: line });
    } else if (line.startsWith('diff --git ')) inHunk = false;
    else if (line.startsWith('+')) lines.push({ kind: 'add', text: line.slice(1) });
    else if (line.startsWith('-')) lines.push({ kind: 'del', text: line.slice(1) });
    else if (line.startsWith('\\')) lines.push({ kind: 'note', text: line.slice(2) });
    else lines.push({ kind: 'context', text: line.slice(1) });
  }
  return lines;
}

/** "+120 −40 · 6 files" over a list of changed files. */
export function changesSummary(files: ReadonlyArray<{ additions: number; deletions: number }>): string {
  const add = files.reduce((sum, f) => sum + f.additions, 0);
  const del = files.reduce((sum, f) => sum + f.deletions, 0);
  return `+${add} −${del} · ${files.length} ${files.length === 1 ? 'file' : 'files'}`;
}
