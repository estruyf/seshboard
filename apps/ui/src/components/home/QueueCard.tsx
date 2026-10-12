import { Clock, GripVertical, ListEnd, MoreHorizontal, Play, Plus } from 'lucide-react';
import { savedAgo } from '../../state/focus.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { startQueued, useLater } from '../../state/laterStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import type { QueueEntry } from '../../state/queue.ts';
import { useQueue, useProjectName } from '../../state/useQueue.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { useQueueMenu } from '../queue/queueMenu.tsx';
import { useQueueDrag } from '../queue/useQueueDrag.ts';
import { QUEUE_SURFACE } from '../sidebar/QueueRow.tsx';
import { Button } from '../ui/Button.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { modelLabel } from '../../lib/autoModel.ts';

/**
 * Home's Queue: every queued prompt in order, the full width under Needs you and Working. Each row says why it is
 * ready or what it waits for, and its choices; Start (yellow) when ready, Start now otherwise. Drag by the grip or
 * ⌥↑ ⌥↓ to reorder; a click on the prompt opens it in New session to check first.
 */
export function QueueCard({ now }: { now: number }) {
  const queue = useQueue();
  const menus = useQueueMenu(queue.rows);
  const drag = useQueueDrag();
  const projectName = useProjectName();
  const models = useHosts((s) => s.models);
  const projects = useProjects((s) => s.projects);
  if (queue.entries.length === 0) return null;

  const meta = ({ item, state, detail }: QueueEntry) => {
    // Auto shows as Auto: a queued prompt is routed when it starts.
    const model = item.model ? modelLabel(models, item.model) : null;
    const choices = [model, item.workspace === 'worktree' ? 'worktree' : item.branch ? `on ${item.branch}` : null].filter(Boolean);
    const rest = [state === 'ready' ? null : projectName(item.cwd), ...choices, `queued ${savedAgo(item.createdAt, now)}`].filter(Boolean).join(' · ');
    return { lead: detail, rest };
  };

  return (
    <section aria-labelledby="home-queue" className="grid gap-1 rounded-xl border border-border bg-card p-3" data-home-queue>
      <div className="flex min-w-0 items-center gap-3 px-1 pb-1">
        <SectionHeader
          as="h2"
          headingId="home-queue"
          count={queue.entries.length}
          action={queue.readyCount > 0 && <span className="text-meta font-medium tracking-normal text-ok normal-case">{queue.readyCount} ready</span>}
          className="min-w-0 flex-1"
        >
          <ListEnd size={13} className="shrink-0" aria-hidden />
          Queue
        </SectionHeader>
        <span className="flex shrink-0 items-center gap-1 text-meta text-faint @max-[640px]:hidden">
          Drag to reorder · <Kbd keys="⌥" /> <Kbd keys="↑" /> <Kbd keys="↓" />
        </span>
        <Button icon={<Plus size={13} aria-hidden />} onClick={() => useSessions.getState().openNewSession()} className="shrink-0" data-home-queue-add>
          Add to queue
        </Button>
      </div>
      <ul className="grid gap-0.5">
        {queue.entries.map((entry) => {
          const { item, state } = entry;
          const ready = state === 'ready';
          const { lead, rest } = meta(entry);
          const mark = drag.markFor(item.id);
          return (
            <li
              key={item.id}
              tabIndex={0}
              className={`group/queue relative flex min-w-0 items-center gap-2.5 rounded-lg py-2 pr-2 pl-1 ${QUEUE_SURFACE[state]}`}
              data-queue-item={item.id}
              data-queue-state={state}
              aria-label={`Queued in ${projectName(item.cwd)}: ${item.prompt.slice(0, 200)}. ${[lead, rest].filter(Boolean).join(', ')}`}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (!menus.onKeyDown(e, entry) && e.key === 'Enter') useLater.getState().use(item);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                menus.openMenu({ x: e.clientX, y: e.clientY }, entry);
              }}
              {...drag.props(item.id)}
            >
              {mark && <span aria-hidden className={`absolute inset-x-2 h-0.5 rounded-full bg-accent-ink ${mark === 'before' ? '-top-px' : '-bottom-px'}`} />}
              <GripVertical size={14} className="shrink-0 cursor-grab text-faint" aria-hidden />
              <ProjectIcon project={projects.get(item.cwd)} root={item.cwd} size={22} />
              <button type="button" tabIndex={-1} onClick={() => useLater.getState().use(item)} className="grid min-w-0 flex-1 gap-px text-left" data-tooltip="Open in New session to check it first">
                <span className="truncate text-body text-text">{item.prompt}</span>
                <span className="flex min-w-0 items-center gap-1 text-meta text-faint">
                  {state === 'waiting' && <Clock size={11} className="shrink-0" aria-hidden />}
                  <span className="min-w-0 truncate">
                    {lead && <span className={ready ? 'text-ok' : ''}>{lead}</span>}
                    {lead && rest && ' · '}
                    {rest}
                  </span>
                </span>
              </button>
              <Button
                variant="quiet"
                size="sm"
                iconOnly
                tabIndex={-1}
                icon={<MoreHorizontal size={15} aria-hidden />}
                aria-label="More for this item"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  menus.openMenu({ x: rect.left, y: rect.bottom + 4 }, entry);
                }}
                data-queue-more={item.id}
              />
              <Button
                variant={ready ? 'primary' : 'secondary'}
                size="md"
                tabIndex={-1}
                icon={<Play size={11} fill="currentColor" aria-hidden />}
                onClick={() => void startQueued(item)}
                className="shrink-0"
                data-queue-start={item.id}
              >
                {ready ? 'Start' : 'Start now'}
              </Button>
            </li>
          );
        })}
      </ul>
      {menus.overlay}
    </section>
  );
}
