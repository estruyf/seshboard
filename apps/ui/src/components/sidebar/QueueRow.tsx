import { GripVertical, Play } from 'lucide-react';
import type { SidebarStyle } from '@seshboard/protocol/bridge';
import { memo, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { basename, shortAge } from '../../lib/format.ts';
import { savedAgo } from '../../state/focus.ts';
import { startQueued, useLater } from '../../state/laterStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { queueRowLabel, type QueueEntry } from '../../state/queue.ts';
import { QueueMark } from '../queue/QueueMark.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { Button } from '../ui/Button.tsx';

/** What a queued item's second line says: why it is ready, what it waits for, or where and when it was queued. */
export function queueMeta(entry: QueueEntry, projectName: string, now: number, filtered = false): string {
  if (entry.state === 'ready') return `Ready · ${entry.label}`;
  if (entry.state === 'waiting') return entry.label ?? 'Waiting';
  return [filtered ? null : projectName, `queued ${savedAgo(entry.item.createdAt, now)}`].filter(Boolean).join(' · ');
}

/** The look of a row per state: ready ones get a light green tint and a green edge, the rest the quiet hover. */
export const QUEUE_SURFACE: Record<QueueEntry['state'], string> = {
  ready: 'bg-ok/10 ring-1 ring-inset ring-ok/45 hover:bg-ok/15',
  waiting: 'hover:bg-border/45',
  queued: 'hover:bg-border/45',
};

interface QueueRowProps {
  entry: QueueEntry;
  now: number;
  style: SidebarStyle;
  /** The list's one Tab stop lands here. */
  tabbable: boolean;
  /** A drop would put the dragged item before or after this one. */
  mark: 'before' | 'after' | null;
  drag: {
    draggable: boolean;
    onDragStart(event: DragEvent<HTMLElement>): void;
    onDragEnd(): void;
    onDragOver(event: DragEvent<HTMLElement>): void;
    onDragLeave(event: DragEvent<HTMLElement>): void;
    onDrop(event: DragEvent<HTMLElement>): void;
  };
  onMenu(at: { x: number; y: number }, entry: QueueEntry): void;
  onKeyDown(event: KeyboardEvent<HTMLElement>, entry: QueueEntry): boolean;
}

/**
 * A queued item in the sidebar: its project, the prompt on one line, and what it waits for. A click opens it in New
 * session to check first (⌥-click too); Start starts it now. Ready items carry a green tint and an always-visible
 * Start; the others show Start on hover or focus. Drag the row by its grip to reorder.
 */
export const QueueRow = memo(function QueueRow({ entry, now, style, tabbable, mark, drag, onMenu, onKeyDown }: QueueRowProps) {
  const { item, state } = entry;
  const project = useProjects((s) => s.projects.get(item.cwd));
  const filtered = useProjects((s) => s.filter !== null);
  const projectName = project?.name ?? basename(item.cwd);
  const meta = queueMeta(entry, projectName, now, filtered);
  const ready = state === 'ready';
  const compact = style === 'compact';
  const menuAt = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + 24, y: rect.top + Math.min(rect.height, 40) };
  };
  const open = (event: MouseEvent) => {
    event.preventDefault();
    useLater.getState().use(item);
  };
  const start = (
    <Button
      variant={ready ? 'primary' : 'secondary'}
      size="sm"
      icon={<Play size={10} fill="currentColor" aria-hidden />}
      tabIndex={-1}
      onClick={() => void startQueued(item)}
      aria-label={`Start “${item.prompt.slice(0, 60)}” now`}
      className={`shrink-0 ${ready ? '' : 'opacity-0 group-hover/queue:opacity-100 group-focus-within/queue:opacity-100'}`}
      data-queue-start={item.id}
    >
      Start
    </Button>
  );

  return (
    <div
      className={`group/queue relative flex w-full items-center gap-2 rounded-lg pr-2 ${compact ? 'h-8 pl-2.5' : `pl-3 ${style === 'large' ? 'h-12' : 'h-11'}`} ${QUEUE_SURFACE[state]}`}
      data-queue-state={state}
      data-queue-autostart={entry.autoStart || undefined}
      {...drag}
    >
      {mark && <span aria-hidden className={`absolute inset-x-2 h-0.5 rounded-full bg-accent-ink ${mark === 'before' ? '-top-px' : '-bottom-px'}`} data-queue-drop={mark} />}
      {/* The grip only shows on hover: the whole row drags, the grip says it can. */}
      <GripVertical size={12} className="absolute left-0 shrink-0 cursor-grab text-faint opacity-0 group-hover/queue:opacity-100" aria-hidden />
      <button
        type="button"
        tabIndex={tabbable ? 0 : -1}
        data-queue-item={item.id}
        aria-label={entry.autoStart ? `Queued in ${projectName}: ${queueRowLabel(entry)}` : `Queued in ${projectName}: ${item.prompt.slice(0, 200)}. ${meta}`}
        data-tooltip={[item.prompt.length > 300 ? `${item.prompt.slice(0, 299)}…` : item.prompt, `${projectName} · queued ${savedAgo(item.createdAt, now)}`].join('\n')}
        onClick={open}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(e.clientX === 0 && e.clientY === 0 ? menuAt(e.currentTarget) : { x: e.clientX, y: e.clientY }, entry);
        }}
        onKeyDown={(e) => void onKeyDown(e, entry)}
        className="flex min-w-0 flex-1 items-center gap-2.5 self-stretch rounded-md text-left"
      >
        <ProjectIcon project={project} root={item.cwd} size={compact ? 16 : style === 'large' ? 24 : 18} />
        {compact ? (
          <>
            <span className="min-w-0 flex-1 truncate text-body text-text/85">{item.prompt}</span>
            {entry.autoStart && <QueueMark entry={entry} />}
            {!ready && <span className="shrink-0 text-meta text-faint tabular-nums group-hover/queue:hidden">{shortAge(item.createdAt, now)}</span>}
          </>
        ) : (
          <span className="grid min-w-0 flex-1 gap-px">
            <span className="min-w-0 truncate text-body leading-5 text-text/90">{item.prompt}</span>
            <span className={`flex min-w-0 items-center gap-1 text-meta ${ready ? 'text-ok' : 'text-faint'}`}>
              <QueueMark entry={entry} />
              <span className="min-w-0 truncate">{meta}</span>
            </span>
          </span>
        )}
      </button>
      {start}
    </div>
  );
});
