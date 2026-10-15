import { Bot, Eye, LoaderCircle, Plug, Square, SquareTerminal, Workflow, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import type { BackgroundTask } from '@switchboard/protocol/client';
import { Button } from '../ui/Button.tsx';
import { formatDuration, useTicker } from './ActivityGroup.tsx';
import type { AgentRun } from './agentRuns.ts';
import { backgroundKind, KIND_LABEL, type BackgroundKind } from './backgroundTasks.ts';

const KIND_ICON: Record<BackgroundKind, LucideIcon> = {
  shell: SquareTerminal,
  agent: Bot,
  workflow: Workflow,
  monitor: Eye,
  tool: Plug,
  other: LoaderCircle,
};

/**
 * What a session keeps running after its turn: each task's kind, what it does, how long it has run,
 * and a button to stop it. Opens from the background pill above the message box. An agent's name opens it in the
 * Agents panel (`agentFor` finds the agent a task stands for; the others have nothing to open).
 */
export function BackgroundTaskList({
  tasks,
  onStop,
  agentFor,
  onOpenAgent,
  id,
}: {
  tasks: BackgroundTask[];
  onStop: (taskId: string) => Promise<void>;
  agentFor?: (task: BackgroundTask) => AgentRun | undefined;
  onOpenAgent?: (run: AgentRun) => void;
  id?: string;
}) {
  const now = useTicker(true);
  // Stopping takes a moment; the task leaves the list when Claude Code reports it stopped.
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());
  const stop = async (taskId: string) => {
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
    <ul id={id} className="grid max-h-40 gap-0.5 overflow-y-auto px-1" aria-label="Background tasks" data-background-tasks>
      {tasks.map((task) => {
        const kind = backgroundKind(task.type);
        const Icon = KIND_ICON[kind];
        const isStopping = stopping.has(task.taskId);
        const run = kind === 'agent' ? agentFor?.(task) : undefined;
        return (
          <li key={task.taskId} className="flex min-w-0 items-center gap-2 text-ui" data-background-task={task.taskId}>
            <Icon size={14} className="shrink-0 text-ok" aria-hidden />
            {run && onOpenAgent ? (
              <button
                type="button"
                onClick={() => onOpenAgent(run)}
                className="min-w-0 flex-1 truncate rounded text-left text-text hover:underline focus-visible:underline"
                data-tooltip="Open in the Agents panel"
                data-open-agent={run.item.id}
              >
                {task.description || KIND_LABEL[kind]}
              </button>
            ) : (
              <span className="min-w-0 flex-1 truncate text-text" data-tooltip={task.description}>
                {task.description || KIND_LABEL[kind]}
              </span>
            )}
            <span className="shrink-0 text-meta text-muted tabular-nums">
              {KIND_LABEL[kind]}
              {now > 0 && ` · ${formatDuration(now - task.startedAt)}`}
            </span>
            <Button
              variant="quiet"
              size="sm"
              icon={<Square size={11} aria-hidden />}
              disabled={isStopping}
              onClick={() => void stop(task.taskId)}
              aria-label={`Stop ${task.description || KIND_LABEL[kind]}`}
              data-tooltip="Stop this task"
              data-stop-task
            >
              {isStopping ? 'Stopping…' : 'Stop'}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
