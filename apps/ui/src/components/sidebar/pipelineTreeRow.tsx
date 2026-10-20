import { ChevronRight, ListTree } from 'lucide-react';
import type { SidebarStyle } from '@switchboard/protocol/bridge';
import { memo, useMemo, type KeyboardEvent, type MouseEvent } from 'react';
import { isContextMenuKey } from '../../lib/contextMenu.ts';
import { childTone, stepMeta, stepOfSession, type ChildTone } from '../../state/pipelineTree.ts';
import { usePipelines } from '../../state/pipelinesStore.ts';
import type { SessionRowData } from '../../state/sessionsStore.ts';
import { rowStatus } from '../../state/sidebarRows.ts';
import { stepRowLabel } from './rowLabel.ts';

// The sidebar's pipelines tree (#179): the tile a run row has instead of a project icon, the chevron that opens a
// parent, and a sub-session's row under it.

/** A run row's tile, where a session has its project's icon: the pipeline icon in the pipeline colour. */
export function PipelineTile({ size }: { size: number }) {
  return (
    <span
      style={{ width: size, height: size, borderRadius: Math.max(3, Math.round(size * 0.22)) }}
      className="flex shrink-0 items-center justify-center bg-pipeline/15 text-pipeline"
      aria-hidden
      data-pipeline-tile
    >
      <ListTree size={Math.round(size * 0.62)} />
    </span>
  );
}

/**
 * A parent's chevron: right while closed, down while open. A click opens or closes the parent without opening it;
 * from the keyboard, → and ← on the row do the same (the row carries `aria-expanded`).
 */
export function TreeChevron({ open, count, onToggle }: { open: boolean; count: number; onToggle(): void }) {
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className="-my-1 flex size-5 shrink-0 items-center justify-center rounded text-faint hover:bg-border/60 hover:text-text"
      data-tooltip={open ? 'Hide steps' : `Show ${count} ${count === 1 ? 'step' : 'steps'}`}
      data-tree-toggle={open}
      aria-hidden
    >
      <ChevronRight size={13} className={`transition-transform duration-100 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} />
    </span>
  );
}

const TONE_DOT: Record<ChildTone, string> = {
  'needs-you': 'bg-warn animate-pulse',
  working: 'bg-accent-ink',
  done: 'bg-ok',
  failed: 'bg-error',
  unread: 'bg-unread',
  idle: 'bg-faint',
};

/** How tall a sub-session's button is in its row; the rest of the row is the gap below it. */
const STEP_BUTTON: Record<SidebarStyle, string> = { large: 'h-9', standard: 'h-[34px]', compact: 'h-6' };

/**
 * A sub-session under its parent: indented on a thin guide line, a dot in its state, the step's name (its title,
 * "Validate · round 2") and, below it, its model and state ("Opus · read only · working") or what it waits for.
 */
export const PipelineStepRow = memo(function PipelineStepRow({
  data,
  parentTitle,
  level,
  position,
  count,
  style,
  selected,
  beside,
  tabbable,
  waitingFor,
  onClick,
  onMenu,
  onMiddleClick,
}: {
  data: SessionRowData;
  parentTitle: string | null;
  /** Its depth in the tree (2 under a top-level row), and its place among its siblings. */
  level: number;
  position: number;
  count: number;
  style: SidebarStyle;
  selected: boolean;
  beside: boolean;
  tabbable: boolean;
  /** What it waits for, when it needs you ("Permission: Bash"). */
  waitingFor: string | null;
  onClick(event: MouseEvent, data: SessionRowData): void;
  onMenu(at: { x: number; y: number }, data: SessionRowData): void;
  onMiddleClick(data: SessionRowData): void;
}) {
  const runs = usePipelines((s) => s.runs);
  const step = useMemo(() => stepOfSession(runs.values(), data.id), [runs, data.id]);
  const status = rowStatus(data);
  const meta = step ? stepMeta(step.state, step.row) : null;
  const tone = childTone(status, step?.row.status ?? null);
  const line = waitingFor ?? meta;
  const emphasised = selected || status === 'needs-you' || status === 'running' || status === 'unread';
  const menuAt = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + 24, y: rect.top + Math.min(rect.height, 40) };
  };
  const surface = selected ? 'bg-selected' : beside ? 'bg-border/45 ring-1 ring-inset ring-border' : 'hover:bg-border/45';
  // Each level of the tree moves the row and its guide line one step right.
  const indent = 14 * (level - 1);
  return (
    <div className="relative h-full" style={{ paddingLeft: indent + 12 }} data-tree-child-row>
      <span aria-hidden className="absolute top-0 bottom-1 w-px bg-border" style={{ left: indent + 7 }} data-tree-guide />
      <button
        type="button"
        role="treeitem"
        aria-level={level}
        aria-posinset={position}
        aria-setsize={count}
        aria-selected={selected}
        aria-current={selected ? 'true' : undefined}
        aria-label={stepRowLabel({ title: data.title, parent: parentTitle, meta: line, status })}
        tabIndex={tabbable ? 0 : -1}
        data-session-id={data.id}
        data-tree-child={data.summary?.parentId ?? ''}
        data-indexed={data.summary !== null}
        data-tooltip={[data.title, line].filter(Boolean).join('\n')}
        onClick={(e) => onClick(e, data)}
        onAuxClick={(e) => {
          if (e.button !== 1) return;
          e.preventDefault();
          onMiddleClick(data);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(e.clientX === 0 && e.clientY === 0 ? menuAt(e.currentTarget) : { x: e.clientX, y: e.clientY }, data);
        }}
        onKeyDown={(e: KeyboardEvent<HTMLElement>) => {
          if (isContextMenuKey(e)) {
            e.preventDefault();
            onMenu(menuAt(e.currentTarget), data);
          }
        }}
        className={`relative flex w-full items-center gap-2 rounded-md pr-2.5 pl-2 text-left ${STEP_BUTTON[style]} ${surface}`}
      >
        <span aria-hidden className={`size-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} data-tree-dot={tone} />
        {style === 'compact' ? (
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className={`min-w-0 shrink truncate text-ui ${emphasised ? 'font-semibold text-text' : 'text-text/85'}`}>{data.title}</span>
            {line && <span className={`min-w-0 flex-1 truncate text-meta ${waitingFor ? 'font-medium text-warn' : 'text-faint'}`}>{line}</span>}
          </span>
        ) : (
          <span className="grid min-w-0 flex-1">
            <span className={`truncate text-ui leading-4 ${emphasised ? 'font-semibold text-text' : 'text-text/85'}`}>{data.title}</span>
            {line && <span className={`truncate text-meta leading-4 ${waitingFor ? 'font-medium text-warn' : 'text-faint'}`} data-tree-meta>{line}</span>}
          </span>
        )}
      </button>
    </div>
  );
});
