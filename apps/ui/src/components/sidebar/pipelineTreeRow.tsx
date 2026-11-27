import { ChevronRight, ListTree } from 'lucide-react';
import type { SidebarStyle } from '@seshboard/protocol/bridge';
import { memo, useMemo, type KeyboardEvent, type MouseEvent } from 'react';
import { isContextMenuKey } from '../../lib/contextMenu.ts';
import { childTone, stepMeta, stepOfSession, type ChildTone } from '../../state/pipelineTree.ts';
import { usePipelines } from '../../state/pipelinesStore.ts';
import { workerTitle } from '../../state/orchestrator.ts';
import { useOrchestrators } from '../../state/orchestratorStore.ts';
import type { SessionRowData } from '../../state/sessionsStore.ts';
import { rowStatus } from '../../state/sidebarRows.ts';
import { basename } from '../../lib/format.ts';
import { useMinimal } from '../../state/preferencesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { rowLeading, stepRowLabel } from './rowLabel.ts';
import { StatusIcon } from './StatusIcon.tsx';

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
export function TreeChevron({ open, count, noun = 'step', className = '', onToggle }: { open: boolean; count: number; noun?: 'step' | 'session'; className?: string; onToggle(): void }) {
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`-my-1 flex size-5 shrink-0 items-center justify-center rounded text-faint hover:bg-border/60 hover:text-text ${className}`}
      data-tooltip={open ? `Hide ${noun}s` : `Show ${count} ${count === 1 ? noun : `${noun}s`}`}
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
  archived = false,
  expanded,
  childCount = 0,
  onToggleTree,
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
  /** Under an archived parent, in Archived. */
  archived?: boolean;
  /**
   * It has sub-sessions of its own (a session it started asked for more): whether they show, and how many. Missing:
   * it has none, and the row has no chevron.
   */
  expanded?: boolean;
  childCount?: number;
  onToggleTree?(id: string): void;
  onClick(event: MouseEvent, data: SessionRowData): void;
  onMenu(at: { x: number; y: number }, data: SessionRowData): void;
  onMiddleClick(data: SessionRowData): void;
}) {
  const runs = usePipelines((s) => s.runs);
  const step = useMemo(() => stepOfSession(runs.values(), data.id), [runs, data.id]);
  const status = rowStatus(data);
  const minimal = useMinimal();
  const projectName = useProjects((s) => s.projects.get(data.projectRoot)?.name) ?? basename(data.projectRoot);
  // A session an orchestrator just started has no transcript yet: it goes by the title its orchestrator gave it.
  const startedTitle = useOrchestrators((s) => (data.summary ? null : workerTitle(s.orchestrators, data.id, s.started)));
  const title = startedTitle ?? data.title;
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
        aria-expanded={expanded}
        aria-posinset={position}
        aria-setsize={count}
        aria-selected={selected}
        aria-current={selected ? 'true' : undefined}
        aria-label={stepRowLabel({ title, parent: parentTitle, meta: line, status })}
        tabIndex={tabbable ? 0 : -1}
        data-session-id={data.id}
        data-tree-child={data.summary?.parentId ?? ''}
        data-archived={archived || undefined}
        data-indexed={data.summary !== null}
        data-tree-parent={expanded}
        data-tooltip={[title, line, projectName].filter(Boolean).join('\n')}
        data-row-leading={rowLeading('pipeline-step', { minimal })}
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
        {/* Its state at the left (rowLeading): Minimal mode's shape, or the coloured dot. */}
        {minimal ? <StatusIcon status={status} variant="minimal" /> : <span aria-hidden className={`size-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} data-tree-dot={tone} />}
        {style === 'compact' ? (
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className={`min-w-0 shrink truncate text-ui ${emphasised ? 'font-semibold text-text' : 'text-text/85'}`}>{title}</span>
            {line && <span className={`min-w-0 flex-1 truncate text-meta ${waitingFor ? 'font-medium text-warn' : 'text-faint'}`}>{line}</span>}
          </span>
        ) : (
          <span className="grid min-w-0 flex-1">
            <span className={`truncate text-ui leading-4 ${emphasised ? 'font-semibold text-text' : 'text-text/85'}`}>{title}</span>
            {line && <span className={`truncate text-meta leading-4 ${waitingFor ? 'font-medium text-warn' : 'text-faint'}`} data-tree-meta>{line}</span>}
          </span>
        )}
        {expanded !== undefined && onToggleTree && <TreeChevron open={expanded} count={childCount} noun="session" onToggle={() => onToggleTree(data.id)} />}
      </button>
    </div>
  );
});
