import { useCallback, useEffect, useImperativeHandle, type ReactNode, type RefObject, type Ref } from 'react';
import { defaultRangeExtractor, useVirtualizer, type Range, type VirtualItem } from '@tanstack/react-virtual';
import type { SidebarListRow } from '../../state/sidebarRows.ts';

/** What the sidebar asks of its list from outside: scrolling a row into view. */
export interface VirtualRowsHandle {
  scrollToIndex(index: number, options?: { align?: 'start' | 'center' | 'end' | 'auto' }): void;
}

/** The list's Tab stops among the rows that are rendered: the selected session, else the first one; with no session on screen, the first project header. */
export interface RowTabStops {
  sessionId: string | null;
  projectKey: string | null;
}

/** The key of a row in the list: by row, not by index, so a header that moves keeps its element. */
const rowKey = (row: SidebarListRow): string =>
  row.kind === 'session'
    ? row.data.id
    : row.kind === 'group'
      ? `group-${row.group}`
      : row.kind === 'hidden'
        ? `hidden-${row.group}`
        : row.kind === 'queue'
          ? `queue-${row.entry.item.id}`
          : row.kind === 'queue-header'
            ? 'queue-header'
            : row.kind === 'project' || row.kind === 'project-summary' || row.kind === 'queue-label'
              ? `${row.kind}-${row.key}`
              : 'archived-header';

/**
 * The sidebar's virtualised list: only the rows near the viewport exist, each item says where it sits in the whole list.
 * It lives apart from `Sidebar` so that scrolling re-renders this and the rows it shows, not the sidebar around it
 * (the virtualiser re-renders whatever component holds it, on every scroll step). `renderRow` is the sidebar's, with
 * whatever it knows; this asks it for the visible rows only.
 */
export function VirtualRows({
  rows,
  scrollRef,
  handle,
  estimateSize,
  measureKey,
  archivedIndex,
  selectedId,
  renderRow,
}: {
  rows: readonly SidebarListRow[];
  scrollRef: RefObject<HTMLDivElement | null>;
  handle: Ref<VirtualRowsHandle>;
  /** A row's height: the sizes are estimates, read again when `measureKey` changes. */
  estimateSize: (row: SidebarListRow) => number;
  measureKey: unknown;
  /** The Archived header is always rendered, even far below the fold: it slides in from the dock and keeps focus. */
  archivedIndex: number;
  selectedId: string | null;
  renderRow: (item: VirtualItem, row: SidebarListRow, tabStops: RowTabStops) => ReactNode;
}) {
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => estimateSize(rows[i]!),
    // Keyed by row, not index: archiving or unarchiving moves the headers without changing the count,
    // and the virtualiser only recomputes positions when the count or this function changes.
    getItemKey: useCallback((i: number) => rowKey(rows[i]!), [rows]),
    rangeExtractor: useCallback(
      (range: Range) => {
        const indexes = defaultRangeExtractor(range);
        return archivedIndex === -1 || indexes.includes(archivedIndex) ? indexes : [...indexes, archivedIndex].sort((a, b) => a - b);
      },
      [archivedIndex],
    ),
    overscan: 10,
  });
  useImperativeHandle(handle, () => ({ scrollToIndex: (index, options) => virtualizer.scrollToIndex(index, options) }), [virtualizer]);
  // Row heights change with the sidebar style: the sizes are estimates, which the virtualiser only reads again when
  // asked. New rows (and a header's height with its place: the first has less room above) need no call, because
  // getItemKey changes with `rows` and that recomputes every position. Measuring on every change of `rows` too
  // queued one more render per change, and a burst of new sessions ran into React's limit on nested updates.
  useEffect(() => virtualizer.measure(), [measureKey, virtualizer]);

  // One Tab stop for the whole list: the selected row while it's rendered, else the first rendered one.
  const items = virtualizer.getVirtualItems();
  const renderedIds = items.flatMap((item) => {
    const row = rows[item.index];
    return row?.kind === 'session' ? [row.data.id] : [];
  });
  const sessionId = selectedId && renderedIds.includes(selectedId) ? selectedId : (renderedIds[0] ?? null);
  // With every project folded and no session on screen, the first project's header is the Tab stop.
  const projectKey = sessionId === null ? ((items.map((item) => rows[item.index]).find((row) => row?.kind === 'project') as Extract<SidebarListRow, { kind: 'project' }> | undefined)?.key ?? null) : null;
  const tabStops: RowTabStops = { sessionId, projectKey };

  return (
    // A tree (#179): sessions are treeitems, a pipeline's parent opens to its sub-sessions. Being virtualised, the
    // levels are told with aria-level rather than nested groups.
    <div role="tree" aria-label="Sessions" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {items.map((item) => renderRow(item, rows[item.index]!, tabStops))}
    </div>
  );
}
