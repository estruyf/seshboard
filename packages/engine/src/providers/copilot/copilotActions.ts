import { Effort, type BackgroundTask, type RewindResult } from '@seshboard/protocol';
import type { CopilotEvent } from './copilotEvents.ts';

/**
 * Where a fork that keeps the conversation up to and including `upToMessageId` ends, for Copilot's `sessions.fork`,
 * which keeps the events before its `toEventId`. A reply that asked for tools keeps their results too, so the fork
 * never starts on a call without its answer. Null: the fork keeps every event. Undefined: no such message.
 *
 * Message ids are Copilot's event ids (`CopilotConverter`), or `copilot-<index>` for an event without one.
 */
export function forkBoundary(events: readonly CopilotEvent[], upToMessageId: string): string | null | undefined {
  const index = events.findIndex((event, i) => (event.id ?? `copilot-${i}`) === upToMessageId);
  if (index < 0) return undefined;
  const data = events[index]!.data ?? {};
  const pending = new Set(
    events[index]!.type === 'assistant.message' && Array.isArray(data.toolRequests)
      ? data.toolRequests.flatMap((r) => (r && typeof r === 'object' && typeof (r as { toolCallId?: unknown }).toolCallId === 'string' ? [(r as { toolCallId: string }).toolCallId] : []))
      : [],
  );
  let next = index + 1;
  for (; next < events.length && pending.size; next++) {
    const event = events[next]!;
    if (event.type === 'tool.execution_complete' && typeof event.data?.toolCallId === 'string') pending.delete(event.data.toolCallId);
  }
  // The first event after it that has an id: one without can't be named as the boundary.
  return events.slice(next).find((event) => typeof event.id === 'string')?.id ?? null;
}

/** Why Copilot can't rewind, in words. */
const REWIND_PROBLEMS: Record<string, string> = {
  'file-change-tracking-disabled': "Copilot didn't keep this session's file changes, so it can't rewind it.",
  'session-busy': 'Copilot is still working. Rewind once it finishes.',
  'unsupported-remote-session': "Copilot can't rewind a remote session.",
  'files-rolled-back': "Couldn't restore the files, so nothing changed.",
  'rollback-incomplete': "Couldn't restore every file, and some may be partly restored. Check your changes.",
  'truncation-failed': "Restored the files, but couldn't rewind the conversation.",
};

export const rewindProblem = (reason: string | undefined): string => REWIND_PROBLEMS[reason ?? ''] ?? "Copilot can't rewind this session.";

/** A rewind that can't happen, with why. */
export const cannotRewind = (error: string): RewindResult => ({ canRewind: false, error, files: [], insertions: 0, deletions: 0 });

/** Copilot's `history.previewRewind` as the rewind dialog's preview. */
export function rewindPreview(preview: { available: boolean; reason?: string; files: ReadonlyArray<{ path: string; linesAdded: number; linesRemoved: number }> }): RewindResult {
  if (!preview.available) return cannotRewind(rewindProblem(preview.reason));
  return {
    canRewind: true,
    error: null,
    files: preview.files.map((f) => f.path),
    insertions: preview.files.reduce((sum, f) => sum + f.linesAdded, 0),
    deletions: preview.files.reduce((sum, f) => sum + f.linesRemoved, 0),
  };
}

/** Outcomes where the conversation went back (a clean-up after it may have failed, which leaves nothing to fix). */
const REWOUND = new Set(['success', 'checkpoint-cleanup-failed', 'snapshot-prune-failed']);

/** Copilot's `history.rewind` outcome as the rewind dialog's result. */
export function rewindOutcome(result: { outcome: string; restoredFiles: readonly string[]; error?: string }): RewindResult {
  if (!REWOUND.has(result.outcome)) return cannotRewind(REWIND_PROBLEMS[result.outcome] ?? result.error ?? rewindProblem(undefined));
  return { canRewind: true, error: null, files: [...result.restoredFiles], insertions: 0, deletions: 0 };
}

/** One of a session's tasks, as `session.tasks.list` gives it (a shell command or an agent). */
export interface CopilotTask {
  type: string;
  id: string;
  description: string;
  status: string;
  startedAt: string;
  /** `background`: Copilot doesn't wait for it. */
  executionMode?: string;
  /** A shell's: `detached` runs as a process of its own, in the background. */
  attachmentMode?: string;
  command?: string;
  displayName?: string;
}

/** Copilot's task types as Claude Code's, which the pill and the panel know. */
const TASK_TYPES: Record<string, string> = { shell: 'local_bash', agent: 'local_agent' };

/** The tasks running in the background (not the ones a turn waits for), as the pill and the panel show them. */
export function backgroundTasks(tasks: readonly CopilotTask[]): BackgroundTask[] {
  return tasks
    .filter((t) => t.status === 'running' && (t.executionMode === 'background' || t.attachmentMode === 'detached'))
    .map((t) => {
      const started = Date.parse(t.startedAt);
      return { taskId: t.id, type: TASK_TYPES[t.type] ?? t.type, description: t.description || t.command || t.displayName || 'Task', startedAt: Number.isFinite(started) ? started : Date.now() };
    });
}

/** The effort levels a model takes, of those Seshboard knows; undefined when Copilot doesn't say. */
export function effortsOf(levels: readonly string[] | undefined): Effort[] | undefined {
  if (!levels) return undefined;
  return levels.filter((level): level is Effort => Effort.safeParse(level).success);
}
