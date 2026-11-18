import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { TouchedFiles } from './touchedFiles.ts';
import { buildTree, treeKey, visibleRows, type FileTreeRow } from './fileTree.ts';

const ROW_PX = 26;
/** How far one level of the tree is indented. */
const INDENT_PX = 14;

interface FileTreeProps {
  /** `files.list`'s files; null while they load. */
  files: readonly string[] | null;
  truncated: boolean;
  /** Why the list couldn't be read. */
  error: string | null;
  open: ReadonlySet<string>;
  filter: string;
  onFilter(filter: string): void;
  onToggle(path: string, open: boolean): void;
  onOpen(path: string): void;
  /** The file in front of the viewer, relative: its row is selected. */
  selected: string | null;
  touched: TouchedFiles;
  /** Asks the tree to bring this folder into view and focus it (a breadcrumb was clicked). */
  reveal: { path: string; nonce: number } | null;
}

/**
 * The project's files as a tree (`role="tree"`): a filter on top, folders first, then files, a dot after the files
 * Claude changed or read in this session. Keys as the tree pattern has them: ↑ ↓ move, → opens a folder, ← closes it,
 * ↩ opens a file. Only the rows on screen are in the DOM.
 */
export function FileTree({ files, truncated, error, open, filter, onFilter, onToggle, onOpen, selected, touched, reveal }: FileTreeProps) {
  const root = useMemo(() => buildTree(files ?? []), [files]);
  const rows = useMemo(() => visibleRows(root, open, filter, files ?? []), [root, open, filter, files]);
  const [active, setActive] = useState(0);
  // Two panes can each show a tree: ids are the tree's own.
  const idBase = useId();
  const treeItemId = (path: string) => `${idBase}${path.replace(/[^\w-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)}`;
  const scrollRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_PX, overscan: 12 });

  // The file in front is the active row when it shows.
  useEffect(() => {
    const at = selected ? rows.findIndex((r) => r.path === selected) : -1;
    if (at >= 0) setActive(at);
  }, [selected, rows]);
  useEffect(() => {
    if (!reveal) return;
    const at = rows.findIndex((r) => r.path === reveal.path);
    if (at < 0) return;
    setActive(at);
    virtual.scrollToIndex(at, { align: 'center' });
    treeRef.current?.focus();
    // `rows` follows from opening the folder; the nonce asks again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal, rows]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = treeKey(event.key, rows, Math.min(active, rows.length - 1));
    if (!step) return;
    event.preventDefault();
    if (step.kind === 'move') {
      setActive(step.index);
      virtual.scrollToIndex(step.index);
    } else if (step.kind === 'toggle') onToggle(step.path, step.open);
    else onOpen(step.path);
  };
  const click = (row: FileTreeRow, index: number) => {
    setActive(index);
    if (row.dir) onToggle(row.path, !row.open);
    else onOpen(row.path);
  };
  const activeRow = rows[Math.min(active, rows.length - 1)];

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-files-tree="">
      <label className="mx-2 mt-2 mb-1.5 flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-edge bg-bg px-2 text-muted focus-within:border-focus-ring">
        <Search size={12} aria-hidden className="shrink-0" />
        <input
          aria-label="Filter files"
          placeholder="Filter files"
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && rows.length) (e.preventDefault(), setActive(0), treeRef.current?.focus());
            else if (e.key === 'Escape' && filter) (e.preventDefault(), e.stopPropagation(), onFilter(''));
            else if (e.key === 'Enter' && filter) {
              const first = rows.find((r) => !r.dir);
              if (first) (e.preventDefault(), onOpen(first.path));
            }
          }}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-ui text-text outline-none placeholder:text-faint"
          data-files-filter=""
        />
      </label>
      {error ? (
        <p className="px-3 py-2 text-ui text-error">{error}</p>
      ) : files === null ? (
        <div className="grid gap-1.5 px-3 py-2" aria-busy="true" aria-label="Loading files" data-files-loading="">
          {[60, 45, 70, 50, 38].map((w, i) => (
            <span key={i} className="h-4 rounded bg-border/50" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : files.length === 0 ? (
        <p className="px-3 py-2 text-ui text-muted">No files here.</p>
      ) : rows.length === 0 ? (
        <p className="px-3 py-2 text-ui text-muted">No files match.</p>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          <div
            ref={treeRef}
            role="tree"
            aria-label="Project files"
            tabIndex={0}
            aria-activedescendant={activeRow ? treeItemId(activeRow.path) : undefined}
            onKeyDown={onKeyDown}
            className="group/tree relative outline-none"
            style={{ height: virtual.getTotalSize() }}
          >
            {virtual.getVirtualItems().map((item) => {
              const row = rows[item.index]!;
              const state = row.dir ? null : touched.changed.has(row.path) ? 'changed' : touched.read.has(row.path) ? 'read' : null;
              const isSelected = !row.dir && row.path === selected;
              return (
                <div
                  key={row.path}
                  id={treeItemId(row.path)}
                  role="treeitem"
                  aria-level={row.depth + 1}
                  aria-expanded={row.dir ? row.open : undefined}
                  aria-selected={isSelected}
                  onClick={() => click(row, item.index)}
                  className={`absolute inset-x-0 flex cursor-default items-center gap-1 rounded-md pr-2 text-ui whitespace-nowrap ${isSelected ? 'bg-selected text-text' : 'text-text hover:bg-border/45'} ${item.index === active ? 'group-focus-visible/tree:outline-1 group-focus-visible/tree:-outline-offset-1 group-focus-visible/tree:outline-focus-ring' : ''}`}
                  style={{ top: item.start, height: ROW_PX, paddingLeft: 4 + row.depth * INDENT_PX }}
                  data-files-node={row.path}
                  data-files-dir={row.dir || undefined}
                  data-files-touched={state ?? undefined}
                >
                  <span className="flex w-3.5 shrink-0 justify-center text-faint" aria-hidden>
                    {row.dir ? row.open ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  {state && <span aria-label={state === 'changed' ? 'Changed in this session' : 'Read in this session'} className={`size-1.5 shrink-0 rounded-full ${state === 'changed' ? 'bg-accent-ink' : 'bg-faint'}`} />}
                </div>
              );
            })}
          </div>
          {truncated && <p className="px-2 pt-2 text-meta text-muted">Showing the first 50,000 files. Use Quick open or Search for the rest.</p>}
        </div>
      )}
      {(touched.changed.size > 0 || touched.read.size > 0) && (
        <p className="flex shrink-0 gap-3 px-3 py-1.5 text-meta text-muted" data-files-legend="">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-1.5 rounded-full bg-accent-ink" />
            changed
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-1.5 rounded-full bg-faint" />
            read
          </span>
        </p>
      )}
    </div>
  );
}
