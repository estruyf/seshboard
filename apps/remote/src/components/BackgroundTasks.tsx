import { useEffect, useId, useState } from 'react';
import { Bot, ChevronDown, Eye, LoaderCircle, Plug, Square, SquareTerminal, Workflow, type LucideIcon } from 'lucide-react';
import type { BackgroundTask } from '@switchboard/protocol/remote-client';
import { backgroundKind, backgroundSummary, KIND_LABEL, type BackgroundKind } from '../lib/background.ts';
import { formatDuration } from '../lib/working.ts';
import { Button } from './ui.tsx';

const KIND_ICON: Record<BackgroundKind, LucideIcon> = {
  shell: SquareTerminal,
  agent: Bot,
  workflow: Workflow,
  monitor: Eye,
  tool: Plug,
  other: LoaderCircle,
};

/**
 * What a session keeps running after its turn, above the message box as on the computer: a green pill that says how
 * many tasks run, and opens a list of them with how long each has run and a Stop for each (`session.stopTask`).
 */
export function BackgroundTasks({ tasks, onStop }: { tasks: readonly BackgroundTask[]; onStop: ((taskId: string) => Promise<void>) | null }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  // Stopping takes a moment; the task leaves the list when the computer reports it stopped.
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [open]);
  const stop = async (taskId: string) => {
    if (!onStop) return;
    setStopping((s) => new Set(s).add(taskId));
    try {
      await onStop(taskId);
    } catch {
      setStopping((s) => {
        const next = new Set(s);
        next.delete(taskId);
        return next;
      });
    }
  };
  return (
    <section aria-label="Background tasks" className="px-3 pt-2 sm:px-6" data-remote-background>
      <div className="mx-auto grid w-full max-w-3xl gap-1">
        <button
          type="button"
          onClick={() => {
            setNow(Date.now());
            setOpen(!open);
          }}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          title={open ? 'Hide what runs in the background' : 'Show what runs in the background'}
          className={`inline-flex min-h-9 max-w-full items-center gap-1.5 justify-self-end rounded-full border border-ok/40 px-2.5 text-ui text-ok transition-colors hover:bg-ok/10 pointer-fine:min-h-6 ${open ? 'bg-ok/10' : ''}`}
          data-remote-background-pill
        >
          <LoaderCircle className="size-3 shrink-0 animate-[spin_2s_linear_infinite]" aria-hidden />
          <span className="truncate">{backgroundSummary(tasks)}</span>
          <ChevronDown className={`size-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        {open && (
          <ul id={listId} className="grid max-h-48 overflow-y-auto" data-remote-background-list>
            {tasks.map((task) => {
              const kind = backgroundKind(task.type);
              const Icon = KIND_ICON[kind];
              const label = task.description || KIND_LABEL[kind];
              const isStopping = stopping.has(task.taskId);
              return (
                <li key={task.taskId} className="flex min-w-0 items-center gap-2 px-1 text-ui" data-remote-background-task={task.taskId}>
                  <Icon className="size-3.5 shrink-0 text-ok" aria-hidden />
                  <span className="min-w-0 flex-1 truncate" title={task.description}>
                    {label}
                  </span>
                  <span className="shrink-0 text-meta text-muted tabular-nums">
                    {KIND_LABEL[kind]} · {formatDuration(now - task.startedAt)}
                  </span>
                  <Button variant="danger" size="md" disabled={!onStop || isStopping} onClick={() => void stop(task.taskId)} aria-label={`Stop ${label}`} title="Stop this task" className="px-2!" data-remote-stop-task>
                    <Square className="size-3" aria-hidden />
                    {isStopping ? 'Stopping…' : 'Stop'}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
