import { Bot, Eye, LoaderCircle, Plug, Square, SquareTerminal, Workflow, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import type { BackgroundTask } from '@switchboard/protocol/client';
import { Button } from '../ui/Button.tsx';
import { formatDuration, useTicker } from './ActivityGroup.tsx';
import type { AgentRun } from './agentRuns.ts';
import type { CommandRun } from './commandRuns.ts';
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
 * and a button to stop it. Opens from the background pill above the message box. A name opens the task in its panel:
 * an agent in Agents (`agentFor` finds the agent a task stands for), a shell command or monitor in Commands
 * (`commandFor`); workflows and MCP tools have nothing to open.
 */
export function BackgroundTaskList({
  tasks,
  onStop,
  agentFor,
  onOpenAgent,
  commandFor,
  onOpenCommand,
  id,
}: {
  tasks: BackgroundTask[];
  onStop: (taskId: string) => Promise<void>;
  agentFor?: (task: BackgroundTask) => AgentRun | undefined;
  onOpenAgent?: (run: AgentRun) => void;
  commandFor?: (task: BackgroundTask) => CommandRun | undefined;
  onOpenCommand?: (run: CommandRun) => void;
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
        const command = kind === 'shell' || kind === 'monitor' ? commandFor?.(task) : undefined;
        const label = task.description || KIND_LABEL[kind];
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
                {label}
              </button>
            ) : command && onOpenCommand ? (
              <button
                type="button"
                onClick={() => onOpenCommand(command)}
                className="min-w-0 flex-1 truncate rounded text-left text-text hover:underline focus-visible:underline"
                data-tooltip="Show its output in the Commands panel"
                data-open-command={command.taskId}
              >
                {label}
              </button>
            ) : (
              <span className="min-w-0 flex-1 truncate text-text" data-tooltip={task.description}>
                {label}
              </span>
            )}
            <span className="shrink-0 text-meta text-muted tabular-nums">
              {KIND_LABEL[kind]}
              {now > 0 && ` · ${formatDuration(now - task.startedAt)}`}
            </span>
            <Button
              variant="danger"
              size="sm"
              icon={<Square size={11} aria-hidden />}
              disabled={isStopping}
              onClick={() => void stop(task.taskId)}
              aria-label={`Stop ${label}`}
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
