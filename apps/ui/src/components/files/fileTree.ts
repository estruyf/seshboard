import { fuzzyScore } from '../../lib/fuzzy.ts';

/** A folder or file of the tree. Paths are relative to the project's folder, with `/`. */
export interface FileTreeNode {
  name: string;
  path: string;
  dir: boolean;
  /** A folder's folders, then its files, each by name. */
  children: FileTreeNode[];
}

/** A row the tree shows: a node at its depth, open or not. */
export interface FileTreeRow {
  path: string;
  name: string;
  depth: number;
  dir: boolean;
  open: boolean;
}

const byName = (a: FileTreeNode, b: FileTreeNode) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || (a.name < b.name ? -1 : 1) : a.dir ? -1 : 1);

/** The tree of `files` (relative paths with `/`, as `files.list` gives them): folders first, then files, by name. */
export function buildTree(files: readonly string[]): FileTreeNode {
  const root: FileTreeNode = { name: '', path: '', dir: true, children: [] };
  const folders = new Map<string, FileTreeNode>([['', root]]);
  const folder = (path: string): FileTreeNode => {
    const known = folders.get(path);
    if (known) return known;
    const slash = path.lastIndexOf('/');
    const node: FileTreeNode = { name: path.slice(slash + 1), path, dir: true, children: [] };
    folder(slash < 0 ? '' : path.slice(0, slash)).children.push(node);
    folders.set(path, node);
    return node;
  };
  for (const file of files) {
    if (!file) continue;
    const slash = file.lastIndexOf('/');
    folder(slash < 0 ? '' : file.slice(0, slash)).children.push({ name: file.slice(slash + 1), path: file, dir: false, children: [] });
  }
  for (const node of folders.values()) node.children.sort(byName);
  return root;
}

/** The folders a path is in, outermost first: `a/b/c.ts` is in `a` and `a/b`. */
export function parentFolders(path: string): string[] {
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

/** The files whose path matches `filter` (fuzzy, as Quick open), best first; every file without a filter. */
export function filterFiles(files: readonly string[], filter: string): Set<string> {
  const query = filter.trim();
  if (!query) return new Set(files);
  return new Set(files.filter((path) => fuzzyScore(query, path) !== null));
}

/**
 * The rows the tree shows: open folders show what is in them. With a filter, only the files that match show, with the
 * folders they are in, all open, so typing finds a file without opening folders by hand.
 */
export function visibleRows(root: FileTreeNode, open: ReadonlySet<string>, filter = '', files?: readonly string[]): FileTreeRow[] {
  const query = filter.trim();
  let keep: Set<string> | null = null;
  if (query) {
    keep = new Set();
    const all = files ?? allFiles(root);
    for (const path of filterFiles(all, query)) {
      keep.add(path);
      for (const parent of parentFolders(path)) keep.add(parent);
    }
  }
  const rows: FileTreeRow[] = [];
  const walk = (node: FileTreeNode, depth: number) => {
    for (const child of node.children) {
      if (keep && !keep.has(child.path)) continue;
      const isOpen = child.dir && (keep !== null || open.has(child.path));
      rows.push({ path: child.path, name: child.name, depth, dir: child.dir, open: isOpen });
      if (isOpen) walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return rows;
}

/** Every file under a node. */
export function allFiles(node: FileTreeNode): string[] {
  const out: string[] = [];
  const walk = (n: FileTreeNode) => n.children.forEach((c) => (c.dir ? walk(c) : out.push(c.path)));
  walk(node);
  return out;
}

/** What a key does on the tree's row `index` (the tree pattern): the row to move to, a folder to open or close, a file to open. */
export type TreeKeyStep = { kind: 'move'; index: number } | { kind: 'toggle'; path: string; open: boolean } | { kind: 'open'; path: string } | null;

export function treeKey(key: string, rows: readonly FileTreeRow[], index: number): TreeKeyStep {
  const row = rows[index];
  if (!rows.length) return null;
  if (key === 'ArrowDown') return { kind: 'move', index: Math.min(rows.length - 1, index + 1) };
  if (key === 'ArrowUp') return { kind: 'move', index: Math.max(0, index - 1) };
  if (key === 'Home') return { kind: 'move', index: 0 };
  if (key === 'End') return { kind: 'move', index: rows.length - 1 };
  if (!row) return null;
  if (key === 'ArrowRight') {
    if (!row.dir) return null;
    // An open folder: → steps into its first child.
    return row.open ? (rows[index + 1]?.depth === row.depth + 1 ? { kind: 'move', index: index + 1 } : null) : { kind: 'toggle', path: row.path, open: true };
  }
  if (key === 'ArrowLeft') {
    if (row.dir && row.open) return { kind: 'toggle', path: row.path, open: false };
    // Anything else: ← goes to the folder it is in.
    for (let i = index - 1; i >= 0; i--) if (rows[i]!.depth < row.depth) return { kind: 'move', index: i };
    return null;
  }
  if (key === 'Enter' || key === ' ') return row.dir ? { kind: 'toggle', path: row.path, open: !row.open } : { kind: 'open', path: row.path };
  return null;
}
